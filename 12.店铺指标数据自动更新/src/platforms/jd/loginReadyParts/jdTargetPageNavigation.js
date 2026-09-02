const { log } = require("../../../engine/logger");
const {
  normalizeText,
  isSameTargetUrl,
  isJdSystemUrl,
  isJdLoginReady,
  pickBestCandidatePage
} = require("../jdLoginPageClassifier");
const { findReadyJdPage } = require("./jdReadyPageSearch");

const JD_TARGET_READY_POLL_INTERVAL_MS = 1000;

async function navigatePageToJdTarget(page, targetUrl) {
  // 这个函数只把一个京东页面导航到当前店铺目标 URL。
  const nextUrl = normalizeText(targetUrl);
  if (!nextUrl || isSameTargetUrl(page.url(), nextUrl)) {
    return page;
  }
  await page.goto(nextUrl, {
    waitUntil: "domcontentloaded",
    timeout: 30000
  });
  await page.waitForLoadState("domcontentloaded", { timeout: 10000 });
  return page;
}

async function ensureJdSystemCandidateOnTarget(browser, storeConfig) {
  // 这个函数只把已登录的京东系统候选页纠偏到下载目标页。
  const targetUrl = normalizeText(storeConfig?.siteUrl);
  const downloadMode = normalizeText(storeConfig?.downloadMode);
  if (downloadMode !== "system" || !targetUrl) {
    return false;
  }
  const candidatePage = pickBestCandidatePage(browser, storeConfig);
  if (!candidatePage || !isJdSystemUrl(candidatePage.url()) || isSameTargetUrl(candidatePage.url(), targetUrl)) {
    return false;
  }
  log("主线:执行", "京东登录", "系统页纠偏", `当前系统页=${candidatePage.url()}，目标页=${targetUrl}`);
  await navigatePageToJdTarget(candidatePage, targetUrl);
  return true;
}

async function waitForJdTargetReady(page, targetUrl, timeoutMs = 15000) {
  // 这个函数只等待目标 URL 页面同时满足地址命中和登录就绪。
  const safeTargetUrl = normalizeText(targetUrl);
  if (!safeTargetUrl) {
    return page;
  }
  const safeTimeoutMs = Math.max(500, Number(timeoutMs) || 15000);
  const startAt = Date.now();
  while (Date.now() - startAt <= safeTimeoutMs) {
    if (isSameTargetUrl(page.url(), safeTargetUrl) && (await isJdLoginReady(page))) {
      return page;
    }
    const remainingMs = safeTimeoutMs - (Date.now() - startAt);
    if (remainingMs <= 0) {
      break;
    }
    await new Promise((resolve) => setTimeout(resolve, Math.min(JD_TARGET_READY_POLL_INTERVAL_MS, remainingMs)));
  }
  throw new Error(`当前店铺目标页仍未就绪：${safeTargetUrl}。请确认浏览器里已经完成当前店铺登录。`);
}

async function ensureJdPageOnTarget(browser, storeConfig, timeoutMs = 15000) {
  // 这个函数只选择可用京东页面并确保其进入当前店铺目标页。
  const targetUrl = normalizeText(storeConfig?.siteUrl);
  let page = (await findReadyJdPage(browser, storeConfig)) || pickBestCandidatePage(browser, storeConfig);
  if (!page) {
    throw new Error("当前没有可用的京东页面，无法继续进入目标店铺页。");
  }
  if (!targetUrl) {
    return page;
  }
  if (!isSameTargetUrl(page.url(), targetUrl)) {
    log("主线:执行", "京东登录", "进入目标页", `准备校正当前店铺目标页，当前地址=${page.url()}，目标地址=${targetUrl}`);
    page = await navigatePageToJdTarget(page, targetUrl);
  }
  await waitForJdTargetReady(page, targetUrl, timeoutMs);
  return page;
}

module.exports = {
  ensureJdSystemCandidateOnTarget,
  ensureJdPageOnTarget
};
