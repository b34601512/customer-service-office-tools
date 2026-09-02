const fs = require("fs");
const path = require("path");
const { initializeRuntimeLayout } = require("../config/runtimeLayoutService");
const { initializeProjectConfigForStartup } = require("../config/projectConfigServiceParts/projectConfigInitialization");
const { readProjectConfig } = require("../config/projectConfigServiceParts/projectConfigPersistence");
const { getControlCenterState, patchControlCenterState } = require("../controlCenter/controlCenterState");
const { revealLocalPath } = require("../controlCenter/localFileApiParts/windowsLocalFileActions");
const { resetApplicationShutdownSignal } = require("../shared/applicationShutdownSignal");
const { createCliTerminal } = require("./cliTerminal");
const { renderDashboard } = require("./cliDashboard");
const { showStoreManagementMenu, showDateSelectionMenu, showWorkbookSettingsMenu, showDownloadRootSettingsMenu } = require("./cliConfigMenus");
const { showPersonMappingMenu } = require("./cliPersonMappingMenu");
const { showEvidenceFolderMenu } = require("./cliEvidenceMenu");
const { showCliHelp } = require("./cliHelp");
const { scheduleStartupCleanup, ensureStartupCleanupDone } = require("./cliStartupCleanup");
// 说明：汇总执行链路（playwright）、金山同步（xlsx）、退出收尾（Chrome 会话）都是重依赖，
// 改为在真正使用时才 require，控制台首屏从约1.4秒降到约0.4秒。

function resolveExistingDirectory(targetPath, fallbackDirectory) {
  const normalizedPath = String(targetPath || "").trim();
  if (normalizedPath && fs.existsSync(normalizedPath)) {
    return fs.statSync(normalizedPath).isDirectory() ? normalizedPath : path.dirname(normalizedPath);
  }
  if (normalizedPath && fs.existsSync(path.dirname(normalizedPath))) return path.dirname(normalizedPath);
  return fallbackDirectory;
}

async function openWorkbookDirectory() {
  const projectConfig = readProjectConfig();
  await revealLocalPath(resolveExistingDirectory(projectConfig.workbook.path, process.cwd()));
}

async function openDownloadRootDirectory() {
  const projectConfig = readProjectConfig();
  const downloadRootDir = projectConfig.globalDefaults.downloadRootDir;
  fs.mkdirSync(downloadRootDir, { recursive: true });
  await revealLocalPath(downloadRootDir);
}

async function refreshExistingPersonRoles(terminal) {
  const { refreshDataDetailPersonRoles } = require("../controlCenter/controlCenterPersonRoleRefresh");
  terminal.clear(); terminal.writeLine(terminal.theme.title("更新已有明细岗位"));
  terminal.writeLine("此操作只按当前客服设置更新汇总表里已有明细的售前/售后岗位，不修改指标。 ");
  const answer = await terminal.prompt("确认执行？输入 y：");
  if (answer !== "y") return;
  const result = await refreshDataDetailPersonRoles(readProjectConfig());
  patchControlCenterState({ lastAction: `已有明细岗位已更新${result?.updatedRowCount !== undefined ? `：${result.updatedRowCount} 行` : ""}`, lastError: "" });
  terminal.writeLine(terminal.theme.success("更新完成。 ")); await terminal.pause();
}

async function handleCliMenuSelection({ selection, terminal }) {
  if (selection === "1") {
    await ensureStartupCleanupDone();
    const { runBatchTaskFromCli } = require("./cliTaskRunner");
    await runBatchTaskFromCli({ terminal });
  }
  if (selection === "2") await showStoreManagementMenu(terminal);
  if (selection === "3") await showDateSelectionMenu(terminal);
  if (selection === "4") await showWorkbookSettingsMenu(terminal);
  if (selection === "5") await showPersonMappingMenu(terminal);
  if (selection === "6") await showEvidenceFolderMenu(terminal, readProjectConfig());
  if (selection === "7") await openWorkbookDirectory();
  if (selection === "8") {
    terminal.clear(); terminal.writeLine("  [1] 打开当前目录    [2] 修改根目录    [0] 返回");
    const answer = await terminal.prompt("请选择：");
    if (answer === "1") await openDownloadRootDirectory();
    if (answer === "2") await showDownloadRootSettingsMenu(terminal);
  }
  if (selection === "9") await refreshExistingPersonRoles(terminal);
  if (selection === "a") {
    const { showKdocsSyncMenu } = require("./cliKdocsSyncMenu");
    await showKdocsSyncMenu(terminal);
  }
  if (selection === "b") {
    await ensureStartupCleanupDone();
    const { showForceRedownloadMenu } = require("./cliForceRedownloadMenu");
    await showForceRedownloadMenu(terminal);
  }
  if (selection === "h") await showCliHelp(terminal);
}

async function startCliRuntime(dependencies = {}) {
  const terminal = dependencies.terminal || createCliTerminal();
  const initializeLayout = dependencies.initializeRuntimeLayout || initializeRuntimeLayout;
  const initializeConfig = dependencies.initializeProjectConfigForStartup || initializeProjectConfigForStartup;
  const handleSelection = dependencies.handleCliMenuSelection || handleCliMenuSelection;
  const shutdownResources = dependencies.shutdownCliResources || (() => require("./cliShutdown").shutdownCliResources());
  initializeLayout();
  resetApplicationShutdownSignal(); initializeConfig(); process.title = "客服数据自动更新 CLI";
  let exitRequested = false;
  async function requestSignalExit() {
    if (exitRequested) return;
    exitRequested = true; terminal.writeLine("\n正在安全退出……"); await shutdownResources(); process.exit(0);
  }
  process.once("SIGINT", requestSignalExit); process.once("SIGTERM", requestSignalExit);
  try {
    while (!exitRequested) {
      renderDashboard({ terminal, projectConfig: readProjectConfig(), state: getControlCenterState() });
      // 首屏出现后再后台执行浏览器缓存迁移等耗时清理，加快启动体感。
      scheduleStartupCleanup();
      const selection = await terminal.prompt("请选择：");
      if (selection === "0") break;
      try { await handleSelection({ selection, terminal }); }
      catch (error) { patchControlCenterState({ lastError: String(error?.message || error), lastAction: "操作失败" }); terminal.writeLine(terminal.theme.error(`\n操作失败：${String(error?.message || error)}`)); await terminal.pause(); }
    }
  } finally {
    process.removeListener("SIGINT", requestSignalExit); process.removeListener("SIGTERM", requestSignalExit); await shutdownResources();
  }
  terminal.writeLine(terminal.theme.muted("控制台已退出。 ")); return getControlCenterState();
}

module.exports = { resolveExistingDirectory, openWorkbookDirectory, openDownloadRootDirectory, refreshExistingPersonRoles, handleCliMenuSelection, startCliRuntime };
