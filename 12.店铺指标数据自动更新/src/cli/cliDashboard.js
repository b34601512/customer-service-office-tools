const path = require("path");
const {
  createStoreMetricRunScope,
  doesStoreMetricRunMatchScope
} = require("../shared/taskHistoryParts/storeMetricRunHistory");
const { isKdocsSyncConfigured } = require("../kdocsSync/kdocsSyncSettings");
const { PLATFORM_SCOPE_DEFINITIONS } = require("../shared/storeCollectionScope");
const { CLI_VERSION } = require("./cliConstants");

const DIVIDER = "─".repeat(68);

function formatDateSelection(dateSelection) {
  if (dateSelection?.mode === "manual") {
    return `手动单日 · ${dateSelection.manual?.snapshotDate || "未设置"}`;
  }
  return "智能 · 自动读取页面最新可用口径";
}

function listEnabledDashboardStores(config) {
  return [
    ...(config?.jd?.stores || []).map((store) => ({ ...store, platformKey: "jd" })),
    ...(config?.tmall?.stores || []).map((store) => ({ ...store, platformKey: "tmall" })),
    ...(config?.pdd?.stores || []).map((store) => ({ ...store, platformKey: "pdd" })),
    ...(config?.douyin?.stores || []).map((store) => ({ ...store, platformKey: "douyin" }))
  ].filter((store) => store.enabled !== false);
}

function getStoreCompletionSummary(config, taskHistory, now = new Date()) {
  const dateSelection = config?.dateSelection?.mode === "manual"
    ? { mode: "manual", snapshotDate: config.dateSelection.manual?.snapshotDate || "" }
    : { mode: "automatic", snapshotDate: "" };
  const enabledStores = listEnabledDashboardStores(config);
  const completedStores = enabledStores.filter((store) => {
    const scope = createStoreMetricRunScope({
      store,
      dateSelection,
      workbookPath: config?.workbook?.path,
      now
    });
    return (taskHistory?.storeMetricRuns || []).some((record) =>
      doesStoreMetricRunMatchScope(record, scope));
  });
  const completedKeys = new Set(completedStores.map((store) => `${store.platformKey}:${store.key}`));
  return {
    enabledStores,
    completedStores,
    pendingStores: enabledStores.filter((store) => !completedKeys.has(`${store.platformKey}:${store.key}`))
  };
}

function countCompletedStoresToday(config, taskHistory, now = new Date()) {
  return getStoreCompletionSummary(config, taskHistory, now).completedStores.length;
}

function splitDashboardStoreNames(storeNames, maxCharacters = 58) {
  const lines = [];
  let currentLine = "";
  for (const storeName of storeNames) {
    const nextLine = currentLine ? `${currentLine}、${storeName}` : storeName;
    if (currentLine && nextLine.length > maxCharacters) {
      lines.push(currentLine);
      currentLine = storeName;
    } else {
      currentLine = nextLine;
    }
  }
  if (currentLine) lines.push(currentLine);
  return lines;
}

function renderStoreCompletionSummary(terminal, completionSummary) {
  const groups = [
    ["已完成", completionSummary.completedStores],
    ["未完成", completionSummary.pendingStores]
  ];
  for (const [label, stores] of groups) {
    const colorize = label === "已完成" ? terminal.theme.success : terminal.theme.error;
    const names = stores.map((store) => store.displayName || store.key || "未命名店铺");
    const wrappedNames = splitDashboardStoreNames(names);
    if (!wrappedNames.length) {
      terminal.writeLine(`${colorize(label)}  暂无`);
      continue;
    }
    terminal.writeLine(`${colorize(label)}  ${colorize(wrappedNames[0])}`);
    for (const wrappedName of wrappedNames.slice(1)) {
      terminal.writeLine(`        ${colorize(wrappedName)}`);
    }
  }
}

function formatRecentResult(terminal, state, taskHistory) {
  if (state?.result) {
    const collectedText = terminal.theme.success(`新采集 ${state.result.collectedCount} 家`);
    const skippedText = state.result.skippedCount > 0
      ? `，跳过 ${state.result.skippedCount} 家`
      : "";
    const failedCount = state.result.errorCount || 0;
    const failedText = failedCount > 0
      ? `，${terminal.theme.error(`失败 ${failedCount} 家`)}`
      : "";
    return `${collectedText}${skippedText}${failedText}`;
  }
  const recentRecord = (taskHistory?.storeMetricRuns || [])[0];
  if (!recentRecord) return "暂无运行记录";
  return `${recentRecord.storeDisplayName || recentRecord.storeKey} · ${recentRecord.metricCount} 项 · ${recentRecord.runDate}`;
}

function formatEnabledPlatformCounts(config) {
  return PLATFORM_SCOPE_DEFINITIONS.map((definition) => {
    const enabledCount = (config?.[definition.platformKey]?.stores || []).filter((store) => store.enabled !== false).length;
    return `${definition.platformName} ${enabledCount} 家`;
  }).join("    ");
}

function renderDashboard({ terminal, config, state, taskHistory, now = new Date() }) {
  const completionSummary = getStoreCompletionSummary(config, taskHistory, now);
  const enabledStores = completionSummary.enabledStores;
  const completedStoreCount = completionSummary.completedStores.length;
  const workbookName = path.basename(config?.workbook?.path || "未设置");
  terminal.clear();
  terminal.writeLine(terminal.theme.title(`店铺指标自动更新  ${CLI_VERSION}`));
  terminal.writeLine(terminal.theme.muted(DIVIDER));
  terminal.writeLine(`${terminal.theme.heading("运行状态")}  ${terminal.theme.status(state?.status)}`);
  terminal.writeLine(`启用店铺  ${enabledStores.length} 家    今日完成  ${completedStoreCount}/${enabledStores.length} 家`);
  renderStoreCompletionSummary(terminal, completionSummary);
  terminal.writeLine(`平台分布  ${formatEnabledPlatformCounts(config)}`);
  terminal.writeLine(`日期方式  ${formatDateSelection(config?.dateSelection)}`);
  terminal.writeLine(`汇总文件  ${workbookName}`);
  terminal.writeLine(`金山同步  ${isKdocsSyncConfigured(config?.kdocsDataSourceSync) ? "已配置" : "未配置"}`);
  terminal.writeLine(`最近结果  ${formatRecentResult(terminal, state, taskHistory)}`);
  terminal.writeLine(terminal.theme.muted(DIVIDER));
  terminal.writeLine(terminal.theme.heading("操作"));
  terminal.writeLine("  [1] 开始汇总       [2] 强制重新采集");
  terminal.writeLine("  [3] 店铺管理       [4] 日期方式");
  terminal.writeLine("  [5] 汇总表设置     [6] 最近凭证");
  terminal.writeLine("  [7] 打开汇总文件夹 [8] 使用说明");
  terminal.writeLine("  [A] 金山文档同步");
  terminal.writeLine("  [0] 退出");
  terminal.writeLine(terminal.theme.muted(DIVIDER));
}

module.exports = {
  DIVIDER,
  formatDateSelection,
  listEnabledDashboardStores,
  getStoreCompletionSummary,
  countCompletedStoresToday,
  splitDashboardStoreNames,
  renderStoreCompletionSummary,
  formatRecentResult,
  formatEnabledPlatformCounts,
  renderDashboard
};
