// 该文件用于解决天猫平台默认店铺配置问题。
const {
  createDefaultStoreDownloadDir,
  createDefaultManualExportDateRange,
  createStoreConfig
} = require("./defaultConfigBuilders");
const { applyPlatformReportDefaultsToStore } = require("../platformReportRuleParts/platformReportRuleService");

function createTmallDefaultStore(baseDate, storeKey, displayName) {
  // 这里把天猫两家店的相同默认结构收口，避免指标配置重复散落。
  return applyPlatformReportDefaultsToStore("tmall", createStoreConfig(
    {
      key: storeKey,
      displayName,
      username: "",
      password: "",
      downloadDir: createDefaultStoreDownloadDir("tmall", storeKey),
      exportDateRange: createDefaultManualExportDateRange(baseDate)
    },
    {}
  ));
}

function createTmallDefaultConfig(baseDate) {
  return {
    stores: [
      createTmallDefaultStore(baseDate, "tmall1", "天猫1店"),
      createTmallDefaultStore(baseDate, "tmall2", "天猫2店")
    ]
  };
}

module.exports = {
  createTmallDefaultConfig
};
