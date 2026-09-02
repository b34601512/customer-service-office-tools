// 该文件用于解决 Chrome 会话引擎子模块加载和对外接口注册问题。
const {
  resolveChromePath,
  readManagedChromeSession
} = require("./chromeSessionParts/chromeSessionPaths");
const {
  isLocalPortOpen,
  waitForChromeDebugPortReady
} = require("./chromeSessionParts/chromePortWaiters");
const { launchChromeForManualLogin } = require("./chromeSessionParts/chromeLauncher");
const { connectToChrome, waitForPage, disconnectFromChrome } = require("./chromeSessionParts/chromeConnector");
const { closeManagedChromeWithDependencies } = require("./chromeSessionParts/chromeCloser");

async function closeManagedChrome() {
  // 这里统一关闭本项目拉起的调试 Chrome，避免退出后台后残留浏览器窗口。
  return closeManagedChromeWithDependencies();
}

module.exports = {
  resolveChromePath,
  launchChromeForManualLogin,
  disconnectFromChrome,
  isLocalPortOpen,
  waitForChromeDebugPortReady,
  connectToChrome,
  waitForPage,
  readManagedChromeSession,
  closeManagedChrome
};
