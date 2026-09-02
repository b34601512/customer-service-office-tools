const appConfig = require("../../config/appConfig");
const { log } = require("../../engine/logger");
const { wait } = require("../../shared/browserActionEngine");
const { getTmallCurrentDateLocator, getTmallCustomDateButton } = require("./tmallControls");
const { assertNoTmallSafetyChallenge } = require("./tmallSafetyGuard");

async function waitForTmallReportPageReady(page) {
  // 这里用“当前日期 + 自定义按钮”判断报表页是否真可操作，避免卡在下载入口可见性上进不了日期筛选。
  const currentDateLocator = getTmallCurrentDateLocator(page);
  const customDateButton = getTmallCustomDateButton(page);
  const deadline = Date.now() + appConfig.tmall.connectTimeoutMs;
  let currentDateVisible = false;
  let customDateVisible = false;

  log("主线:等待", "天猫导航", "页面就绪", "等待统计日期控件出现");
  while (Date.now() <= deadline) {
    await assertNoTmallSafetyChallenge(page, "等待报表页就绪");
    currentDateVisible = await currentDateLocator.isVisible();
    customDateVisible = await customDateButton.isVisible();
    if (currentDateVisible && customDateVisible) {
      break;
    }

    const remainingMs = deadline - Date.now();
    if (remainingMs <= 0) {
      break;
    }

    await wait(Math.min(appConfig.tmall.pageReadyPollIntervalMs, remainingMs));
  }

  if (!currentDateVisible || !customDateVisible) {
    throw new Error(
      `等待天猫报表页就绪超时：统计日期控件=${currentDateVisible ? "已出现" : "未出现"}，自定义按钮=${customDateVisible ? "已出现" : "未出现"}。`
    );
  }

  const currentDateText = (await currentDateLocator.innerText()).replace(/\s+/g, " ").trim();
  log("主线:完成", "天猫导航", "页面就绪", `当前地址=${page.url()}，日期文本=${currentDateText || "未读到"}`);
}

async function navigatePageToTmallTarget(page, targetUrl = "", options = {}) {
  // 这里只负责把指定页面切到目标地址，并按需等待操作控件真正可用。
  const nextUrl = targetUrl || appConfig.tmall.siteUrl;
  const shouldWaitForReady = options.waitForReady !== false;
  await page.bringToFront();
  log("主线:执行", "天猫导航", "打开目标页", `准备跳转：${nextUrl}`);
  await page.goto(nextUrl, {
    waitUntil: "domcontentloaded",
    timeout: appConfig.tmall.connectTimeoutMs
  });
  if (shouldWaitForReady) {
    await waitForTmallReportPageReady(page);
  }
  return page.url();
}

module.exports = {
  navigatePageToTmallTarget,
  waitForTmallReportPageReady
};
