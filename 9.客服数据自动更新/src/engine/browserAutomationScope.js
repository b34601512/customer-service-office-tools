// 每个真实数据源独立持有运行状态；不与登录辅助线程或下一家店共享可变标记。
const { AsyncLocalStorage } = require("async_hooks");
const { isApplicationShutdownRequested } = require("../shared/applicationShutdownSignal");
const scopes = new AsyncLocalStorage();
const MODES = new Set(["hybrid", "headed", "headless"]);

function resolveBrowserMode(value = process.env.CUSTOMER_PERFORMANCE_BROWSER_MODE) {
  const mode = String(value || "hybrid").trim().toLowerCase();
  if (!MODES.has(mode)) throw new Error(`浏览器模式无效：${mode}。仅支持 hybrid、headed、headless。`);
  return mode;
}

function resolveHumanTimeoutMs(value = process.env.CUSTOMER_PERFORMANCE_HUMAN_TIMEOUT_MS) {
  if (value === undefined || value === "") return 180000;
  const milliseconds = Number(value);
  if (!Number.isInteger(milliseconds) || milliseconds < 1000 || milliseconds > 900000) {
    throw new Error("人工验证等待时间必须是 1000 到 900000 之间的整数毫秒。");
  }
  return milliseconds;
}

class HumanInterventionRequiredError extends Error {
  constructor(reason) {
    super(`需要可见浏览器：${reason}`);
    this.name = "HumanInterventionRequiredError";
    this.code = "BROWSER_NEEDS_HUMAN";
  }
}

function getAutomationScope() { return scopes.getStore(); }

function isBrowserModeCompatible(session, mode = resolveBrowserMode()) {
  return mode === "hybrid" || (mode === "headless") === (session?.headless === true);
}

function assertAutomationActive() {
  const scope = getAutomationScope();
  if (!scope) return;
  if (!scope.active || (scope.isShutdownRequested || isApplicationShutdownRequested)()) {
    const error = new Error("本次浏览器采集已结束或正在退出，已停止后续动作。");
    error.code = "BROWSER_RUN_CANCELLED";
    throw error;
  }
  if (scope.intervention && scope.headless) throw new HumanInterventionRequiredError(scope.intervention);
}

function requireHeadedBrowser(reason) {
  const scope = getAutomationScope();
  if (!scope) return false;
  assertAutomationActive();
  if (!scope.headless) return false;
  scope.intervention = String(reason || "请完成人工验证");
  throw new HumanInterventionRequiredError(scope.intervention);
}

function registerAutomationBrowser(browser) {
  const scope = getAutomationScope();
  if (scope) scope.browser = browser;
}

function markExportAttempted() {
  assertAutomationActive();
  const scope = getAutomationScope();
  // 从此刻起导出是否已提交可能不明确，不能自动重放整个数据源。
  if (scope) scope.exportAttempted = true;
}

async function runInAutomationScope(scope, action) {
  scope.active = true;
  return scopes.run(scope, async () => {
    try { return await action(); }
    finally { scope.active = false; }
  });
}

module.exports = {
  resolveBrowserMode, resolveHumanTimeoutMs, isBrowserModeCompatible, getAutomationScope,
  assertAutomationActive, requireHeadedBrowser, registerAutomationBrowser,
  markExportAttempted, runInAutomationScope, HumanInterventionRequiredError
};
