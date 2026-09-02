// 该文件用于解决拼多多平台默认店铺配置问题。
const {
  createDefaultStoreDownloadDir,
  createDefaultManualExportDateRange,
  createStoreConfig
} = require("./defaultConfigBuilders");
const { applyPlatformReportDefaultsToStore } = require("../platformReportRuleParts/platformReportRuleService");

function createPddDefaultStore(baseDate, storeKey, displayName) {
  // 这里把拼多多店铺差异限制在店铺名，下载路径和指标规则保持同源。
  const storeConfig = applyPlatformReportDefaultsToStore("pdd", createStoreConfig(
    {
      key: storeKey,
      displayName,
      username: "",
      password: "",
      downloadDir: createDefaultStoreDownloadDir("pdd", storeKey),
      exportDateRange: createDefaultManualExportDateRange(baseDate)
    },
    {}
  ));
  if (storeConfig.reportProfiles.customer_satisfaction) {
    storeConfig.reportProfiles.customer_satisfaction.enabled = false;
  }
  return storeConfig;
}

function createPddDefaultConfig(baseDate) {
  return {
    stores: [
      createPddDefaultStore(baseDate, "pdd02", "德达拼多多02"),
      createPddDefaultStore(baseDate, "pdd03", "DEDAKJ拼多多03")
    ]
  };
}

module.exports = {
  createPddDefaultConfig
};
