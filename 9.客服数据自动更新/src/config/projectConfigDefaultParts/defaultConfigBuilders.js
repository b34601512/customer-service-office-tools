// 该文件用于解决项目默认配置的通用构造器问题。
const appConfig = require("../appConfig");
const {
  createExportDateRangeConfig,
  createDefaultExportDateAutomationConfig,
  createDefaultCompletedExportDateRangeConfig,
  resolveExportDateRangeToManualConfig
} = require("../../shared/exportDateRange");
const {
  createReportProfile
} = require("../storeReportProfileHelpers");
const {
  createDefaultMetricMappingsForReport,
  getReportModule,
  listEnabledReportModules
} = require("../reportModuleDefinitions");

function createMetricMapping(key, sourceFieldLabel = "") {
  return {
    key,
    sourceFieldLabel
  };
}

function createDefaultStoreDownloadDir(platformKey, storeKey = "") {
  const normalizedStoreKey = String(storeKey || "").trim();
  if (normalizedStoreKey) {
    return appConfig.getStoreDownloadDir(platformKey, normalizedStoreKey);
  }

  if (platformKey === "tmall") {
    return appConfig.tmall.downloadDir;
  }
  if (platformKey === "jd") {
    return appConfig.jd.downloadDir;
  }
  if (platformKey === "pdd") {
    return appConfig.pdd.downloadDir;
  }
  if (platformKey === "douyin") {
    return appConfig.runtime.output.getPlatformDownloadDir("douyin");
  }
  return appConfig.runtime.output.getPlatformDownloadDir(platformKey);
}

function createDefaultDownloadRootDir() {
  return appConfig.runtime.output.downloadsRoot;
}

function createDefaultManualExportDateRange(baseDate, options) {
  if (!options) {
    return createDefaultCompletedExportDateRangeConfig(baseDate);
  }

  return resolveExportDateRangeToManualConfig(
    createExportDateRangeConfig(options),
    createExportDateRangeConfig(options),
    "默认导出日期",
    baseDate
  );
}

function createReportProfileConfig(reportKey = "performance", reportConfig = {}) {
  // 这里按统计指标创建店铺报表配置，通用下载规则复用，指标映射按报表单独隔离。
  const reportModule = getReportModule(reportKey);
  const metricMappings = Array.isArray(reportConfig.metricMappings)
    ? reportConfig.metricMappings
    : createDefaultMetricMappingsForReport(reportKey);

  return createReportProfile(reportKey, {
    displayName: reportConfig.displayName || reportModule.displayName,
    siteUrl: reportConfig.siteUrl,
    downloadMode: reportConfig.downloadMode,
    sourceSheetMode: reportConfig.sourceSheetMode,
    sourceSheetName: reportConfig.sourceSheetName,
    sourceSheetIndex: reportConfig.sourceSheetIndex,
    sourceAliasFieldLabel: reportConfig.sourceAliasFieldLabel,
    metricMappings
  });
}

function createGlobalPerformanceReportDefaults(reportConfig = {}) {
  // 这里只保存全店铺共用的客服姓名映射，指标和下载规则仍然由各店铺自己维护。
  return {
    personMappings: Array.isArray(reportConfig.personMappings) ? reportConfig.personMappings : []
  };
}

function createStoreConfig(baseStoreConfig, reportConfig) {
  const reportProfiles = {};
  listEnabledReportModules().forEach((reportModule) => {
    reportProfiles[reportModule.key] = createReportProfileConfig(reportModule.key, {
      ...reportConfig,
      displayName: reportModule.displayName,
      metricMappings:
        reportModule.key === "performance"
          ? reportConfig.metricMappings
          : createDefaultMetricMappingsForReport(reportModule.key)
    });
  });

  return {
    key: baseStoreConfig.key,
    includedInSummary: baseStoreConfig.includedInSummary !== false,
    displayName: baseStoreConfig.displayName,
    platformStoreId: baseStoreConfig.platformStoreId || "",
    platformStoreName: baseStoreConfig.platformStoreName || "",
    username: baseStoreConfig.username || "",
    password: baseStoreConfig.password || "",
    customerServiceScope: baseStoreConfig.customerServiceScope || undefined,
    downloadDir: baseStoreConfig.downloadDir,
    usesGlobalExportDateRange: true,
    exportDateRange: baseStoreConfig.exportDateRange,
    reportProfiles
  };
}

module.exports = {
  createMetricMapping,
  createDefaultStoreDownloadDir,
  createDefaultDownloadRootDir,
  createDefaultManualExportDateRange,
  createDefaultExportDateAutomationConfig,
  createGlobalPerformanceReportDefaults,
  createStoreConfig
};
