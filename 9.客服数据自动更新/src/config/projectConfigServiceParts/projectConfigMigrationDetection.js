// 该文件只负责判断旧项目配置是否需要规范化并持久化。
const appConfig = require("../appConfig");
const { remapRuntimeMigrationPath } = require("../runtimePathParts/runtimeMigrationPaths");
const { createDefaultProjectConfig } = require("../projectConfigDefaults");
const {
  normalizeString
} = require("./projectConfigValuePrimitives");
const {
  resolveStoreDownloadDir,
  isSamePath
} = require("./projectConfigDownloadPaths");
const { isManualDateRange, isManualDatePoint } = require("./projectConfigManualDateRules");

function shouldPersistManualDateMigration(fileConfig) {
  // 该函数只判断全局及店铺日期是否仍需迁移成手动日期。
  if (!isManualDateRange(fileConfig?.globalDefaults?.exportDateRange)) {
    return true;
  }

  const platformKeys = ["tmall", "jd", "pdd", "douyin"];

  return platformKeys.some((platformKey) => {
    const stores = Array.isArray(fileConfig?.[platformKey]?.stores) ? fileConfig[platformKey].stores : [];
    return stores.some((store) => {
      const exportDateRange = store?.exportDateRange || {};
      return !isManualDatePoint(exportDateRange.start) || !isManualDatePoint(exportDateRange.end);
    });
  });
}

function shouldPersistDateAutomationMigration(fileConfig) {
  // 该函数只判断新日期策略和单店跟随标记是否需要补齐落盘。
  const dateAutomation = fileConfig?.globalDefaults?.exportDateAutomation;
  if (
    !["automatic", "manual"].includes(fileConfig?.globalDefaults?.exportDateMode) ||
    !Number.isInteger(dateAutomation?.endDateDelayDayCount)
  ) {
    return true;
  }

  const platformKeys = ["tmall", "jd", "pdd", "douyin"];
  return platformKeys.some((platformKey) => {
    const stores = Array.isArray(fileConfig?.[platformKey]?.stores) ? fileConfig[platformKey].stores : [];
    return stores.some((store) => typeof store?.usesGlobalExportDateRange !== "boolean");
  });
}

function shouldPersistReportProfileNormalization(fileConfig) {
  // 该函数只判断报表结构是否需要补齐。
  const defaultConfig = createDefaultProjectConfig();
  const platformKeys = ["tmall", "jd", "pdd", "douyin"];

  return platformKeys.some((platformKey) => {
    const defaultProfiles = defaultConfig?.[platformKey]?.stores?.[0]?.reportProfiles || {};
    const defaultProfileKeys = Object.keys(defaultProfiles);
    const stores = Array.isArray(fileConfig?.[platformKey]?.stores) ? fileConfig[platformKey].stores : [];
    return stores.some((store) => {
      const reportProfiles = store?.reportProfiles;
      return (
        !reportProfiles ||
        typeof reportProfiles !== "object" ||
        Array.isArray(reportProfiles) ||
        !reportProfiles.performance ||
        defaultProfileKeys.some((profileKey) => {
          const reportProfile = reportProfiles[profileKey];
          if (!reportProfile) {
            return true;
          }
          const configuredMetricKeys = new Set(
            (Array.isArray(reportProfile.metricMappings) ? reportProfile.metricMappings : [])
              .map((metricMapping) => normalizeString(metricMapping?.key))
              .filter(Boolean)
          );
          return (defaultProfiles[profileKey].metricMappings || []).some(
            (metricMapping) => !configuredMetricKeys.has(normalizeString(metricMapping?.key))
          );
        })
      );
    });
  });
}

function shouldPersistStoreIsolationNormalization(fileConfig) {
  // 该函数只判断店铺下载目录是否已按平台和店铺隔离。
  const platformKeys = ["tmall", "jd", "pdd", "douyin"];

  return platformKeys.some((platformKey) => {
    const stores = Array.isArray(fileConfig?.[platformKey]?.stores) ? fileConfig[platformKey].stores : [];
    return stores.some((store, index) => {
      const storeKey = normalizeString(store?.key || `store${index + 1}`);
      const rawDownloadDir = remapRuntimeMigrationPath(
        appConfig.projectRoot,
        normalizeString(store?.downloadDir)
      );
      return !storeKey || !isSamePath(
        rawDownloadDir,
        resolveStoreDownloadDir(platformKey, storeKey, rawDownloadDir)
      );
    });
  });
}

function shouldPersistKdocsSyncMigration(fileConfig) {
  const settings = fileConfig?.kdocsDataDetailSync;
  if (!settings || typeof settings !== "object" || Array.isArray(settings)) return true;
  return [
    "syncWebhookUrl",
    "syncApiToken",
    "filterWebhookUrl",
    "filterApiToken",
    "customerServiceNameWebhookUrl",
    "customerServiceNameApiToken"
  ].some((key) => !Object.prototype.hasOwnProperty.call(settings, key)) ||
    Object.prototype.hasOwnProperty.call(settings, "webhookUrl") ||
    Object.prototype.hasOwnProperty.call(settings, "apiToken") ||
    Object.prototype.hasOwnProperty.call(settings, "sync") ||
    Object.prototype.hasOwnProperty.call(settings, "filter") ||
    Object.prototype.hasOwnProperty.call(settings, "customerServiceName");
}

module.exports = {
  shouldPersistManualDateMigration,
  shouldPersistDateAutomationMigration,
  shouldPersistReportProfileNormalization,
  shouldPersistStoreIsolationNormalization,
  shouldPersistKdocsSyncMigration
};
