const appConfig = require("../../../config/appConfig");
const { log } = require("../../../engine/logger");
const { captureDownloadEvidence } = require("../../../shared/downloadEvidence");
const { dismissBlockingPopups } = require("../../../shared/blockingPopupEngine");
const { waitForTmallLoginReady } = require("../tmallLoginState");
const { navigatePageToTmallTarget, waitForTmallReportPageReady } = require("../tmallNavigator");
const { applyTmallDateRange } = require("../tmallDateApplier");
const { waitForTmallPage } = require("../tmallPage");
const { assertNoTmallSafetyChallenge, captureTmallPageCheckpoint } = require("../tmallSafetyGuard");
const { getTmallCurrentDateLocator } = require("../tmallControls");
const { ensureTmallActiveStore } = require("../tmallStoreSwitcher");
const {
  resolveTmallResponseTimeEntranceUrl,
  pickTmallResponseTimePage,
  waitForTmallResponseTimeLoginReady
} = require("../responseTimeReportParts/tmallResponseTimeLogin");
const {
  prepareTmallResponseTimeExportPage,
  waitForTmallCustomerSatisfactionDetailReady
} = require("../responseTimeReportParts/tmallResponseTimeReportFlow");
const { waitForTmallPerformanceReportStable } = require("../tmallPerformanceDownloadGuard");
const { reportTmallDownloadProgress, buildTmallDownloadEvidenceLabel } = require("./tmallDownloadRuntime");

function resolveTmallReportType(reportKey) {
  // 该函数只把报表键转换为下载流程所需的类型信息。
  const serviceQualityReportKeys = new Set(["response_time", "three_minute_response_rate", "customer_satisfaction"]);
  const isServiceQualityReport = serviceQualityReportKeys.has(reportKey);
  const isCustomerSatisfactionReport = reportKey === "customer_satisfaction";
  return {
    isServiceQualityReport,
    isCustomerSatisfactionReport,
    expectedDownloadTitle: isCustomerSatisfactionReport ? "旺旺账号咨询接待能力明细" : "按客服查看"
  };
}

async function dismissTmallBlockingPopups(page, onProgress) {
  // 该函数只关闭当前天猫页的唯一明确遮挡入口。
  reportTmallDownloadProgress(onProgress, "检查遮挡弹窗", "只允许关闭当前弹窗的唯一明确关闭入口");
  const closedPopupCount = await dismissBlockingPopups(page, { platformName: "天猫" });
  if (closedPopupCount > 0) {
    reportTmallDownloadProgress(onProgress, "关闭遮挡弹窗", `已关闭${closedPopupCount}个遮挡弹窗`);
  }
}

async function prepareTmallServiceQualityPage(browser, input) {
  // 该函数只把质量报表页面准备到可以触发导出的状态。
  const { reportKey, reportType, resolvedConfig, onProgress } = input;
  const entranceUrl = resolveTmallResponseTimeEntranceUrl(reportKey);
  reportTmallDownloadProgress(onProgress, "打开千牛真实体检分入口", `目标地址=${entranceUrl}`);
  const page = await pickTmallResponseTimePage(browser, entranceUrl);
  input.runtimeState.page = page;
  await page.bringToFront();
  await page.goto(entranceUrl, { waitUntil: "domcontentloaded", timeout: appConfig.tmall.connectTimeoutMs });
  await assertNoTmallSafetyChallenge(page, "平均响应时间下载前页面检查");
  await dismissTmallBlockingPopups(page, onProgress);
  if (reportType.isCustomerSatisfactionReport) {
    reportTmallDownloadProgress(onProgress, "等待满意度明细", "等待页面指标加载完成");
    await waitForTmallResponseTimeLoginReady(page, appConfig.tmall.connectTimeoutMs, { storeConfig: resolvedConfig.activeStore });
    await waitForTmallCustomerSatisfactionDetailReady(page);
  } else {
    reportTmallDownloadProgress(onProgress, "进入服务体验分析", "准备点击服务体验分析，再打开旺旺人工平响时长");
    await prepareTmallResponseTimeExportPage(page, { storeConfig: resolvedConfig.activeStore });
  }
  return page;
}

async function prepareTmallPerformancePage(browser, input) {
  // 该函数只把业绩报表页面准备到日期已确认的状态。
  const { resolvedConfig, exportRange, sourceReportKeys, onProgress, options } = input;
  reportTmallDownloadProgress(onProgress, "确认已登录页面", "准备确认当前浏览器里的天猫登录态");
  const readyPage = await waitForTmallLoginReady(browser, { storeConfig: resolvedConfig.activeStore });
  await readyPage.bringToFront();
  const checkpointPrefix = resolvedConfig.activeStore.key || "tmall";
  await captureTmallPageCheckpoint(readyPage, `${checkpointPrefix}-登录确认后`);
  reportTmallDownloadProgress(onProgress, "打开报表页面", `目标地址=${resolvedConfig.activeStore.siteUrl}`);
  await navigatePageToTmallTarget(readyPage, resolvedConfig.activeStore.siteUrl, { waitForReady: false });
  reportTmallDownloadProgress(onProgress, "等待报表页就绪", "准备确认统计日期和“自定义”按钮");
  const page = await waitForTmallPage(browser);
  input.runtimeState.page = page;
  await page.bringToFront();
  await page.waitForLoadState("domcontentloaded");
  await captureTmallPageCheckpoint(page, `${checkpointPrefix}-目标页加载后`);
  await waitForTmallReportPageReady(page);
  await ensureTmallActiveStore(page, resolvedConfig.activeStore);
  await captureDownloadEvidence(page, options, buildTmallDownloadEvidenceLabel(sourceReportKeys, "目标页"));
  if (exportRange.ruleNotice) {
    log("主线:提示", "天猫下载", "日期规则", exportRange.ruleNotice);
  }
  await assertNoTmallSafetyChallenge(page, "生意参谋选择日期前");
  await dismissTmallBlockingPopups(page, onProgress);
  await captureTmallPageCheckpoint(page, `${checkpointPrefix}-选择日期前`);
  reportTmallDownloadProgress(onProgress, "应用日期", `${exportRange.startText} 至 ${exportRange.endText}`);
  try {
    await applyTmallDateRange(page, exportRange);
  } catch (error) {
    await captureTmallPageCheckpoint(page, `${checkpointPrefix}-日期操作失败`);
    throw error;
  }
  await assertNoTmallSafetyChallenge(page, "选择日期后");
  reportTmallDownloadProgress(onProgress, "等待结果稳定", "确认日期命中且页面不再加载");
  const reportState = await waitForTmallPerformanceReportStable(page, exportRange);
  const dateLocatorText = reportState.currentDateText ? reportState.currentDateText : await getTmallCurrentDateLocator(page).innerText();
  const currentDateText = String(dateLocatorText).replace(/\s+/g, " ").trim();
  log("主线:完成", "天猫下载", "日期确认", `页面日期文本=${currentDateText || "未读到"}`);
  await captureTmallPageCheckpoint(page, `${checkpointPrefix}-选择日期后`);
  await captureDownloadEvidence(page, options, buildTmallDownloadEvidenceLabel(sourceReportKeys, "日期已确认"));
  return page;
}

async function prepareTmallReportPage(browser, input) {
  // 该函数只按报表类型选择唯一的页面准备流程。
  if (input.reportType.isServiceQualityReport) {
    return prepareTmallServiceQualityPage(browser, input);
  }
  return prepareTmallPerformancePage(browser, input);
}

module.exports = {
  resolveTmallReportType,
  prepareTmallReportPage
};
