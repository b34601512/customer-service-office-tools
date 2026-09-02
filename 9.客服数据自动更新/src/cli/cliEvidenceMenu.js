const fs = require("fs");
const path = require("path");
const appConfig = require("../config/appConfig");
const { revealLocalPath } = require("../controlCenter/localFileApiParts/windowsLocalFileActions");
const { DIVIDER } = require("./cliDashboard");

const SUMMARY_EVIDENCE_ROOT = path.join(appConfig.projectRoot, "runtime", "evidence", "summary");

function resolveSourceDownloadRoot(projectConfig) {
  return (
    String(projectConfig?.globalDefaults?.downloadRootDir || "").trim() ||
    appConfig.runtime.output.downloadsRoot
  );
}

function ensureDirectoryExists(directoryPath) {
  fs.mkdirSync(directoryPath, { recursive: true });
}

async function openSummaryEvidenceFolder({ revealPathImplementation = revealLocalPath } = {}) {
  ensureDirectoryExists(SUMMARY_EVIDENCE_ROOT);
  await revealPathImplementation(SUMMARY_EVIDENCE_ROOT);
}

async function openSourceDownloadFolder({ projectConfig, revealPathImplementation = revealLocalPath }) {
  const sourceDownloadRoot = resolveSourceDownloadRoot(projectConfig);
  ensureDirectoryExists(sourceDownloadRoot);
  await revealPathImplementation(sourceDownloadRoot);
}

function renderEvidenceFolderMenu(terminal, projectConfig) {
  terminal.clear();
  terminal.writeLine(terminal.theme.title("打开凭证/源文件夹"));
  terminal.writeLine(terminal.theme.muted(DIVIDER));
  terminal.writeLine(`凭证文件夹：${SUMMARY_EVIDENCE_ROOT}`);
  terminal.writeLine(`源文件夹：${resolveSourceDownloadRoot(projectConfig)}`);
  terminal.writeLine(terminal.theme.muted(DIVIDER));
  terminal.writeLine("  [1] 打开凭证文件夹    [2] 打开源文件夹    [0] 返回");
}

async function showEvidenceFolderMenu(terminal, projectConfig, dependencies = {}) {
  const openSummaryEvidenceFolderImplementation =
    dependencies.openSummaryEvidenceFolderImplementation || openSummaryEvidenceFolder;
  const openSourceDownloadFolderImplementation =
    dependencies.openSourceDownloadFolderImplementation || openSourceDownloadFolder;
  while (true) {
    renderEvidenceFolderMenu(terminal, projectConfig);
    const answer = await terminal.prompt("请选择：");
    if (answer === "0") return;
    if (answer === "1") {
      await openSummaryEvidenceFolderImplementation();
      return;
    }
    if (answer === "2") {
      await openSourceDownloadFolderImplementation({ projectConfig });
      return;
    }
  }
}

module.exports = {
  SUMMARY_EVIDENCE_ROOT,
  resolveSourceDownloadRoot,
  openSummaryEvidenceFolder,
  openSourceDownloadFolder,
  renderEvidenceFolderMenu,
  showEvidenceFolderMenu
};
