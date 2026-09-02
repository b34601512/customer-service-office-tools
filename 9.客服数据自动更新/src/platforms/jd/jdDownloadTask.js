// 该文件用于解决京东系统下载任务入口和对外接口注册问题。
const { applyJdSystemDateRange } = require("./systemDateParts/jdSystemDateRangeRunner");
const { reportProgress, resolveJdDownloadMode } = require("./downloadTaskParts/jdDownloadProgress");
const { runJdStandardExcelDownload } = require("./standardExcelDownloadParts/jdStandardExcelDownloadTask");
const { openJdSystemReportContext } = require("./standardExcelDownloadParts/jdSystemReportEntry");

function assertJdSystemDownloadMode(downloadMode, storeDisplayName) {
  // 这里明确京东只有系统下载一种合法配置，错误配置直接暴露。
  if (downloadMode !== "system") {
    throw new Error(
      `当前店铺「${storeDisplayName || "未命名店铺"}」的下载模式无效：${downloadMode || "未配置"}。`
    );
  }
}

function buildJdStandardExcelDownloadPlan() {
  // 这里只生成唯一的京东系统下载计划，让后续流程只接收一种执行结构。
  return {
    openReportContext: openJdSystemReportContext,
    applyDateRange: applyJdSystemDateRange
  };
}

async function downloadJdReport(onProgress = null, options = {}) {
  // 这里先校验当前店铺使用京东系统，再交给标准 Excel 下载骨架处理。
  const reportKey = String(options.reportKey || "performance").trim() || "performance";
  const resolvedConfig = options.resolvedConfig;
  if (!resolvedConfig?.activeStore) {
    throw new Error("执行京东下载失败：缺少当前汇总任务的店铺配置。");
  }
  const downloadMode = resolveJdDownloadMode(resolvedConfig.activeStore);
  reportProgress(
    onProgress,
    "确认下载方式",
    `店铺=${resolvedConfig.activeStore.displayName}，使用京东系统后台`
  );

  assertJdSystemDownloadMode(downloadMode, resolvedConfig.activeStore.displayName);
  const downloadPlan = buildJdStandardExcelDownloadPlan();

  return runJdStandardExcelDownload(resolvedConfig, downloadPlan, onProgress, options);
}

module.exports = {
  downloadJdReport,
  assertJdSystemDownloadMode,
  buildJdStandardExcelDownloadPlan
};
