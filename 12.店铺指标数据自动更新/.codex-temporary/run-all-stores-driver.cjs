const path = require("path");
const fs = require("fs");
const root = process.cwd();
// 与 src/cli/startCli.js 保持一致的代理屏蔽：playwright 接管本地 Chrome 时不能走系统代理。
process.env.NO_PROXY = [process.env.NO_PROXY, "127.0.0.1,localhost"].filter(Boolean).join(",");
process.env.no_proxy = process.env.NO_PROXY;
const localDateText = new Date().toLocaleDateString("sv-SE");
process.env.CUSTOMER_PERFORMANCE_SUPPRESS_CONSOLE_LOG = "1";
process.env.CUSTOMER_PERFORMANCE_LOG_PATH = path.join(root, "runtime", "logs", `cli-${localDateText}.log`);
const { createControlCenterStateStore } = require(path.join(root, "src/controlCenter/controlCenterState"));
const { runConfiguredStoresTask } = require(path.join(root, "src/controlCenter/controlCenterTask"));

const LOG_PATH = path.join(root, "runtime", "output", "cli-driver-run.log");
const STRIP_ANSI = (text) => String(text || "").replace(/\u001b\[[0-9;]*m/g, "");
function logLine(text) {
  const line = `[${new Date().toLocaleTimeString("zh-CN", { hour12: false })}] ${STRIP_ANSI(text)}\n`;
  fs.appendFileSync(LOG_PATH, line);
}

(async () => {
  fs.writeFileSync(LOG_PATH, "");
  logLine("=== 批量汇总开始（全部启用店铺）===");
  const stateStore = createControlCenterStateStore();
  let lastSignature = "";
  stateStore.subscribe((state) => {
    const signature = `${state.stage}|${state.detail}|${(state.storeResults || []).map((s) => `${s.storeKey}:${s.status}`).join(",")}`;
    if (signature === lastSignature) return;
    lastSignature = signature;
    logLine(`[状态] ${state.stage} · ${state.detail}`);
    for (const storeResult of state.storeResults || []) {
      if (storeResult.updatedAt) {
        logLine(`   - ${storeResult.storeName} (${storeResult.storeKey}): ${storeResult.status} · ${storeResult.detail}`);
      }
    }
  });
  try {
    const result = await runConfiguredStoresTask(stateStore, {});
    logLine("=== 批量汇总完成 ===");
    logLine(`SUMMARY status=${stateStore.read().status} collected=${result.collectedCount} skipped=${result.skippedCount} error=${result.errorCount} metricCount=${result.metricCount}`);
    for (const storeResult of result.stores) {
      logLine(`RESULT ${storeResult.storeKey} ${storeResult.storeName} status=${storeResult.status} metricCount=${storeResult.metricCount} detail=${storeResult.detail}`);
    }
    process.exitCode = 0;
  } catch (error) {
    logLine("=== 批量汇总失败 ===");
    logLine(`ERROR ${String(error?.stack || error?.message || error)}`);
    process.exitCode = 1;
  }
})();
