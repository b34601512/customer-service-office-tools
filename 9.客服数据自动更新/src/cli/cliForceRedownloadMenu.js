const { readProjectConfig } = require("../config/projectConfigServiceParts/projectConfigPersistence");
const { buildConfiguredSummaryTasks } = require("../controlCenter/summaryTaskPlanner");
const { DIVIDER } = require("./cliDashboard");
const { runConfiguredSummaryTask } = require("./cliSummaryTask");
const { runBatchTaskFromCli } = require("./cliTaskRunner");

function resolveForceRedownloadSelection(selection, configuredSummaryTasks) {
  // 这个函数只把一次菜单输入转换成返回、单店或全部店铺范围。
  const normalizedSelection = String(selection || "").trim().toLowerCase();
  const safeConfiguredSummaryTasks = Array.isArray(configuredSummaryTasks) ? configuredSummaryTasks : [];
  if (normalizedSelection === "0") return { kind: "back", selectedSummaryTaskIds: [] };
  if (normalizedSelection === "a") {
    return {
      kind: "run",
      selectedSummaryTaskIds: safeConfiguredSummaryTasks.map((task) => task.id),
      selectedScopeLabel: `全部 ${safeConfiguredSummaryTasks.length} 家已启用店铺`
    };
  }
  if (!/^\d+$/.test(normalizedSelection)) return { kind: "invalid", selectedSummaryTaskIds: [] };
  const selectedSummaryTask = safeConfiguredSummaryTasks[Number(normalizedSelection) - 1];
  if (!selectedSummaryTask) return { kind: "invalid", selectedSummaryTaskIds: [] };
  return {
    kind: "run",
    selectedSummaryTaskIds: [selectedSummaryTask.id],
    selectedScopeLabel: `${selectedSummaryTask.platformLabel} · ${selectedSummaryTask.storeDisplayName}`
  };
}

function renderForceRedownloadMenu(terminal, configuredSummaryTasks) {
  // 这个函数只展示本次可强制处理的店铺清单。
  terminal.clear();
  terminal.writeLine(terminal.theme.title("强制重新下载并汇总"));
  terminal.writeLine(terminal.theme.muted(DIVIDER));
  terminal.writeLine("本操作会忽略旧源表，只对本次运行生效；日期仍使用当前店铺设置。 ");
  terminal.writeLine(`  [A] 全部已启用店铺（${configuredSummaryTasks.length} 家）`);
  configuredSummaryTasks.forEach((task, taskIndex) => {
    terminal.writeLine(`  [${taskIndex + 1}] ${task.platformLabel} · ${task.storeDisplayName} · ${task.exportDateRangeText || "日期未配置"}`);
  });
  terminal.writeLine("  [0] 返回首页");
  terminal.writeLine(terminal.theme.muted(DIVIDER));
}

async function showForceRedownloadMenu(terminal, dependencies = {}) {
  // 这个函数只完成一次强制重下范围选择，并把所选范围交给现有汇总界面执行。
  const readConfig = dependencies.readProjectConfig || readProjectConfig;
  const buildTasks = dependencies.buildConfiguredSummaryTasks || buildConfiguredSummaryTasks;
  const runSummaryTask = dependencies.runConfiguredSummaryTask || runConfiguredSummaryTask;
  const runBatchTask = dependencies.runBatchTaskFromCli || runBatchTaskFromCli;
  const configuredSummaryTasks = buildTasks(readConfig());
  if (!configuredSummaryTasks.length) {
    terminal.writeLine(terminal.theme.error("当前没有已启用店铺，请先在平台/店铺管理中启用。 "));
    await terminal.pause();
    return null;
  }
  renderForceRedownloadMenu(terminal, configuredSummaryTasks);
  const resolvedSelection = resolveForceRedownloadSelection(
    await terminal.prompt("请选择要强制重新下载的范围："),
    configuredSummaryTasks
  );
  if (resolvedSelection.kind === "back") return null;
  if (resolvedSelection.kind === "invalid") {
    terminal.writeLine(terminal.theme.error("选择无效，本次没有启动任何店铺。 "));
    await terminal.pause();
    return null;
  }
  return runBatchTask({
    terminal,
    title: "强制重新下载并汇总",
    introduction: `本次范围：${resolvedSelection.selectedScopeLabel}。将忽略旧源表，重新下载后写入汇总表。`,
    runTask: () => runSummaryTask({
      selectedSummaryTaskIds: resolvedSelection.selectedSummaryTaskIds,
      forceRedownload: true
    })
  });
}

module.exports = {
  resolveForceRedownloadSelection,
  renderForceRedownloadMenu,
  showForceRedownloadMenu
};
