const {
  resolveExportDateRangeToManualConfig,
  validateExportDateMode,
  validateExportDateAutomationConfig
} = require("../../shared/exportDateRange");
const { validatePersonMappings } = require("../storeReportProfileHelpers");
const { resolveDownloadRootDir } = require("./projectConfigDownloadPaths");
const { normalizeString, clone, hasOwn } = require("./projectConfigValuePrimitives");

function pickFallbackGlobalExportDateRange(platformConfigList, fallbackExportDateRange) {
  // 这个函数只从首个现存店铺取得旧全局日期回退值。
  for (const platformConfig of platformConfigList) {
    const firstStore = Array.isArray(platformConfig?.stores) ? platformConfig.stores.find(Boolean) : null;
    if (firstStore?.exportDateRange) {
      return clone(firstStore.exportDateRange);
    }
  }
  return clone(fallbackExportDateRange);
}

function validateGlobalPerformanceDefaults(globalDefaultsPayload, fallbackGlobalDefaults) {
  // 这个函数只校验全公司共用的账号归类。
  const payloadReportProfiles = globalDefaultsPayload?.reportProfiles &&
    typeof globalDefaultsPayload.reportProfiles === "object" &&
    !Array.isArray(globalDefaultsPayload.reportProfiles)
    ? globalDefaultsPayload.reportProfiles
    : {};
  const fallbackReportProfiles = fallbackGlobalDefaults?.reportProfiles &&
    typeof fallbackGlobalDefaults.reportProfiles === "object" &&
    !Array.isArray(fallbackGlobalDefaults.reportProfiles)
    ? fallbackGlobalDefaults.reportProfiles
    : {};
  const fallbackPerformanceDefaults = fallbackReportProfiles.performance || {};
  const performancePayload = hasOwn(payloadReportProfiles, "performance")
    ? payloadReportProfiles.performance || {}
    : fallbackPerformanceDefaults;
  return {
    personMappings: validatePersonMappings(
      performancePayload?.personMappings,
      fallbackPerformanceDefaults.personMappings,
      "总配置默认姓名匹配",
      normalizeString
    )
  };
}

function validateGlobalDefaults(globalDefaultsPayload, fallbackGlobalDefaults, platformConfigList = []) {
  // 这个函数只把总默认值校验成唯一配置结构。
  const fallbackExportDateRange = pickFallbackGlobalExportDateRange(
    platformConfigList,
    fallbackGlobalDefaults?.exportDateRange
  );
  return {
    downloadRootDir: resolveDownloadRootDir(
      globalDefaultsPayload?.downloadRootDir,
      fallbackGlobalDefaults?.downloadRootDir
    ),
    exportDateMode: validateExportDateMode(
      globalDefaultsPayload?.exportDateMode,
      fallbackGlobalDefaults?.exportDateMode
    ),
    exportDateAutomation: validateExportDateAutomationConfig(
      globalDefaultsPayload?.exportDateAutomation,
      fallbackGlobalDefaults?.exportDateAutomation
    ),
    exportDateRange: resolveExportDateRangeToManualConfig(
      globalDefaultsPayload?.exportDateRange || fallbackExportDateRange,
      fallbackExportDateRange,
      "总配置默认导出日期",
      new Date()
    ),
    reportProfiles: {
      performance: validateGlobalPerformanceDefaults(globalDefaultsPayload, fallbackGlobalDefaults)
    }
  };
}

module.exports = {
  validateGlobalDefaults
};
