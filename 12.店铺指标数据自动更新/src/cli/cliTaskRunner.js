const { runConfiguredStoresTask } = require("../controlCenter/controlCenterTask");
const { DIVIDER } = require("./cliDashboard");
const {
  normalizeStoreCollectionScope,
  formatStoreCollectionScope
} = require("../shared/storeCollectionScope");

function formatClockTime(isoTime) {
  const parsedTime = new Date(isoTime || Date.now());
  return parsedTime.toLocaleTimeString("zh-CN", { hour12: false });
}

function formatStoreResultLine(terminal, storeResult) {
  if (storeResult.status === "success") {
    const skippedText = storeResult.skippedCount > 0 ? ` · 跳过${storeResult.skippedCount}项` : "";
    return `${terminal.theme.success("[完成]")} ${storeResult.storeName} · ${storeResult.metricCount} 项${skippedText}`;
  }
  if (storeResult.status === "skipped") {
    return `${terminal.theme.muted("[跳过]")} ${storeResult.storeName} · 今日已有 ${storeResult.previousMetricCount || 0} 项`;
  }
  if (storeResult.status === "error") {
    return `${terminal.theme.error("[失败]")} ${storeResult.storeName} · ${storeResult.detail}`;
  }
  return `${terminal.theme.warning("[等待]")} ${storeResult.storeName}`;
}

function createProgressReporter(terminal) {
  let previousProgressSignature = "";
  return function reportProgress(state) {
    if (state.status !== "running") return;
    const progressSignature = `${state.stage}|${state.detail}`;
    if (progressSignature === previousProgressSignature) return;
    previousProgressSignature = progressSignature;
    terminal.writeLine(
      `${terminal.theme.muted(`[${formatClockTime()}]`)} ${terminal.theme.accent(state.stage)} · ${state.detail}`
    );
  };
}

function renderBatchResult(terminal, state) {
  terminal.writeLine();
  const finished = state.status === "success";
  const hasFailures = state.status === "error" || state.status === "partial_error";
  const resultHeading = finished
    ? terminal.theme.success("本次结果")
    : hasFailures
      ? terminal.theme.error("本次结果")
      : terminal.theme.heading("本次结果");
  terminal.writeLine(resultHeading);
  terminal.writeLine(terminal.theme.muted(DIVIDER));
  for (const storeResult of state.storeResults || []) {
    terminal.writeLine(formatStoreResultLine(terminal, storeResult));
  }
  terminal.writeLine(terminal.theme.muted(DIVIDER));
  const detailText = state.detail || "任务已结束。";
  terminal.writeLine(
    finished
      ? terminal.theme.success(detailText)
      : hasFailures
        ? terminal.theme.error(detailText)
        : detailText
  );
  const evidenceCount = (state.storeResults || [])
    .reduce((totalCount, storeResult) => totalCount + (storeResult.evidenceFiles || []).length, 0) +
    (state.error?.evidenceFiles || []).length;
  if (evidenceCount) terminal.writeLine(`凭证 ${evidenceCount} 份，可在首页[6]打开凭证文件夹查看。`);
}

async function runBatchTaskFromCli({
  terminal,
  stateStore,
  runTask = runConfiguredStoresTask,
  forceRecollect = false,
  collectionScope
}) {
  const normalizedCollectionScope = normalizeStoreCollectionScope(collectionScope);
  const scopeDescription = formatStoreCollectionScope(normalizedCollectionScope);
  terminal.clear();
  terminal.writeLine(terminal.theme.title(
    forceRecollect ? `店铺指标强制重新采集 · ${scopeDescription}` : "店铺指标批量汇总"
  ));
  terminal.writeLine(terminal.theme.muted(DIVIDER));
  terminal.writeLine(
    forceRecollect
      ? `本轮会重新读取${scopeDescription}；相同记录键覆盖，新增记录追加。遇到安全验证会原地等待。\n`
      : "程序将按平台和店铺顺序执行；遇到安全验证会在独立浏览器原地等待。\n"
  );
  const unsubscribe = stateStore.subscribe(createProgressReporter(terminal));
  try {
    await runTask(stateStore, { forceRecollect, collectionScope: normalizedCollectionScope });
  } catch (error) {
    terminal.writeLine(terminal.theme.error(`\n汇总停止：${String(error?.message || error)}`));
  } finally {
    unsubscribe();
  }
  renderBatchResult(terminal, stateStore.read());
  await terminal.pause();
  return stateStore.read();
}

module.exports = {
  formatClockTime,
  formatStoreResultLine,
  createProgressReporter,
  renderBatchResult,
  runBatchTaskFromCli
};
