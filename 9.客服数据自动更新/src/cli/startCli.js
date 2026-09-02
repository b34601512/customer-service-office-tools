const path = require("path");

// 本机代理兼容：系统设置 HTTP_PROXY/HTTPS_PROXY 时，Node 会把发往 127.0.0.1 的
// CDP 调试请求也交给代理，导致“连接调试浏览器”重试到超时。这里把本机地址加入 NO_PROXY。
process.env.NO_PROXY = [process.env.NO_PROXY, "127.0.0.1", "localhost"].filter(Boolean).join(",");
process.env.no_proxy = process.env.NO_PROXY;

const localDateText = new Date().toLocaleDateString("sv-SE");
process.env.CUSTOMER_PERFORMANCE_SUPPRESS_CONSOLE_LOG = "1";
process.env.CUSTOMER_PERFORMANCE_LOG_PATH = process.env.CUSTOMER_PERFORMANCE_LOG_PATH || path.resolve(__dirname, "..", "..", "runtime", "logs", `cli-${localDateText}.log`);

const forceLegacyCli = (
  process.argv.includes("--no-tui") ||
  process.env.CUSTOMER_PERFORMANCE_DISABLE_TUI === "1"
);

function reportStartupFailure(error) {
  console.error(`控制台启动失败：${String(error?.stack || error?.message || error)}`);
  process.exitCode = 1;
}

// 终端可用时进入全屏 TUI（备用屏幕 + 原始按键）；管道/CI 环境回退到旧 readline 菜单。
if (!forceLegacyCli && process.stdin.isTTY && process.stdout.isTTY) {
  const { startTuiRuntime } = require("./tui/startTuiRuntime");
  startTuiRuntime().catch(reportStartupFailure);
} else {
  const { startCliRuntime } = require("./cliRuntime");
  startCliRuntime().catch(reportStartupFailure);
}
