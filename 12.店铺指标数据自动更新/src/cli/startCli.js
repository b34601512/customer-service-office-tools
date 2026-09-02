const path = require("path");

// 本机代理工具（如 Clash）会把 HTTP_PROXY/HTTPS_PROXY 注入环境变量，
// 而 playwright 接管本地调试 Chrome 时会按代理访问 127.0.0.1 的调试端口，
// 导致 CDP 连接被代理拦截（Unexpected status 400）。
// 这里显式声明 localhost 不走代理，保证店铺采集的浏览器接管链路稳定。
process.env.NO_PROXY = [process.env.NO_PROXY, "127.0.0.1,localhost"].filter(Boolean).join(",");
process.env.no_proxy = process.env.NO_PROXY;

const { ensureStoreMetricConfig } = require("../config/storeMetricConfig");

const localDateText = new Date().toLocaleDateString("sv-SE");
process.env.CUSTOMER_PERFORMANCE_SUPPRESS_CONSOLE_LOG = "1";
process.env.CUSTOMER_PERFORMANCE_LOG_PATH = process.env.CUSTOMER_PERFORMANCE_LOG_PATH || path.resolve(
  __dirname,
  "..",
  "..",
  "runtime",
  "logs",
  `cli-${localDateText}.log`
);

const { startCliRuntime } = require("./cliRuntime");

// 默认走全屏 TUI（与 #9 一致）；显式 --no-tui、环境变量关闭或非 TTY 时回退 readline 菜单。
const forceLegacyCli =
  process.argv.includes("--no-tui") || process.env.CUSTOMER_PERFORMANCE_DISABLE_TUI === "1";

Promise.resolve()
  .then(() => ensureStoreMetricConfig())
  .then(() => {
    if (!forceLegacyCli && process.stdin.isTTY && process.stdout.isTTY) {
      return require("./tui/startTuiRuntime").startTuiRuntime();
    }
    return startCliRuntime();
  })
  .catch((error) => {
    console.error(`控制台启动失败：${String(error?.stack || error?.message || error)}`);
    process.exitCode = 1;
  });
