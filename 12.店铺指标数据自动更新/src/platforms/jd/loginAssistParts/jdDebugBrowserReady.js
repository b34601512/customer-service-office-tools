// 该文件用于解决京东登录辅助等待调试浏览器就绪的问题。
const appConfig = require("../../../config/appConfig");
const { waitForChromeDebugPortReady } = require("../../../engine/chromeSession");

async function waitForJdDebugBrowserReady(options = {}) {
  // 这里复用统一调试端口等待引擎，保证京东和天猫对浏览器就绪的判断口径完全一致。
  return waitForChromeDebugPortReady({
    timeoutMs: Math.max(1000, Number(options.timeoutMs) || 15000),
    pollIntervalMs: Math.max(50, Number(options.pollIntervalMs) || 300),
    port: appConfig.tmall.remoteDebuggingPort,
    probePort: options.probeDebugPort,
    waitFn: options.waitFn
  });
}

module.exports = {
  waitForJdDebugBrowserReady
};
