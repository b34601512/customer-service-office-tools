const fs = require("fs");
const path = require("path");
const { connectToChrome, disconnectFromChrome } = require("../../../engine/chromeSession");
const { log } = require("../../../engine/logger");
const { captureDownloadEvidence } = require("../../../shared/downloadEvidence");
const { registerDownloadArtifact } = require("../../../reporting/downloadArtifactRegistry");
const { resolveTmallDateRange } = require("../tmallDateRange");
const {
  resolveStoreDownloadDir,
  buildDownloadPath,
  createRunDownloadDir,
  buildPreferredDownloadFileName
} = require("../tmallDownloadArtifacts");
const {
  waitForTmallDownloadStart,
  setTmallDownloadDirectory,
  reportTmallDownloadProgress,
  buildTmallDownloadEvidenceLabel
} = require("./tmallDownloadRuntime");
const { resolveTmallReportType, prepareTmallReportPage } = require("./tmallReportPreparation");
const { triggerTmallReportDownload } = require("./tmallDownloadTrigger");
const { assertTmallDownloadFileName, persistTmallDownload } = require("./tmallDownloadPersistence");
const { captureTmallPageCheckpoint } = require("../tmallSafetyGuard");
const { resolveManagedOpenWindowMeta, runManagedOpenWindowEngine } = require("../../../shared/managedOpenWindowEngine");

function resolveTmallDownloadInput(options) {
  // 这个函数只把调用参数整理成一次下载所需的确定上下文。
  const reportKey = String(options.reportKey || "performance").trim() || "performance";
  const sourceReportKeys = Array.isArray(options.sourceReportKeys) && options.sourceReportKeys.length
    ? options.sourceReportKeys
    : [reportKey];
  const resolvedConfig = options.resolvedConfig;
  if (!resolvedConfig?.activeStore) {
    throw new Error("执行天猫下载失败：缺少当前汇总任务的店铺配置。");
  }
  return {
    reportKey,
    sourceReportKeys,
    resolvedConfig,
    reportType: resolveTmallReportType(reportKey),
    exportRange: options.exportRange || resolveTmallDateRange(resolvedConfig.activeStore)
  };
}

function listRunDownloadFiles(runDownloadDir) {
  // 这个函数只记录触发下载前运行目录里的文件名。
  return new Set(fs.readdirSync(runDownloadDir, { withFileTypes: true })
    .filter((entry) => entry.isFile())
    .map((entry) => entry.name));
}

function resolveSuggestedDownloadName(downloadStart) {
  // 这个函数只读取运行目录真实文件的原始文件名。
  return path.basename(downloadStart?.name || downloadStart?.fullPath || "");
}

async function restoreTmallDownloadDirectory(page, configuredDownloadDir) {
  // 这个函数只在退出前恢复用户原有的人工下载目录。
  if (!page || !configuredDownloadDir) {
    return;
  }
  await setTmallDownloadDirectory(page, configuredDownloadDir);
  log("主线:完成", "天猫下载", "恢复人工下载目录", `已恢复人工下载目录=${configuredDownloadDir}`);
}

async function runConnectedTmallDownload(browser, onProgress, options, context, runtimeState) {
  // 这个函数只按固定顺序调度一次已连接浏览器的天猫下载。
  const { resolvedConfig, reportType, reportKey, sourceReportKeys, exportRange } = context;
  const page = await prepareTmallReportPage(browser, {
    reportKey,
    reportType,
    resolvedConfig,
    exportRange,
    sourceReportKeys,
    onProgress,
    options,
    runtimeState
  });
  const configuredDownloadDir = resolveStoreDownloadDir(resolvedConfig.activeStore);
  runtimeState.configuredDownloadDir = configuredDownloadDir;
  log("主线:执行", "天猫下载", "下载目录", `当前下载目录=${configuredDownloadDir}`);
  const runDownloadDir = createRunDownloadDir(resolvedConfig.activeStore);
  await setTmallDownloadDirectory(page, runDownloadDir);
  const beforeFiles = listRunDownloadFiles(runDownloadDir);
  await triggerTmallReportDownload(page, { reportType, exportRange, sourceReportKeys, onProgress, options });
  reportTmallDownloadProgress(onProgress, "等待下载开始", "点击完成，正在确认浏览器是否真的开始下载");
  let downloadStart;
  try {
    downloadStart = await waitForTmallDownloadStart(runDownloadDir, beforeFiles, 60000);
  } catch (error) {
    await captureTmallPageCheckpoint(page, `${resolvedConfig.activeStore.key || "tmall"}-下载启动失败`);
    throw error;
  }
  const suggestedName = resolveSuggestedDownloadName(downloadStart);
  const finalFileName = buildPreferredDownloadFileName(resolvedConfig.activeStore, exportRange, suggestedName);
  const finalPath = buildDownloadPath(resolvedConfig.activeStore, finalFileName);
  log("主线:执行", "天猫下载", "下载命名", `浏览器文件名=${suggestedName || "未返回"}，正式文件名=${finalFileName}`);
  try {
    assertTmallDownloadFileName(finalFileName, exportRange, reportType);
  } catch (error) {
    await captureTmallPageCheckpoint(page, `${resolvedConfig.activeStore.key || "tmall"}-下载文件校验失败`);
    throw error;
  }
  await persistTmallDownload({
    downloadArtifact: downloadStart,
    finalPath,
    resolvedConfig,
    onProgress
  });
  registerDownloadArtifact({ platformKey: "tmall", resolvedConfig, filePath: finalPath, exportRange });
  await captureDownloadEvidence(page, options, buildTmallDownloadEvidenceLabel(sourceReportKeys, "下载后"));
  return finalPath;
}

function isRetryableTmallConnectionError(error) {
  return /调试浏览器连接失败|connectOverCDP|CDP 会话|WebSocket|Target closed/i.test(
    String(error?.message || error || "")
  );
}

async function connectTmallBrowserWithRecovery(onProgress, context, options = {}) {
  try {
    return await connectToChrome();
  } catch (error) {
    if (options.tmallConnectionRecoveryAttempt || !isRetryableTmallConnectionError(error)) {
      throw error;
    }
    reportTmallDownloadProgress(onProgress, "恢复浏览器会话", "CDP 接管失败，正在重启当前天猫店铺的受控浏览器后重试一次");
    await runManagedOpenWindowEngine({
      platformKey: "tmall",
      storeConfig: context.resolvedConfig.activeStore,
      openMeta: resolveManagedOpenWindowMeta(context.resolvedConfig.activeStore),
      actionName: "天猫下载恢复浏览器会话",
      moduleName: "天猫下载"
    });
    return connectToChrome();
  }
}

async function downloadTmallReport(onProgress = null, options = {}) {
  // 这个函数只管理一次天猫下载的浏览器连接和最终清理边界。
  const context = resolveTmallDownloadInput(options);
  reportTmallDownloadProgress(onProgress, "连接调试浏览器", `店铺=${context.resolvedConfig.activeStore.displayName}`);
  const browser = await connectTmallBrowserWithRecovery(onProgress, context, options);
  const runtimeState = { page: null, configuredDownloadDir: "" };
  try {
    return await runConnectedTmallDownload(browser, onProgress, options, context, runtimeState);
  } finally {
    try {
      await restoreTmallDownloadDirectory(runtimeState.page, runtimeState.configuredDownloadDir);
    } finally {
      await disconnectFromChrome(browser, "天猫下载流程已结束，主动断开调试连接");
    }
  }
}

module.exports = {
  downloadTmallReport,
  isRetryableTmallConnectionError,
  connectTmallBrowserWithRecovery
};
