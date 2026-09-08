// 仅在明确人工介入信号下切换一次；普通报错不重试，更不重置整轮汇总。
const {
  resolveBrowserMode, resolveHumanTimeoutMs, runInAutomationScope
} = require("../../engine/browserAutomationScope");
const { isApplicationShutdownRequested } = require("../../shared/applicationShutdownSignal");

async function runHybridSourceDownload(options, action) {
  const mode = resolveBrowserMode(options.mode);
  const isShutdownRequested = options.isShutdownRequested || isApplicationShutdownRequested;
  const scope = {
    platformKey: options.platformKey, headless: options.headless === true,
    humanTimeoutMs: resolveHumanTimeoutMs(options.humanTimeoutMs),
    onProgress: options.onProgress, isShutdownRequested,
    exportAttempted: false, intervention: ""
  };
  try {
    return await runInAutomationScope(scope, action);
  } catch (error) {
    if (!scope.headless || !scope.intervention || isShutdownRequested()) throw error;
    if (mode !== "hybrid") {
      const stopped = new Error(`${scope.intervention}；纯无头模式不会开窗，请用 npm run cli:headed 完成人工处理。`, { cause: error });
      stopped.code = "HEADLESS_REQUIRES_HUMAN";
      throw stopped;
    }
    options.onProgress?.("切换可见浏览器", `${scope.intervention}；正在保留账号资料并重建浏览器。`);
    // action 已完整退出（包括 finally 断连），再关闭旧进程，绝不同时占用同一资料目录。
    await options.openHeaded();
    if (isShutdownRequested()) throw error;
    if (scope.exportAttempted) {
      const uncertain = new Error("已打开可见浏览器，但此前可能已提交导出。为避免重复操作，本数据源未自动重试；请确认下载结果后单店重跑。", { cause: error });
      uncertain.code = "EXPORT_OUTCOME_UNCERTAIN";
      throw uncertain;
    }
    return runInAutomationScope({ ...scope, headless: false, intervention: "", exportAttempted: false, browser: null, lastHumanCheckAt: 0, guardPromise: null }, action);
  }
}

module.exports = { runHybridSourceDownload };
