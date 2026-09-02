// 该文件只负责构造店铺采集浏览器的启动参数。
const { buildChromeCacheLimitArgs } = require("./chromeCachePolicy");

function assertRequiredLaunchText(value, fieldName) {
  // 这个函数只负责启动参数必填校验，缺关键参数时直接暴露中文原因。
  if (!String(value || "").trim()) {
    throw new Error(`构造 Chrome 启动参数失败：缺少${fieldName}。`);
  }
}

function buildManagedChromeLaunchArgs(options = {}) {
  // 这个函数只构造受控店铺 Chrome 启动参数。
  assertRequiredLaunchText(options.remoteDebuggingPort, "远程调试端口");
  assertRequiredLaunchText(options.userDataDir, "浏览器资料目录");
  assertRequiredLaunchText(options.targetUrl, "目标页面地址");

  return [
    `--remote-debugging-port=${options.remoteDebuggingPort}`,
    // Chrome 136+ 默认拒绝带 Origin 头的 DevTools 客户端（playwright 接管会被 400 拒绝），
    // 这里显式放开本地调试端口的 Origin 校验，保证自动登录辅助能正常接管浏览器。
    "--remote-allow-origins=*",
    `--user-data-dir=${options.userDataDir}`,
    ...buildChromeCacheLimitArgs(options.cacheOptions),
    "--no-first-run",
    "--disable-popup-blocking",
    "--hide-crash-restore-bubble",
    "--disable-session-crashed-bubble",
    "--start-maximized",
    "--new-window",
    options.targetUrl
  ];
}

module.exports = {
  buildManagedChromeLaunchArgs
};
