function createRestartableAssistRunner(runTask) {
  // 这里把“辅助线程可重启、过期任务自动失效”收口成统一引擎，避免各平台各写一套单例状态机。
  if (typeof runTask !== "function") {
    throw new Error("创建可重启辅助线程失败：缺少有效的任务函数。");
  }

  let activeGeneration = 0;
  let activePromise = null;

  function start(options = {}) {
    const forceRestart = Boolean(options.forceRestart);
    if (activePromise && !forceRestart) {
      return activePromise;
    }

    activeGeneration += 1;
    const currentGeneration = activeGeneration;
    const runnerPromise = Promise.resolve().then(() =>
      runTask({
        generation: currentGeneration,
        isCurrent() {
          return currentGeneration === activeGeneration;
        }
      }, options)
    );
    const trackedPromise = runnerPromise.finally(() => {
      if (activePromise === trackedPromise) {
        activePromise = null;
      }
    });

    activePromise = trackedPromise;
    return trackedPromise;
  }

  function isRunning() {
    return Boolean(activePromise);
  }

  function cancel() {
    // 这里允许外部主动废弃当前辅助任务，供切店等“全量重置运行态”场景直接中断上一轮线程。
    activeGeneration += 1;
    activePromise = null;
  }

  return {
    start,
    cancel,
    isRunning,
    getActiveGeneration() {
      return activeGeneration;
    }
  };
}

module.exports = {
  createRestartableAssistRunner
};
