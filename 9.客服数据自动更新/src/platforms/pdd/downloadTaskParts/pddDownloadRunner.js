const { connectToChrome, disconnectFromChrome } = require("../../../engine/chromeSession");
const { registerDownloadArtifact } = require("../../../reporting/downloadArtifactRegistry");
const { resolveExportDateRange } = require("../../../shared/exportDateRange");
const { dismissBlockingPopups } = require("../../../shared/blockingPopupEngine");
const { applyPddDateRange } = require("../pddDateApplier");
const { capturePddDownloadEvidence } = require("../pddEvidenceCapture");
const { assertPddStoreIdentityMatches } = require("../pddStoreIdentity");
const { resolvePddStoreDownloadDir, listPddDownloadFileNames, resolvePddDownloadedPath } = require("./pddDownloadArtifacts");
const { clickPddDownloadButton } = require("./pddDownloadButton");
const { triggerPddExportAndWaitForAcceptance } = require("./pddExportAcceptance");
const { waitForPddDownloadReadyPage } = require("./pddDownloadLogin");
const {
  PDD_DOWNLOAD_TIMEOUT_MS,
  waitForPddDownloadStart,
  setPddDownloadDirectory,
  reportPddDownloadProgress
} = require("./pddDownloadRuntime");

function resolvePddDownloadContext(options) {
  // 该函数只把调用参数整理成一次拼多多下载所需的确定上下文。
  const resolvedConfig = options.resolvedConfig;
  if (!resolvedConfig?.activeStore) {
    throw new Error("执行拼多多下载失败：缺少当前汇总任务的店铺配置。");
  }
  return {
    resolvedConfig,
    downloadDir: resolvePddStoreDownloadDir(resolvedConfig.activeStore),
    exportRange: resolveExportDateRange(resolvedConfig.activeStore.exportDateRange, new Date())
  };
}

async function dismissPddBlockingPopups(page, onProgress) {
  // 该函数只关闭当前拼多多页的唯一明确遮挡入口。
  reportPddDownloadProgress(onProgress, "检查遮挡弹窗", "只允许关闭当前弹窗的唯一明确关闭入口");
  const closedPopupCount = await dismissBlockingPopups(page, { platformName: "拼多多" });
  if (closedPopupCount > 0) {
    reportPddDownloadProgress(onProgress, "关闭遮挡弹窗", `已关闭${closedPopupCount}个遮挡弹窗`);
  }
}

async function runConnectedPddDownload(browser, onProgress, options, context) {
  // 该函数只按固定顺序调度一次已连接浏览器的拼多多下载。
  const { resolvedConfig, downloadDir, exportRange } = context;
  reportPddDownloadProgress(onProgress, "等待登录态稳定", `店铺=${resolvedConfig.activeStore.displayName}`);
  const page = await waitForPddDownloadReadyPage(browser, resolvedConfig.activeStore, options);
  const identityStatus = await assertPddStoreIdentityMatches(page, resolvedConfig.activeStore);
  reportPddDownloadProgress(onProgress, "确认店铺身份", `已命中真实店铺身份=${identityStatus.matchedIdentityText}`);
  await page.bringToFront();
  await dismissPddBlockingPopups(page, onProgress);
  reportPddDownloadProgress(onProgress, "填写日期", `${exportRange.startText} 到 ${exportRange.endText}`);
  await applyPddDateRange(page, exportRange);
  reportPddDownloadProgress(onProgress, "等待下载目录接管", "页面日期已确认，准备把浏览器下载写入当前店铺目录");
  await setPddDownloadDirectory(page, downloadDir);
  const beforeFiles = listPddDownloadFileNames(downloadDir);
  await dismissPddBlockingPopups(page, onProgress);
  reportPddDownloadProgress(onProgress, "触发下载表单", `当前页面=${page.url()}，日期=${exportRange.startText} 到 ${exportRange.endText}`);
  await capturePddDownloadEvidence(page, options, "拼多多业绩指标下载前");
  await triggerPddExportAndWaitForAcceptance(page, () => clickPddDownloadButton(page));
  reportPddDownloadProgress(onProgress, "等待文件落盘", "平台已确认导出，正在等待新 Excel 文件");
  const downloadStart = await waitForPddDownloadStart(downloadDir, beforeFiles, PDD_DOWNLOAD_TIMEOUT_MS);
  const downloadedPath = resolvePddDownloadedPath(downloadStart);
  registerDownloadArtifact({ platformKey: "pdd", resolvedConfig, filePath: downloadedPath, exportRange });
  reportPddDownloadProgress(onProgress, "登记下载文件", `文件=${downloadedPath}`);
  await capturePddDownloadEvidence(page, options, "拼多多业绩指标下载后");
  return downloadedPath;
}

async function downloadPddReport(onProgress = null, options = {}) {
  // 该函数只管理一次拼多多下载的浏览器连接和最终断连边界。
  const context = resolvePddDownloadContext(options);
  reportPddDownloadProgress(onProgress, "确认下载目录", `店铺=${context.resolvedConfig.activeStore.displayName}，目录=${context.downloadDir}`);
  reportPddDownloadProgress(onProgress, "连接调试浏览器", "准备接管当前拼多多后台页面并触发下载表单");
  const browser = await connectToChrome();
  try {
    return await runConnectedPddDownload(browser, onProgress, options, context);
  } finally {
    await disconnectFromChrome(browser, "拼多多下载流程已结束，主动断开调试连接");
  }
}

module.exports = {
  downloadPddReport
};
