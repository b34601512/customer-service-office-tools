const { waitForPddLoginReady } = require("../pddLoginState");

const PDD_DOWNLOAD_LOGIN_READY_TIMEOUT_MS = 45000;
const PDD_DOWNLOAD_POLL_INTERVAL_MS = 1000;

async function waitForPddDownloadReadyPage(browser, storeConfig, options = {}) {
  // 这个函数只等待当前拼多多店铺页面的登录状态稳定就绪。
  return waitForPddLoginReady(browser, {
    storeConfig,
    timeoutMs: Number(options.loginReadyTimeoutMs) || PDD_DOWNLOAD_LOGIN_READY_TIMEOUT_MS,
    pollIntervalMs: Number(options.loginReadyPollIntervalMs) || PDD_DOWNLOAD_POLL_INTERVAL_MS
  });
}

module.exports = {
  waitForPddDownloadReadyPage
};
