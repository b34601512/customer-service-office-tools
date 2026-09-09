// 无头 Edge 没有主窗口；通过 CDP Browser.close 正常落盘资料后再释放进程。
const { loadPlaywrightCore } = require("../playwrightProvider");

async function requestChromeCloseOverCDP(endpoint, dependencies = {}) {
  const connect = dependencies.connect || ((url, options) =>
    loadPlaywrightCore().chromium.connectOverCDP(url, options));
  const browser = await connect(endpoint, { timeout: 3000 });
  try {
    const session = await browser.newBrowserCDPSession();
    try {
      await session.send("Browser.close");
    } catch (error) {
      // Browser.close 可能先断开连接；调用方仍须检查端口真正关闭。
      if (!/Target closed|Target page, context or browser has been closed|Session closed|Connection closed/i
        .test(String(error?.message || error))) {
        throw error;
      }
    }
    return true;
  } finally {
    await browser.close().catch(() => {});
  }
}

module.exports = {
  requestChromeCloseOverCDP
};
