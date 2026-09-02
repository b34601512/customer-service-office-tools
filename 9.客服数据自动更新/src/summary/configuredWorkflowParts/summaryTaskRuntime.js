const { readProjectConfig } = require("../../config/projectConfigServiceParts/projectConfigPersistence");
const { resolvePlatformStoreConfig } = require("../../config/projectConfigServiceParts/projectConfigStoreResolver");
const { runStoreSummary } = require("../storeSummaryParts/summaryStoreRunner");
const { buildManualDateRangeConfig } = require("../tmallSummaryWindow");
const { ensurePlatformStoreWindowForSummary } = require("./summaryStoreWindow");

function buildResolvedConfigForSummaryTask({ platformKey, storeKey, reportKey, dateRange }) {
  // 这个函数只把一个报表锁定到唯一长期汇总表和本轮日期。
  const projectConfig = readProjectConfig();
  const resolvedConfig = resolvePlatformStoreConfig(platformKey, storeKey, reportKey);
  resolvedConfig.activeStore.exportDateRange = buildManualDateRangeConfig(dateRange);
  resolvedConfig.workbook = { path: String(projectConfig.workbook?.path || "").trim() };
  return { projectConfig, resolvedConfig };
}

async function runSingleSummaryTask({ task, dateRange, forceRedownload = false, onTaskProgress }) {
  // 这个函数只把一家店交给源表取得与写表执行器。
  const projectConfig = readProjectConfig();
  return runStoreSummary({
    task,
    dateRange,
    forceRedownload,
    projectConfig,
    onTaskProgress,
    buildResolvedConfig: buildResolvedConfigForSummaryTask,
    ensurePlatformWindow: ensurePlatformStoreWindowForSummary
  });
}

module.exports = {
  runSingleSummaryTask
};
