const { getControlCenterState, subscribeControlCenterState } = require("../controlCenter/controlCenterState");
const { runConfiguredSummaryTask } = require("./cliSummaryTask");
const { DIVIDER } = require("./cliDashboard");

function formatClockTime(isoTime = new Date().toISOString()) {
  return new Date(isoTime).toLocaleTimeString("zh-CN", { hour12: false });
}

function createProgressReporter(terminal) {
  const previousSignatureByTaskId = new Map();
  return function reportProgress(state) {
    for (const task of state.summaryTasks || []) {
      const signature = `${task.status}|${task.action}|${task.detail}`;
      if (signature === previousSignatureByTaskId.get(task.id)) continue;
      previousSignatureByTaskId.set(task.id, signature);
      if (!task.updatedAt && task.status === "ready") continue;
      const prefix = task.status === "success" ? terminal.theme.success("[完成]") : task.status === "error" ? terminal.theme.error("[失败]") : terminal.theme.warning("[运行]");
      terminal.writeLine(`${terminal.theme.muted(`[${formatClockTime(task.updatedAt)}]`)} ${prefix} ${task.platformLabel} · ${task.storeDisplayName} · ${task.action || task.detail}`);
    }
  };
}

function renderTaskResult(terminal, state) {
  terminal.writeLine(); terminal.writeLine(terminal.theme.heading("本次结果")); terminal.writeLine(terminal.theme.muted(DIVIDER));
  for (const task of state.summaryTasks || []) {
    const prefix = task.status === "success" ? terminal.theme.success("[完成]") : task.status === "error" ? terminal.theme.error("[失败]") : terminal.theme.muted("[未执行]");
    terminal.writeLine(`${prefix} ${task.platformLabel} · ${task.storeDisplayName} · ${task.detail || task.action}`);
  }
  terminal.writeLine(terminal.theme.muted(DIVIDER));
  terminal.writeLine(state.summaryResult?.detail || state.lastError || state.lastAction || "任务已结束。 ");
  const evidenceCount = (state.summaryTasks || []).reduce((count, task) => count + (task.evidenceFiles || []).length, 0);
  if (evidenceCount) terminal.writeLine(`凭证 ${evidenceCount} 份，可在首页[6]打开凭证文件夹查看。`);
}

async function runBatchTaskFromCli({
  terminal,
  runTask = runConfiguredSummaryTask,
  title = "多平台客服数据批量汇总",
  introduction = "程序将按天猫、京东、拼多多、抖音及店铺顺序运行。出现滑块或安全验证时，浏览器会停在原地等待人工处理。"
} = {}) {
  terminal.clear(); terminal.writeLine(terminal.theme.title(title)); terminal.writeLine(terminal.theme.muted(DIVIDER));
  terminal.writeLine(`${introduction}\n`);
  const unsubscribe = subscribeControlCenterState(createProgressReporter(terminal));
  try { await runTask(); } catch (error) { terminal.writeLine(terminal.theme.error(`\n汇总停止：${String(error?.message || error)}`)); } finally { unsubscribe(); }
  const finalState = getControlCenterState(); renderTaskResult(terminal, finalState); await terminal.pause(); return finalState;
}

module.exports = { formatClockTime, createProgressReporter, renderTaskResult, runBatchTaskFromCli };
