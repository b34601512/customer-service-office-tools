const path = require("path");
const fs = require("fs");
const root = process.cwd();
process.env.NO_PROXY = [process.env.NO_PROXY, "127.0.0.1,localhost"].filter(Boolean).join(",");
process.env.no_proxy = process.env.NO_PROXY;
process.env.CUSTOMER_PERFORMANCE_SUPPRESS_CONSOLE_LOG = "1";
process.env.CUSTOMER_PERFORMANCE_LOG_PATH = path.join(root, "runtime", "logs", `cli-${new Date().toLocaleDateString("sv-SE")}.log`);
const { createControlCenterStateStore } = require(path.join(root, "src/controlCenter/controlCenterState"));
const { runConfiguredStoresTask } = require(path.join(root, "src/controlCenter/controlCenterTask"));

const LOG_PATH = path.join(root, "runtime", "output", "cli-douyin-force.log");
const STRIP_ANSI = (text) => String(text || "").replace(/\u001b\[[0-9;]*m/g, "");
function logLine(text) {
  fs.appendFileSync(LOG_PATH, `[${new Date().toLocaleTimeString("zh-CN", { hour12: false })}] ${STRIP_ANSI(text)}\n`);
}

(async () => {
  fs.writeFileSync(LOG_PATH, "");
  logLine("=== 强制重采抖音平台（修复抖音03店缺失指标）===");
  const stateStore = createControlCenterStateStore();
  let lastSignature = "";
  stateStore.subscribe((state) => {
    const signature = `${state.stage}|${state.detail}|${(state.storeResults || []).map((s) => `${s.storeKey}:${s.status}`).join(",")}`;
    if (signature === lastSignature) return;
    lastSignature = signature;
    logLine(`[状态] ${state.stage} · ${state.detail}`);
    for (const storeResult of state.storeResults || []) {
      if (storeResult.updatedAt) logLine(`   - ${storeResult.storeName} (${storeResult.storeKey}): ${storeResult.status} · ${storeResult.detail}`);
    }
  });
  try {
    const result = await runConfiguredStoresTask(stateStore, {
      forceRecollect: true,
      collectionScope: { type: "platform", platformKey: "douyin" }
    });
    logLine("=== 完成 ===");
    for (const storeResult of result.stores) {
      logLine(`RESULT ${storeResult.storeKey} ${storeResult.storeName} status=${storeResult.status} metricCount=${storeResult.metricCount} detail=${storeResult.detail}`);
    }
    process.exitCode = 0;
  } catch (error) {
    logLine(`ERROR ${String(error?.stack || error?.message || error)}`);
    process.exitCode = 1;
  }
})();
