const { log } = require("../../engine/logger");
const { clickVisibleText } = require("./jdPageGuards");
const { isJdReportSurfaceReady, stabilizeJdBrowser, readSurfaceBodyText } = require("./jdPopupAndSurfaceState");
const {
  JD_STATE_POLL_INTERVAL_MS,
  waitForNextJdStateCheck
} = require("./jdStateHelpers");
const { JD_SYSTEM_RECEPTION_DATA_URL, isJdSystemReceptionDataUrl } = require("./jdUrlRules");

function normalizeText(value) {
  return String(value || "")
    .replace(/\s+/g, " ")
    .trim();
}

function hasJdSystemReceptionDataText(text) {
  // 这里精确识别京东系统「店铺数据 -> 数据明细」页，避免旧后台菜单规则继续混进新链路。
  const normalizedText = normalizeText(text);
  return (
    normalizedText.includes("店铺数据") &&
    normalizedText.includes("数据明细") &&
    normalizedText.includes("售前接待人数") &&
    normalizedText.includes("促成下单人数") &&
    normalizedText.includes("促成下单商品金额") &&
    normalizedText.includes("导出数据")
  );
}

async function findJdSystemReceptionDataSurface(browser) {
  // 这里扫描京东系统「店铺数据」页面，系统模式只在真实 ReceptionData 下载页继续执行。
  for (const context of browser.contexts()) {
    for (const page of context.pages()) {
      if (!isJdSystemReceptionDataUrl(page.url?.())) {
        continue;
      }

      for (const surface of page.frames()) {
        const bodyText = await readSurfaceBodyText(surface);
        if (!hasJdSystemReceptionDataText(bodyText)) {
          continue;
        }

        if (await isJdReportSurfaceReady(surface)) {
          return { page, surface, bodyText };
        }
      }
    }
  }

  return null;
}

async function tryEnsureJdSystemEveryPersonTab(surface) {
  // 这里显式点一次「每人数据」，避免用户上次停留在「每日数据」导致导出结构变化。
  const bodyText = await readSurfaceBodyText(surface);
  if (!bodyText.includes("每人数据")) {
    return false;
  }

  const clicked = await clickVisibleText(surface, ["每人数据"]);
  if (clicked) {
    log("主线:执行", "京东系统下载", "切换每人数据", "已点击「每人数据」，准备继续查询与导出");
    await waitForJdSystemReportSurfaceReady(surface, JD_STATE_POLL_INTERVAL_MS);
    return true;
  }

  return false;
}

async function waitForJdSystemReportSurfaceReady(surface, timeoutMs) {
  // 这里等系统报表控件恢复可用，已经可用时立即返回，不再固定睡 1 秒。
  const deadline = Date.now() + Math.max(100, Number(timeoutMs) || JD_STATE_POLL_INTERVAL_MS);
  while (Date.now() <= deadline) {
    if (await isJdReportSurfaceReady(surface)) {
      return true;
    }

    await waitForNextJdStateCheck(deadline, 100);
  }

  return false;
}

function resolveJdSystemTargetUrl(siteUrl) {
  return String(siteUrl || "").trim() || JD_SYSTEM_RECEPTION_DATA_URL;
}

async function navigateReadyPageToJdSystemReport(readyPage, siteUrl) {
  // 这里直接打开新京东系统报表页，不再通过旧系统菜单层层点击。
  if (!readyPage || typeof readyPage.goto !== "function") {
    return false;
  }

  const targetUrl = resolveJdSystemTargetUrl(siteUrl);
  if (isJdSystemReceptionDataUrl(readyPage.url?.())) {
    return false;
  }

  log("主线:执行", "京东系统下载", "打开店铺数据页", `准备进入=${targetUrl}`);
  await readyPage.goto(targetUrl, { waitUntil: "domcontentloaded", timeout: 30000 });
  await readyPage.bringToFront();
  return true;
}

async function enterJdSystemReceptionDataReport(browser, options = {}) {
  // 这里等待京东系统「店铺数据 / 数据明细」页就绪，页面未打开时直接导航到新后台地址。
  const timeoutMs = Math.max(1000, Number(options.timeoutMs) || 30000);
  const deadline = Date.now() + timeoutMs;
  let hasNavigated = false;

  while (Date.now() <= deadline) {
    const readySurface = await findJdSystemReceptionDataSurface(browser);
    if (readySurface) {
      await tryEnsureJdSystemEveryPersonTab(readySurface.surface);
      return readySurface;
    }

    if (!hasNavigated) {
      hasNavigated = await navigateReadyPageToJdSystemReport(options.readyPage, options.siteUrl);
    }

    await stabilizeJdBrowser(browser);
    await waitForNextJdStateCheck(deadline, JD_STATE_POLL_INTERVAL_MS);
  }

  throw new Error("等待京东系统「店铺数据 / 数据明细」报表页就绪超时，请确认账号有权访问新京东系统后台。");
}

module.exports = {
  enterJdSystemReceptionDataReport
};
