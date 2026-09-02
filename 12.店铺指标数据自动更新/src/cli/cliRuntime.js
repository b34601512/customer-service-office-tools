const { initializeRuntimeLayout } = require("../config/runtimeLayoutService");
const { readStoreMetricConfig } = require("../config/storeMetricConfig");
const { closeManagedChrome } = require("../engine/chromeSession");
const { createControlCenterStateStore } = require("../controlCenter/controlCenterState");
const {
  revealLocalPath
} = require("../controlCenter/localFileApiParts/windowsLocalFileActions");
const { readTaskHistory } = require("../shared/taskHistoryParts/taskHistoryStore");
const { createCliTerminal } = require("./cliTerminal");
const { renderDashboard } = require("./cliDashboard");
const {
  showStoreManagementMenu,
  showDateSelectionMenu,
  showWorkbookSettingsMenu
} = require("./cliConfigMenus");
const { openRecentEvidenceFolder } = require("./cliEvidenceMenu");
const { runBatchTaskFromCli } = require("./cliTaskRunner");
const { showForceCollectionScopeMenu } = require("./cliCollectionScopeMenu");
const { showCliHelp } = require("./cliHelp");
const { showKdocsSyncMenu } = require("./cliKdocsSyncMenu");

async function handleCliMenuSelection({ selection, terminal, stateStore }) {
  if (selection === "1") await runBatchTaskFromCli({ terminal, stateStore });
  if (selection === "2") {
    const collectionScope = await showForceCollectionScopeMenu(terminal);
    if (collectionScope) {
      await runBatchTaskFromCli({ terminal, stateStore, forceRecollect: true, collectionScope });
    }
  }
  if (selection === "3") await showStoreManagementMenu(terminal);
  if (selection === "4") await showDateSelectionMenu(terminal);
  if (selection === "5") await showWorkbookSettingsMenu(terminal);
  if (selection === "6") await openRecentEvidenceFolder();
  if (selection === "7") await revealLocalPath(readStoreMetricConfig().workbook.path);
  if (selection === "8") await showCliHelp(terminal);
  if (selection === "a") await showKdocsSyncMenu(terminal);
}

async function startCliRuntime(dependencies = {}) {
  const initializeLayout = dependencies.initializeLayout || initializeRuntimeLayout;
  const terminal = dependencies.terminal || createCliTerminal();
  const stateStore = dependencies.stateStore || createControlCenterStateStore();
  const readConfig = dependencies.readConfig || readStoreMetricConfig;
  const readHistory = dependencies.readHistory || readTaskHistory;
  const handleSelection = dependencies.handleSelection || handleCliMenuSelection;
  const closeBrowser = dependencies.closeBrowser || closeManagedChrome;
  initializeLayout();
  process.title = "店铺指标自动更新 CLI";

  let exitRequested = false;
  async function requestSignalExit() {
    if (exitRequested) return;
    exitRequested = true;
    terminal.writeLine("\n正在安全退出……");
    await closeBrowser().catch(() => {});
    process.exit(0);
  }
  process.once("SIGINT", requestSignalExit);
  process.once("SIGTERM", requestSignalExit);

  try {
    while (!exitRequested) {
      renderDashboard({
        terminal,
        config: readConfig(),
        state: stateStore.read(),
        taskHistory: readHistory()
      });
      const selection = await terminal.prompt("请选择：");
      if (selection === "0") break;
      try {
        await handleSelection({ selection, terminal, stateStore });
      } catch (error) {
        terminal.writeLine(terminal.theme.error(`\n操作失败：${String(error?.message || error)}`));
        await terminal.pause();
      }
    }
  } finally {
    process.removeListener("SIGINT", requestSignalExit);
    process.removeListener("SIGTERM", requestSignalExit);
    await closeBrowser().catch(() => {});
  }
  terminal.writeLine(terminal.theme.muted("控制台已退出。"));
  return stateStore.read();
}

module.exports = {
  handleCliMenuSelection,
  startCliRuntime
};
