// 只负责“无头采集 -> 人工接管 -> 有头重试”的浏览器生命周期，不包含任何平台业务规则。
const {
  resolveBrowserMode,
  resolveHumanTimeoutMs,
  runInAutomationScope
} = require("../engine/browserAutomationScope");

function buildHeadlessInterventionError(scope, cause) {
  const error = new Error(
    `${scope.intervention}；当前为纯无头模式，不会自动开窗，请改用 hybrid 或 headed 模式完成人工处理。`
  );
  error.code = "HEADLESS_REQUIRES_HUMAN";
  error.cause = cause;
  return error;
}

async function runHybridStoreCollection(options = {}, action) {
  if (typeof action !== "function") {
    throw new Error("启动店铺混合采集失败：缺少店铺采集函数。");
  }
  const mode = resolveBrowserMode(options.mode);
  const initialScope = {
    platformKey: String(options.platformKey || "").trim(),
    headless: mode !== "headed",
    humanTimeoutMs: resolveHumanTimeoutMs(options.humanTimeoutMs),
    onProgress: options.onProgress,
    isShutdownRequested: options.isShutdownRequested,
    intervention: "",
    browser: null,
    humanWaitMs: 0,
    lastHumanCheckAt: 0,
    guardPromise: null
  };

  try {
    return await runInAutomationScope(initialScope, action);
  } catch (error) {
    if (!initialScope.headless || !initialScope.intervention) throw error;
    if (mode !== "hybrid") throw buildHeadlessInterventionError(initialScope, error);
    if (typeof options.openHeaded !== "function") {
      const handoffError = new Error("无头采集需要人工接管，但未提供有头浏览器重建入口。");
      handoffError.cause = error;
      throw handoffError;
    }

    options.onProgress?.("切换可见浏览器", `${initialScope.intervention}；正在保留账号资料并重建 Edge。`);
    await options.openHeaded();
    const headedScope = {
      ...initialScope,
      headless: false,
      intervention: "",
      browser: null,
      lastHumanCheckAt: 0,
      guardPromise: null
    };
    return runInAutomationScope(headedScope, action);
  }
}

module.exports = {
  runHybridStoreCollection,
  buildHeadlessInterventionError
};
