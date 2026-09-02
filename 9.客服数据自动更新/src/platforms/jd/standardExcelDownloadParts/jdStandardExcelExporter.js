// 该文件用于解决京东报表导出、文件落盘和下载产物登记问题。
const fs = require("fs");
const path = require("path");
const { log } = require("../../../engine/logger");
const { clickLocatorWhenReady } = require("../../../shared/browserActionEngine");
const {
  waitForVisibleButtonTarget
} = require("../../../shared/visibleButtonActionEngine");
const {
  buildDownloadPath,
  createRunDownloadDir,
  buildPreferredDownloadFileName,
  waitForDownloadStart,
  enableDownloadBehavior,
  copyDownloadToFinalPath
} = require("../jdDownloadArtifacts");
const { registerDownloadArtifact } = require("../../../reporting/downloadArtifactRegistry");
const { reportProgress } = require("../downloadTaskParts/jdDownloadProgress");
const { captureDownloadEvidence } = require("../../../shared/downloadEvidence");
const { triggerDownloadAndWait } = require("../../../shared/downloadEventEngine");

const JD_EXPORT_BUTTON_TEXTS = ["导出", "导出数据", "导出excel"];

function listCurrentRunFileNames(runDownloadDir) {
  // 这里只读取本轮下载缓存目录的现有文件名，用来判断后续是否真的出现新下载。
  return new Set(
    fs.readdirSync(runDownloadDir, { withFileTypes: true }).filter((entry) => entry.isFile()).map((entry) => entry.name)
  );
}

function resolveBrowserSuggestedFileName(downloadStart) {
  // 这里只读取运行目录真实文件的原始文件名。
  return path.basename(downloadStart?.name || downloadStart?.fullPath || "");
}

async function waitForCurrentJdExportButton(page, surface, options = {}) {
  // 这里按状态等待最新导出按钮出现，不靠固定持有旧定位器。
  const normalizedOptions = typeof options === "number" ? { timeoutMs: options } : options;
  const safeTimeoutMs = Math.max(1, Number(normalizedOptions.timeoutMs) || 15000);
  const browser = normalizedOptions.browser || null;
  log(
    "主线:等待",
    "京东下载",
    "导出按钮扫描",
    `开始扫描当前页面导出按钮，超时=${safeTimeoutMs}ms，页面=${page?.url?.() || "未读到"}`
  );

  return waitForVisibleButtonTarget({
    page,
    surface,
    browser,
    textList: JD_EXPORT_BUTTON_TEXTS,
    actionName: "导出",
    timeoutMs: safeTimeoutMs
  });
}

function registerJdStandardExcelArtifact({ resolvedConfig, finalPath, exportRange }) {
  // 这里把导出的标准 Excel 登记到统一下载历史，导入阶段只从这里找文件。
  registerDownloadArtifact({
    platformKey: "jd",
    resolvedConfig,
    filePath: finalPath,
    exportRange
  });
  return finalPath;
}

function copyDetectedJdDownloadFile({ downloadArtifact, finalPath, resolvedConfig, exportRange, onProgress = null }) {
  // 这里把共享引擎确认的真实文件复制到正式目录。
  if (!downloadArtifact?.fullPath) {
    throw new Error("京东下载产物无效：运行目录没有返回真实文件。");
  }
  reportProgress(onProgress, "等待文件落盘", "已捕获运行目录真实文件，正在复制到正式目录");
  const downloadedPath = downloadArtifact.fullPath;
  copyDownloadToFinalPath(downloadedPath, finalPath);
  log(
    "主线:完成",
    "京东下载",
    "目录检测",
    `店铺=${resolvedConfig.activeStore.displayName}，原始文件=${downloadedPath}，正式文件=${finalPath}`
  );
  return registerJdStandardExcelArtifact({ resolvedConfig, finalPath, exportRange });
}

async function exportJdStandardExcel({
  browser = null,
  page,
  surface,
  resolvedConfig,
  exportRange,
  onProgress = null,
  evidenceDir = "",
  evidenceFiles = null,
  evidenceFileNamePrefix = ""
}) {
  // 这里只负责从已稳定的京东报表页导出一个标准 Excel 文件。
  const evidenceOptions = {
    evidenceDir,
    evidenceFiles,
    evidenceFileNamePrefix
  };
  const runDownloadDir = createRunDownloadDir(resolvedConfig.activeStore);
  await enableDownloadBehavior(page, runDownloadDir);
  const beforeFiles = listCurrentRunFileNames(runDownloadDir);

  reportProgress(onProgress, "等待导出按钮就绪", "查询结果已稳定，准备点击导出");
  const exportTarget = await waitForCurrentJdExportButton(page, surface, {
    browser,
    timeoutMs: 15000
  });
  const exportButton = exportTarget.locator;
  const exportPage = exportTarget.page || page;
  if (exportPage !== page) {
    await enableDownloadBehavior(exportPage, runDownloadDir);
  }

  reportProgress(onProgress, "触发导出", "准备点击当前报表页导出按钮");
  await captureDownloadEvidence(exportPage, evidenceOptions, "京东业绩指标下载前");
  const downloadStart = await triggerDownloadAndWait(
    () => waitForDownloadStart(runDownloadDir, beforeFiles, 60000),
    () => clickLocatorWhenReady(exportButton, "京东导出按钮", { timeoutMs: 5000 })
  );

  reportProgress(onProgress, "等待下载开始", "点击完成，正在确认浏览器是否真的开始下载");
  const suggestedName = resolveBrowserSuggestedFileName(downloadStart);
  const finalFileName = buildPreferredDownloadFileName(resolvedConfig.activeStore, exportRange, suggestedName);
  const finalPath = buildDownloadPath(resolvedConfig.activeStore, finalFileName);

  log("主线:执行", "京东下载", "下载命名", `浏览器文件名=${suggestedName || "未返回"}，正式文件名=${finalFileName}`);

  const copiedPath = await copyDetectedJdDownloadFile({
    downloadArtifact: downloadStart,
    finalPath,
    resolvedConfig,
    exportRange,
    onProgress
  });
  await captureDownloadEvidence(exportPage, evidenceOptions, "京东业绩指标下载后");
  return copiedPath;
}

module.exports = {
  exportJdStandardExcel
};
