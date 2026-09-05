const { readProjectConfig } = require("../../config/projectConfigServiceParts/projectConfigPersistence");
const { resolvePlatformStoreConfig } = require("../../config/projectConfigServiceParts/projectConfigStoreResolver");
const { runStoreSummary } = require("../storeSummaryParts/summaryStoreRunner");
const { buildManualDateRangeConfig } = require("../tmallSummaryWindow");
const { ensurePlatformStoreWindowForSummary } = require("./summaryStoreWindow");

function buildResolvedConfigForSummaryTask({ platformKey, storeKey, reportKey, dateRange, projectConfig }) {
  // 这个函数只把一个报表锁定到唯一长期汇总表和本轮日期；配置优先用调用方注入的本轮配置，避免隔离运行读串生产路径。
  const activeProjectConfig = projectConfig || readProjectConfig();
  const resolvedConfig = resolvePlatformStoreConfig(platformKey, storeKey, reportKey, activeProjectConfig);
  resolvedConfig.activeStore.exportDateRange = buildManualDateRangeConfig(dateRange);
  resolvedConfig.workbook = { path: String(activeProjectConfig.workbook?.path || "").trim() };
  return { projectConfig: activeProjectConfig, resolvedConfig };
}

async function runSingleSummaryTask({ task, dateRange, forceRedownload = false, onTaskProgress, projectConfig }) {
  // 这个函数只把一家店交给源表取得与写表执行器。
  const activeProjectConfig = projectConfig || readProjectConfig();
  return runStoreSummary({
    task,
    dateRange,
    forceRedownload,
    projectConfig: activeProjectConfig,
    onTaskProgress,
    buildResolvedConfig: (input) => buildResolvedConfigForSummaryTask({ ...input, projectConfig: activeProjectConfig }),
    ensurePlatformWindow: ensurePlatformStoreWindowForSummary
  });
}

module.exports = {
  runSingleSummaryTask
};
