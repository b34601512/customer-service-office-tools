const appConfig = require("../../config/appConfig");
const { waitForPage } = require("../../engine/chromeSession");

async function waitForTmallPage(browser) {
  // 这里统一等待天猫目标页面，后续快照、页面分析、下载都复用这一个入口。
  return waitForPage(
    browser,
    (page) => page.url().includes("sycm.taobao.com"),
    appConfig.tmall.connectTimeoutMs
  );
}

module.exports = {
  waitForTmallPage
};
