const appConfig = require("../../../config/appConfig");
const { clickVisibleButton } = require("../../../shared/visibleButtonActionEngine");
const { captureDownloadEvidence } = require("../../../shared/downloadEvidence");
const { dismissBlockingPopups } = require("../../../shared/blockingPopupEngine");
const { assertNoTmallSafetyChallenge } = require("../tmallSafetyGuard");
const { waitForTmallPerformanceReportStable } = require("../tmallPerformanceDownloadGuard");
const {
  triggerTmallResponseTimeDownload,
  triggerTmallCustomerSatisfactionDownload
} = require("../responseTimeReportParts/tmallResponseTimeDownloadCenter");
const { reportTmallDownloadProgress, buildTmallDownloadEvidenceLabel } = require("./tmallDownloadRuntime");

async function clickTmallPerformanceDownload(page) {
  // 该函数只点击当前页面唯一的业绩报表下载按钮。
  return clickVisibleButton({
    page,
    surface: page,
    textList: ["下载"],
    actionName: "天猫下载按钮",
    clickActionName: "天猫下载按钮",
    timeoutMs: 30000,
    clickTimeoutMs: 30000,
    actionOptions: {
      pollIntervalMs: appConfig.tmall.actionPollIntervalMs,
      minimumClickIntervalMs: appConfig.tmall.minimumClickIntervalMs,
      requireTrialClick: false
    }
  });
}

async function dismissTmallBlockingPopups(page, onProgress) {
  // 该函数只关闭当前天猫页的唯一明确遮挡入口。
  reportTmallDownloadProgress(onProgress, "检查遮挡弹窗", "只允许关闭当前弹窗的唯一明确关闭入口");
  const closedPopupCount = await dismissBlockingPopups(page, { platformName: "天猫" });
  if (closedPopupCount > 0) {
    reportTmallDownloadProgress(onProgress, "关闭遮挡弹窗", `已关闭${closedPopupCount}个遮挡弹窗`);
  }
}

async function triggerTmallReportDownload(page, input) {
  // 该函数只验证下载前状态并触发当前报表的唯一下载动作。
  const { reportType, exportRange, sourceReportKeys, onProgress, options } = input;
  reportTmallDownloadProgress(
    onProgress,
    "触发下载按钮",
    reportType.isServiceQualityReport ? "准备导出并打开下载中心取最新文件" : "准备点击右上角下载入口"
  );
  await assertNoTmallSafetyChallenge(page, "点击下载前");
  await dismissTmallBlockingPopups(page, onProgress);
  if (!reportType.isServiceQualityReport) {
    reportTmallDownloadProgress(onProgress, "确认下载前结果", "重新确认报表没有加载中");
    await waitForTmallPerformanceReportStable(page, exportRange);
  }
  await captureDownloadEvidence(page, options, buildTmallDownloadEvidenceLabel(sourceReportKeys, "下载前"));
  if (reportType.isCustomerSatisfactionReport) {
    await triggerTmallCustomerSatisfactionDownload(page);
    return;
  }
  if (reportType.isServiceQualityReport) {
    await triggerTmallResponseTimeDownload(page);
    return;
  }
  await clickTmallPerformanceDownload(page);
}

module.exports = {
  triggerTmallReportDownload
};
