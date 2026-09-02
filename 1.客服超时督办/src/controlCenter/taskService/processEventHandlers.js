const { currentLogFilePath, log } = require("../../engine/logger");

function notifyTaskExit(taskService, payload, taskWindowLabel) {
  // 这里统一执行任务退出回调，避免 error 和 exit 两条分支各写一遍容错代码。
  if (!taskService.onTaskExit) {
    return;
  }

  try {
    taskService.onTaskExit(payload);
  } catch (callbackError) {
    log(
      "主线:失败",
      "网页控制台",
      `任务:${taskWindowLabel}`,
      `任务退出回调执行失败：${callbackError.message}`
    );
  }
}

function handleChildProcessError(taskService, child, taskConfig, taskState, taskRunId, taskName, error) {
  // 这里只处理子进程启动异常，避免旧任务异步事件污染新任务状态。
  if (!taskService.isCurrentProcess(child, taskRunId)) {
    log("主线:等待", "网页控制台", `任务:${taskConfig.windowLabel}`, `忽略已接管任务的错误事件：${error.message}`);
    return;
  }

  const errorMessage = `任务「${taskConfig.windowLabel}」启动失败：${error.message}`;
  log("主线:失败", "网页控制台", `任务:${taskConfig.windowLabel}`, errorMessage);
  taskService.currentProcess = null;
  log(
    "主线:等待",
    "网页控制台",
    `任务:${taskConfig.windowLabel}`,
    `子进程启动阶段异常，请查看网页日志或本次日志：${currentLogFilePath}`
  );
  taskService.state.setTask({
    taskName,
    label: taskConfig.windowLabel,
    startedAt: taskState.startedAt,
    endedAt: new Date().toISOString(),
    status: "failed",
    awaitingConfirmation: false,
    message: errorMessage,
    pid: child.pid || 0
  });

  notifyTaskExit(taskService, {
    taskName,
    label: taskConfig.windowLabel,
    code: null,
    signal: null,
    status: "failed",
    exitMessage: errorMessage
  }, taskConfig.windowLabel);
}

function handleChildProcessExit(taskService, child, taskConfig, taskState, taskRunId, taskName, code, signal) {
  // 这里只处理当前子进程退出，旧任务退出事件一律忽略。
  if (!taskService.isCurrentProcess(child, taskRunId)) {
    log("主线:等待", "网页控制台", `任务:${taskConfig.windowLabel}`, "忽略已接管任务的退出事件");
    return;
  }

  const stopReason = taskService.pendingStopReason;
  const finalStatus = stopReason || code === 0 ? "idle" : "failed";
  const exitMessage = stopReason
    ? taskService.pendingStopReason
    : code === 0
      ? `任务「${taskConfig.windowLabel}」已结束。`
      : `任务「${taskConfig.windowLabel}」异常结束，退出码=${code ?? "null"}，信号=${signal ?? "null"}。`;
  log(
    finalStatus === "failed" ? "主线:失败" : "主线:完成",
    "网页控制台",
    `任务:${taskConfig.windowLabel}`,
    exitMessage
  );
  if (finalStatus === "failed") {
    log(
      "主线:等待",
      "网页控制台",
      `任务:${taskConfig.windowLabel}`,
      `后台任务已异常退出，控制台已保留，请查看网页日志或本次日志：${currentLogFilePath}`
    );
  }
  taskService.currentProcess = null;
  taskService.pendingStopReason = null;
  taskService.state.setTask({
    taskName,
    label: taskConfig.windowLabel,
    startedAt: taskState.startedAt,
    endedAt: new Date().toISOString(),
    status: finalStatus,
    awaitingConfirmation: false,
    message: exitMessage,
    pid: child.pid
  });

  notifyTaskExit(taskService, {
    taskName,
    label: taskConfig.windowLabel,
    code,
    signal,
    status: finalStatus,
    exitMessage
  }, taskConfig.windowLabel);
}

function attachTaskProcessEventHandlers(taskService, child, taskConfig, taskState, taskRunId, taskName) {
  // 这里集中绑定子进程生命周期事件，任务服务类只保留调度动作。
  child.on("error", (error) => {
    handleChildProcessError(taskService, child, taskConfig, taskState, taskRunId, taskName, error);
  });

  child.on("exit", (code, signal) => {
    handleChildProcessExit(taskService, child, taskConfig, taskState, taskRunId, taskName, code, signal);
  });
}

module.exports = {
  attachTaskProcessEventHandlers,
  handleChildProcessError,
  handleChildProcessExit,
  notifyTaskExit
};
