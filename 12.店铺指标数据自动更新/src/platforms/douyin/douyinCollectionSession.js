const { resolveBrowserMode } = require("../../engine/browserAutomationScope");
const { closeManagedChrome } = require("../../engine/chromeSession");

// 抖音多个店铺属于同一登录账号：一轮批量任务只保留一个浏览器会话。
function createDouyinSharedBrowserSession(options = {}) {
  let currentBrowserMode = resolveBrowserMode(options.browserMode);
  let started = false;
  const closeBrowser = options.closeBrowser || closeManagedChrome;

  function requireOpenBrowserFunction(openBrowser) {
    if (typeof openBrowser !== "function") {
      throw new Error("启动抖音共享浏览器会话失败：缺少浏览器打开函数。");
    }
  }

  return {
    get browserMode() {
      return currentBrowserMode;
    },

    get isStarted() {
      return started;
    },

    async ensureStarted(openBrowser) {
      if (started) return false;
      requireOpenBrowserFunction(openBrowser);
      await openBrowser(currentBrowserMode);
      started = true;
      return true;
    },

    async rebuildHeaded(openBrowser) {
      requireOpenBrowserFunction(openBrowser);
      await openBrowser("headed");
      currentBrowserMode = "headed";
      started = true;
      return true;
    },

    async close() {
      if (!started) return false;
      started = false;
      return closeBrowser();
    }
  };
}

module.exports = {
  createDouyinSharedBrowserSession
};
