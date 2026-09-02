const appConfig = require("../../../config/appConfig");
const { waitForPage } = require("../../../engine/chromeSession");
const { log } = require("../../../engine/logger");
const { normalizeText } = require("../jdLoginPageClassifier");
const { stabilizeJdBrowser } = require("../jdPopupAndSurfaceState");
const { advanceJdSessionBeforeReadyCheck } = require("../jdSessionPreflight");
const { findReadyJdPage, hasPendingJdTargetPage } = require("./jdReadyPageSearch");
const { ensureJdSystemCandidateOnTarget, ensureJdPageOnTarget } = require("./jdTargetPageNavigation");

const JD_LOGIN_READY_POLL_INTERVAL_MS = 5000;

async function waitForNextJdLoginCheck(deadlineMs, pollIntervalMs) {
  // 这个函数只在剩余超时范围内低频等待下一次登录检查。
  const remainingMs = Math.max(0, Number(deadlineMs) - Date.now());
  if (remainingMs <= 0) {
    return;
  }
  await new Promise((resolve) => setTimeout(
    resolve,
    Math.min(Math.max(1, Number(pollIntervalMs) || JD_LOGIN_READY_POLL_INTERVAL_MS), remainingMs)
  ));
}

async function waitForJdLoginReady(browser, options = {}) {
  // 这个函数只轮询登录状态，并按调用要求决定是否校正到目标页。
  const timeoutMs = Number(options.timeoutMs || appConfig.tmall.connectTimeoutMs);
  const storeConfig = options.storeConfig || {};
  const ensureTargetPage = options.ensureTargetPage !== false;
  await waitForPage(browser, () => true, timeoutMs);
  const startAt = Date.now();
  let targetPageBlocked = false;
  while (Date.now() - startAt <= timeoutMs) {
    await stabilizeJdBrowser(browser);
    await advanceJdSessionBeforeReadyCheck(browser, storeConfig);
    if (ensureTargetPage) {
      await ensureJdSystemCandidateOnTarget(browser, storeConfig);
      if (await hasPendingJdTargetPage(browser, storeConfig)) {
        targetPageBlocked = true;
      }
    }
    const readyPage = await findReadyJdPage(browser, storeConfig);
    if (readyPage) {
      if (!ensureTargetPage) {
        log("主线:完成", "京东登录", "状态检测", `已确认登录成功，当前地址=${readyPage.url()}，本次仅确认登录状态`);
        return readyPage;
      }
      log("主线:执行", "京东登录", "目标页校正", `已确认登录成功，准备校正到当前店铺目标页=${normalizeText(storeConfig?.siteUrl) || "未配置"}`);
      const remainingMs = Math.max(500, timeoutMs - (Date.now() - startAt));
      const targetPage = await ensureJdPageOnTarget(browser, storeConfig, remainingMs);
      log("主线:完成", "京东登录", "状态检测", `已确认登录成功，当前地址=${targetPage.url()}`);
      return targetPage;
    }
    log("主线:等待", "京东登录", "状态检测", "尚未确认登录成功，继续轮询浏览器页面");
    await waitForNextJdLoginCheck(startAt + timeoutMs, JD_LOGIN_READY_POLL_INTERVAL_MS);
  }
  if (ensureTargetPage && targetPageBlocked) {
    throw new Error(`当前店铺目标页仍未就绪：${normalizeText(storeConfig?.siteUrl) || "未配置"}。请确认浏览器里已经完成当前店铺登录。`);
  }
  throw new Error("等待京东登录成功超时，请确认浏览器里已经完成登录。");
}

module.exports = {
  waitForJdLoginReady
};
