// 统一设置店铺采集浏览器模式，再进入唯一 CLI 入口。
const mode = String(process.argv[2] || "hybrid").trim().toLowerCase();
if (!["hybrid", "headed", "headless"].includes(mode)) {
  console.error("浏览器模式无效：仅支持 hybrid、headed、headless。");
  process.exitCode = 1;
} else {
  process.env.CUSTOMER_PERFORMANCE_BROWSER_MODE = mode;
  require("../src/cli/startCli");
}
