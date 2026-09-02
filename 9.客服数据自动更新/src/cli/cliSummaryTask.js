const { log, logError } = require("../engine/logger");
const {
  getControlCenterState,
  patchControlCenterState
} = require("../controlCenter/controlCenterState");
const { buildConfiguredSummaryTasks } = require("../controlCenter/summaryTaskPlanner");
const { readProjectConfig } = require("../config/projectConfigServiceParts/projectConfigPersistence");
const {
  runConfiguredSummaryWorkflow
} = require("../summary/configuredWorkflowParts/configuredSummaryRunner");

function replaceSummaryTask(summaryTasks, partialTask) {
  const taskId = String(partialTask?.id || "").trim();
  if (!taskId) throw new Error("更新汇总任务失败：任务编号不能为空。");
  const existingTask = summaryTasks.find((task) => task.id === taskId);
  const nextTask = { ...(existingTask || {}), ...partialTask, id: taskId };
  return existingTask
    ? summaryTasks.map((task) => task.id === taskId ? nextTask : task)
    : [...summaryTasks, nextTask];
}

function patchSummaryTaskProgress(partialTask) {
  const currentState = getControlCenterState();
  const summaryTasks = replaceSummaryTask(currentState.summaryTasks || [], partialTask);
  patchControlCenterState({
    summaryTasks,
    lastAction: partialTask.action || currentState.lastAction || "",
    lastError: partialTask.status === "error"
      ? partialTask.detail || currentState.lastError || ""
      : currentState.lastError || ""
  });
}

function resetSummaryTasksForCliRun(tasks) {
  patchControlCenterState({
    summaryTasks: tasks.map((task) => ({
      ...task,
      status: "ready",
      action: "等待开始",
      detail: `将自动取得${task.storeDisplayName}所需源表并追加到数据明细。`,
      downloadedPath: "",
      sourceFiles: [],
      workbookPath: "",
      updatedAt: "",
      evidenceFiles: []
    })),
    summaryRunStartedAt: "",
    summaryRunFinishedAt: "",
    summaryRunDurationMs: 0,
    summaryResult: null,
    lastAction: "准备开始批量汇总",
    lastError: ""
  });
}

function isSummaryTaskRunning() {
  const state = getControlCenterState();
  return Boolean(state.summaryRunStartedAt) && !state.summaryRunFinishedAt &&
    (state.summaryTasks || []).some((task) => task.status === "running");
}

function selectConfiguredSummaryTasks(configuredSummaryTasks, selectedSummaryTaskIds) {
  // 这个函数只按本次菜单选择缩小汇总范围；未指定范围时保留普通全店汇总。
  if (!Array.isArray(selectedSummaryTaskIds)) return configuredSummaryTasks;
  const selectedSummaryTaskIdSet = new Set(
    selectedSummaryTaskIds.map((taskId) => String(taskId || "").trim()).filter(Boolean)
  );
  return configuredSummaryTasks.filter((task) => selectedSummaryTaskIdSet.has(task.id));
}

async function runConfiguredSummaryTask(dependencies = {}) {
  if (isSummaryTaskRunning()) throw new Error("客服店铺正在批量汇总，请勿重复运行。");
  const readConfig = dependencies.readProjectConfig || readProjectConfig;
  const buildTasks = dependencies.buildConfiguredSummaryTasks || buildConfiguredSummaryTasks;
  const runWorkflow = dependencies.runConfiguredSummaryWorkflow || runConfiguredSummaryWorkflow;
  const nowFn = dependencies.nowFn || (() => new Date());
  const projectConfig = readConfig();
  const configuredTasks = selectConfiguredSummaryTasks(
    buildTasks(projectConfig),
    dependencies.selectedSummaryTaskIds
  );
  const forceRedownload = dependencies.forceRedownload === true;
  const runActionLabel = forceRedownload ? "强制重新下载并汇总" : "开始汇总";
  if (!configuredTasks.length) throw new Error("本次汇总清单为空，请先启用至少一家店铺和一个客服指标。");
  resetSummaryTasksForCliRun(configuredTasks);
  const startedAt = nowFn();
  patchControlCenterState({
    projectConfig,
    summaryRunStartedAt: startedAt.toISOString(),
    lastAction: `${runActionLabel}：${configuredTasks.length} 家店铺`
  });
  try {
    log("主线:执行", "CLI批量汇总", runActionLabel, `本次共 ${configuredTasks.length} 家店铺`);
    const result = await runWorkflow({
      projectConfig,
      tasks: configuredTasks,
      forceRedownload,
      // 单店重跑不重置（复用今天文件重写该店）；开始全部汇总才执行本轮重置。
      resetForToday: !Array.isArray(dependencies.selectedSummaryTaskIds) || dependencies.selectedSummaryTaskIds.length === 0,
      onTaskProgress: patchSummaryTaskProgress
    });
    const finishedAt = nowFn();
    patchControlCenterState({
      lastAction: result.detail,
      lastError: result.errorCount ? result.detail : "",
      summaryRunFinishedAt: finishedAt.toISOString(),
      summaryRunDurationMs: finishedAt.getTime() - startedAt.getTime(),
      summaryResult: result
    });
    log("主线:完成", "CLI批量汇总", runActionLabel, result.detail);
    return result;
  } catch (error) {
    const finishedAt = nowFn();
    const errorMessage = String(error?.message || error);
    patchControlCenterState({
      lastAction: "批量汇总失败",
      lastError: errorMessage,
      summaryRunFinishedAt: finishedAt.toISOString(),
      summaryRunDurationMs: finishedAt.getTime() - startedAt.getTime(),
      summaryResult: null
    });
    logError("主线:失败", "CLI批量汇总", "开始汇总", error);
    throw error;
  }
}

module.exports = {
  replaceSummaryTask,
  patchSummaryTaskProgress,
  resetSummaryTasksForCliRun,
  isSummaryTaskRunning,
  selectConfiguredSummaryTasks,
  runConfiguredSummaryTask
};
