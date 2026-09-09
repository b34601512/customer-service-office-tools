// 每次店铺采集独立持有浏览器模式和人工介入状态，避免不同页面或下一家店互相污染。
const { AsyncLocalStorage } = require("async_hooks");

const automationScopes = new AsyncLocalStorage();
const BROWSER_MODES = new Set(["hybrid", "headed", "headless"]);

function resolveBrowserMode(value = process.env.CUSTOMER_PERFORMANCE_BROWSER_MODE) {
  const mode = String(value || "hybrid").trim().toLowerCase();
  if (!BROWSER_MODES.has(mode)) {
    throw new Error(`浏览器模式无效：${mode}。仅支持 hybrid、headed、headless。`);
  }
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
    const normalizedReason = String(reason || "请完成人工验证").trim() || "请完成人工验证";
    super(`需要可见浏览器：${normalizedReason}`);
    this.name = "HumanInterventionRequiredError";
    this.code = "BROWSER_NEEDS_HUMAN";
    this.reason = normalizedReason;
  }
}

function getAutomationScope() {
  return automationScopes.getStore();
}

function getAutomationTime() {
  const scope = getAutomationScope();
  const now = typeof scope?.now === "function" ? scope.now() : Date.now();
  return now - (scope?.humanWaitMs || 0);
}

function assertAutomationActive() {
  const scope = getAutomationScope();
  if (!scope) return;
  const shutdownRequested = typeof scope.isShutdownRequested === "function" && scope.isShutdownRequested();
  if (!scope.active || shutdownRequested) {
    const error = new Error("本次浏览器采集已结束或正在退出，已停止后续动作。");
    error.code = "BROWSER_RUN_CANCELLED";
    throw error;
  }
  if (scope.intervention && scope.headless) {
    throw new HumanInterventionRequiredError(scope.intervention);
  }
}

function requireHeadedBrowser(reason) {
  const scope = getAutomationScope();
  if (!scope) return false;
  assertAutomationActive();
  if (!scope.headless) return false;
  scope.intervention = String(reason || "请完成人工验证").trim() || "请完成人工验证";
  throw new HumanInterventionRequiredError(scope.intervention);
}

function registerAutomationBrowser(browser) {
  const scope = getAutomationScope();
  if (scope) scope.browser = browser;
}

async function runInAutomationScope(scope, action) {
  if (!scope || typeof action !== "function") {
    throw new Error("启动浏览器采集作用域失败：缺少作用域或执行函数。");
  }
  scope.active = true;
  return automationScopes.run(scope, async () => {
    try {
      return await action(scope);
    } finally {
      scope.active = false;
    }
  });
}

module.exports = {
  resolveBrowserMode,
  resolveHumanTimeoutMs,
  getAutomationScope,
  getAutomationTime,
  assertAutomationActive,
  requireHeadedBrowser,
  registerAutomationBrowser,
  runInAutomationScope,
  HumanInterventionRequiredError
};
