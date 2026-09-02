const { resolveStoreReportProfile, buildReportScopedStoreConfig } = require("../storeReportProfileHelpers");
const { readProjectConfig } = require("./projectConfigPersistence");
const { clone, normalizeString } = require("./projectConfigValuePrimitives");

function resolvePlatformStoreConfig(platformKey, storeKey, reportKey = "performance") {
  // 这个函数只解析指定平台、店铺和报表的独立运行配置。
  const config = readProjectConfig();
  const platformConfig = config[platformKey];
  if (!platformConfig) {
    throw new Error(`未找到平台配置：${platformKey}`);
  }
  const normalizedStoreKey = normalizeString(storeKey);
  const targetStore = platformConfig.stores.find((item) => item.key === normalizedStoreKey);
  if (!targetStore) {
    throw new Error(`未找到 ${platformKey} 店铺配置：${normalizedStoreKey}`);
  }
  const reportProfile = resolveStoreReportProfile(targetStore, reportKey);
  if (reportProfile.enabled === false) {
    throw new Error(`当前店铺已禁用报表「${reportProfile.displayName || reportKey}」。`);
  }
  const reportScopedStore = buildReportScopedStoreConfig(targetStore, reportProfile);
  const runtimeStore = clone(reportScopedStore);
  runtimeStore.metricMappings = clone(reportScopedStore.metricMappings || []);
  runtimeStore.activeReportKey = normalizeString(reportScopedStore.activeReportKey || reportKey || "performance");
  runtimeStore.activeReportDisplayName = normalizeString(
    reportScopedStore.activeReportDisplayName || reportProfile.displayName || runtimeStore.activeReportKey
  );
  runtimeStore.reportProfile = clone(reportProfile);
  return {
    workbook: { path: normalizeString(config.workbook?.path) },
    platform: clone(platformConfig),
    reportKey: runtimeStore.activeReportKey,
    reportProfile: clone(reportProfile),
    activeStore: runtimeStore
  };
}

module.exports = {
  resolvePlatformStoreConfig
};
