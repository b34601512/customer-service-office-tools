// 该文件用于解决抖音飞鸽客服数据默认店铺配置问题。
const {
  createDefaultStoreDownloadDir,
  createDefaultManualExportDateRange,
  createStoreConfig
} = require("./defaultConfigBuilders");
const { applyPlatformReportDefaultsToStore } = require("../platformReportRuleParts/platformReportRuleService");

function applyDouyinQualityDefaults(storeConfig) {
  // 抖音同一份官方导出已可提供五项原始指标。
  const normalizedStoreConfig = applyPlatformReportDefaultsToStore("douyin", storeConfig);
  ["response_time", "three_minute_response_rate"].forEach((reportKey) => {
    normalizedStoreConfig.reportProfiles[reportKey].enabled = true;
  });
  return normalizedStoreConfig;
}

function createDouyinDefaultStore(baseDate, storeKey, displayName) {
  // 抖音客服数据来自飞鸽一个导出文件，统一进入数据明细。
  const storeConfig = createStoreConfig(
    {
      key: storeKey,
      displayName,
      platformStoreId: "",
      platformStoreName: "",
      username: "",
      password: "",
      downloadDir: createDefaultStoreDownloadDir("douyin", storeKey),
      exportDateRange: createDefaultManualExportDateRange(baseDate)
    },
    {}
  );
  return applyDouyinQualityDefaults(storeConfig);
}

function createDouyinDefaultConfig(baseDate) {
  return {
    stores: [
      createDouyinDefaultStore(baseDate, "douyin1", "德达抖音"),
      createDouyinDefaultStore(baseDate, "douyin2", "dedakj抖音")
    ]
  };
}

module.exports = {
  createDouyinDefaultConfig
};
