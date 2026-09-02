const { connectToChrome, disconnectFromChrome } = require("../../../engine/chromeSession");
const { log } = require("../../../engine/logger");
const { registerDownloadArtifact } = require("../../../reporting/downloadArtifactRegistry");
const { waitForDownloadArtifact, triggerDownloadAndWait } = require("../../../shared/downloadEventEngine");
const { resolveExportDateRange } = require("../../../shared/exportDateRange");
const { captureDownloadEvidence } = require("../../../shared/downloadEvidence");
const { dismissBlockingPopups } = require("../../../shared/blockingPopupEngine");
const { DOUYIN_DOWNLOAD_TIMEOUT_MS, DOUYIN_POLL_INTERVAL_MS } = require("./douyinDownloadSettings");
const {
  resolveStoreDownloadDir,
  snapshotWorkbookArtifacts,
  findNewArtifact,
  enableDownloadBehavior,
  finalizeDouyinDownloadedPath
} = require("./douyinDownloadArtifacts");
const { pickDouyinPage, waitForDouyinDataPageReady, DouyinLoginRequiredError } = require("./douyinPageReadiness");
const { applyDouyinDateRange } = require("./douyinDateApplier");
const { clickDouyinExportButton } = require("./douyinExportButton");
const { ensureDouyinMerchantSession } = require("./douyinLoginRecovery");
const { ensureDouyinActiveStore } = require("./douyinStoreSwitcher");
const { navigateDouyinDataPage } = require("./douyinPageNavigator");

function reportProgress(onProgress, stageText, detail = "") {
  // 该函数只输出当前真实执行阶段。
  log("主线:执行", "抖音下载", stageText, detail || "已进入该阶段");
  if (typeof onProgress === "function") {
    onProgress(stageText, detail);
  }
}

async function prepareDouyinVerifiedDataPage(browser, page, storeConfig, onProgress, options) {
  // 该函数只完成登录、验店和客服数据页就绪。
  const progressReporter = (stageText, detail) => reportProgress(onProgress, stageText, detail);
  const merchantPage = await ensureDouyinMerchantSession(browser, page, progressReporter, options);
  const storeStatus = await ensureDouyinActiveStore(merchantPage, storeConfig, progressReporter, options);
  const verifiedMerchantPage = storeStatus.page;
  const identity = storeStatus.identity;
  reportProgress(onProgress, "确认抖音店铺", `当前=${identity.storeName}(${identity.storeId})`);
  reportProgress(onProgress, "打开客服数据页面", storeConfig.siteUrl);
  await navigateDouyinDataPage(verifiedMerchantPage, storeConfig.siteUrl, options);
  reportProgress(onProgress, "等待客服数据页面", "等待客服数据、客服表现和导出数据同时出现");
  try {
    await waitForDouyinDataPageReady(verifiedMerchantPage);
  } catch (error) {
    if (!(error instanceof DouyinLoginRequiredError) && error?.code !== "DOUYIN_LOGIN_REQUIRED") {
      throw error;
    }
    const loginRecoveryAttempt = Number(options.douyinLoginRecoveryAttempt) || 0;
    if (loginRecoveryAttempt >= 2) {
      throw new Error("抖音登录连续恢复两次后仍然失效，已停止下载以防登记空数据或旧文件。");
    }
    reportProgress(onProgress, "恢复抖音登录", "客服数据页检测到登录失效，恢复后将重新验店");
    return prepareDouyinVerifiedDataPage(browser, verifiedMerchantPage, storeConfig, onProgress, {
      ...options,
      douyinLoginRecoveryAttempt: loginRecoveryAttempt + 1
    });
  }
  return verifiedMerchantPage;
}

async function dismissDouyinBlockingPopups(page, onProgress) {
  // 该函数只检查并关闭当前抖音页的遮挡弹窗。
  reportProgress(onProgress, "检查遮挡弹窗", "只允许关闭当前弹窗的唯一明确关闭入口");
  const closedPopupCount = await dismissBlockingPopups(page, {
    platformName: "抖音",
    popupIdleTimeoutMs: 2000
  });
  if (closedPopupCount > 0) {
    reportProgress(onProgress, "关闭遮挡弹窗", `已关闭${closedPopupCount}个遮挡弹窗`);
  }
}

async function downloadDouyinReport(onProgress = null, options = {}) {
  // 该函数只按真实下载路径导出并登记抖音客服报表。
  const reportKey = String(options.reportKey || "response_time").trim() || "response_time";
  const resolvedConfig = options.resolvedConfig;
  if (!resolvedConfig?.activeStore) {
    throw new Error("执行抖音下载失败：缺少当前汇总任务的店铺配置。");
  }
  const exportRange = resolveExportDateRange(resolvedConfig.activeStore.exportDateRange, new Date());
  const downloadDir = resolveStoreDownloadDir(resolvedConfig.activeStore);
  const browser = await connectToChrome();
  let page = null;
  try {
    reportProgress(onProgress, "登录并核对店铺", `店铺=${resolvedConfig.activeStore.displayName}`);
    page = await pickDouyinPage(browser, resolvedConfig.activeStore.siteUrl);
    await page.bringToFront();
    page = await prepareDouyinVerifiedDataPage(browser, page, resolvedConfig.activeStore, onProgress, options);
    await dismissDouyinBlockingPopups(page, onProgress);
    reportProgress(onProgress, "选择日期", `${exportRange.startText} 到 ${exportRange.endText}`);
    await applyDouyinDateRange(page, exportRange);
    await waitForDouyinDataPageReady(page);
    reportProgress(onProgress, "接管下载目录", downloadDir);
    await enableDownloadBehavior(page, downloadDir);
    const beforeFiles = snapshotWorkbookArtifacts(downloadDir);
    await captureDownloadEvidence(page, options, "抖音客服数据下载前");
    const downloadStart = await triggerDownloadAndWait(
      () => waitForDownloadArtifact({
        downloadDir,
        timeoutMs: DOUYIN_DOWNLOAD_TIMEOUT_MS,
        pollIntervalMs: DOUYIN_POLL_INTERVAL_MS,
        findNewArtifact: () => findNewArtifact(downloadDir, beforeFiles),
        actionText: "点击抖音导出数据"
      }),
      () => clickDouyinExportButton(page)
    );
    reportProgress(onProgress, "等待文件落盘", "导出已触发，正在等待 Excel 文件");
    const downloadedPath = finalizeDouyinDownloadedPath(downloadStart, resolvedConfig.activeStore, exportRange);
    registerDownloadArtifact({ platformKey: "douyin", resolvedConfig, filePath: downloadedPath, exportRange });
    await captureDownloadEvidence(page, options, "抖音客服数据下载后");
    reportProgress(onProgress, "登记下载文件", `文件=${downloadedPath}`);
    return downloadedPath;
  } finally {
    await disconnectFromChrome(browser, "抖音下载流程已结束，主动断开调试连接");
  }
}

module.exports = {
  downloadDouyinReport,
  prepareDouyinVerifiedDataPage
};
