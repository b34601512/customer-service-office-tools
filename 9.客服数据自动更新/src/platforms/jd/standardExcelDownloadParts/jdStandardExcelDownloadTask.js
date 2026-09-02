// 该文件用于解决京东标准 Excel 下载总调度问题。
const { connectToChrome, disconnectFromChrome } = require("../../../engine/chromeSession");
const { log } = require("../../../engine/logger");
const { resolveExportDateRange } = require("../../../shared/exportDateRange");
const { waitForJdLoginReady } = require("../loginReadyParts/jdLoginReadyPolling");
const { resolveStoreDownloadDir, enableDownloadBehavior } = require("../jdDownloadArtifacts");
const { reportProgress } = require("../downloadTaskParts/jdDownloadProgress");
const { executeJdStandardReportQuery } = require("./jdStandardReportQuery");
const { exportJdStandardExcel } = require("./jdStandardExcelExporter");
const { ensureJdSystemRequiredMetricsVisible } = require("../requiredMetricParts/jdRequiredMetricsRunner");

function resolveJdStandardExcelDownloadDependencies(overrides = {}) {
  // 这里集中收口下载主流程依赖，方便测试验证异步清理顺序而不碰真实浏览器。
  return {
    connectToChrome,
    disconnectFromChrome,
    waitForJdLoginReady,
    resolveStoreDownloadDir,
    enableDownloadBehavior,
    executeJdStandardReportQuery,
    exportJdStandardExcel,
    ensureJdSystemRequiredMetricsVisible,
    resolveExportDateRange,
    reportProgress,
    ...overrides
  };
}

async function confirmJdLoggedInPage(browser, resolvedConfig, onProgress = null, dependencies = {}) {
  // 京东下载只承认系统数据明细页，任意其他业务页都不是下载就绪状态。
  const activeDependencies = resolveJdStandardExcelDownloadDependencies(dependencies);
  activeDependencies.reportProgress(onProgress, "确认已登录页面", "准备接管当前浏览器里的京东登录态");
  const readyPage = await activeDependencies.waitForJdLoginReady(browser, {
    storeConfig: resolvedConfig.activeStore,
    ensureTargetPage: true
  });
  await readyPage.bringToFront();
  return readyPage;
}

function assertJdDownloadPlan(downloadPlan) {
  // 这里校验唯一下载计划的两个必要动作，缺少任一动作都立即停止。
  if (!downloadPlan || typeof downloadPlan.openReportContext !== "function") {
    throw new Error("京东标准 Excel 下载失败：缺少报表入口函数。");
  }
  if (typeof downloadPlan.applyDateRange !== "function") {
    throw new Error("京东标准 Excel 下载失败：缺少日期设置函数。");
  }
}

async function restoreJdManualDownloadDir(page, configuredDownloadDir, dependencies = {}) {
  // 这里在自动下载结束后恢复人工下载目录，避免用户后续手动下载落到运行缓存目录。
  if (!page || !configuredDownloadDir) {
    return;
  }

  const activeDependencies = resolveJdStandardExcelDownloadDependencies(dependencies);
  await activeDependencies.enableDownloadBehavior(page, configuredDownloadDir);
  log("主线:完成", "京东下载", "恢复人工下载目录", `已恢复人工下载目录=${configuredDownloadDir}`);
}

async function runJdStandardExcelDownloadWithDependencies(
  resolvedConfig,
  downloadPlan,
  onProgress = null,
  dependencies = {},
  options = {}
) {
  // 这里编排京东“拿到标准 Excel”的完整流程，具体入口差异由下载计划提供。
  const activeDependencies = resolveJdStandardExcelDownloadDependencies(dependencies);
  assertJdDownloadPlan(downloadPlan);
  const exportRange = activeDependencies.resolveExportDateRange(resolvedConfig.activeStore.exportDateRange, new Date());
  activeDependencies.reportProgress(onProgress, "连接调试浏览器", `店铺=${resolvedConfig.activeStore.displayName}`);
  const browser = await activeDependencies.connectToChrome();
  let page = null;
  let configuredDownloadDir = "";

  try {
    const readyPage = await confirmJdLoggedInPage(browser, resolvedConfig, onProgress, activeDependencies);
    const reportContext = await downloadPlan.openReportContext({
      browser,
      readyPage,
      resolvedConfig,
      onProgress
    });
    page = reportContext.page;
    configuredDownloadDir = activeDependencies.resolveStoreDownloadDir(resolvedConfig.activeStore);

    await activeDependencies.executeJdStandardReportQuery({
      page,
      surface: reportContext.surface,
      exportRange,
      applyDateRange: downloadPlan.applyDateRange,
      customerServiceScope: resolvedConfig.activeStore.customerServiceScope,
      onProgress
    });

    activeDependencies.reportProgress(onProgress, "校验指标列", "确认当前京东系统页面包含本报表目标列");
    await activeDependencies.ensureJdSystemRequiredMetricsVisible({
      surface: reportContext.surface,
      resolvedConfig,
      exportRange,
      onProgress
    });

    return await activeDependencies.exportJdStandardExcel({
      browser,
      page,
      surface: reportContext.surface,
      resolvedConfig,
      exportRange,
      onProgress,
      evidenceDir: options.evidenceDir,
      evidenceFiles: options.evidenceFiles,
      evidenceFileNamePrefix: options.evidenceFileNamePrefix
    });
  } finally {
    try {
      await restoreJdManualDownloadDir(page, configuredDownloadDir, activeDependencies);
    } finally {
      await activeDependencies.disconnectFromChrome(browser, "京东标准 Excel 下载流程已结束，主动断开调试连接");
    }
  }
}

async function runJdStandardExcelDownload(resolvedConfig, downloadPlan, onProgress = null, options = {}) {
  // 这里使用真实依赖运行生产下载流程。
  return runJdStandardExcelDownloadWithDependencies(resolvedConfig, downloadPlan, onProgress, {}, options);
}

module.exports = {
  runJdStandardExcelDownload
};
