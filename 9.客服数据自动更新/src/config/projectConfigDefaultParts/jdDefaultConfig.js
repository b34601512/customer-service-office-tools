// 该文件用于解决京东平台默认店铺配置问题。
const {
  createDefaultStoreDownloadDir,
  createDefaultManualExportDateRange,
  createStoreConfig
} = require("./defaultConfigBuilders");
const { applyPlatformReportDefaultsToStore } = require("../platformReportRuleParts/platformReportRuleService");

function createJdBaseStoreConfig(baseDate, storeKey, displayName) {
  // 这里统一京东店铺的账号和日期默认值，具体报表差异交给调用方传入。
  return {
    key: storeKey,
    displayName,
    username: "",
    password: "",
    customerServiceScope: { mode: "客服岗位", values: ["售前"] },
    downloadDir: createDefaultStoreDownloadDir("jd", storeKey),
    exportDateRange: createDefaultManualExportDateRange(baseDate)
  };
}

function createJdSystemStore(baseDate, storeKey = "jd6", displayName = "京东6店") {
  // 这里创建京东系统后台下载店铺，所有京东店铺共用同一套业绩来源和字段规则。
  return applyPlatformReportDefaultsToStore("jd", createStoreConfig(
    createJdBaseStoreConfig(baseDate, storeKey, displayName),
    {}
  ));
}

function createJdDefaultConfig(baseDate) {
  return {
    stores: [
      createJdSystemStore(baseDate, "jd1", "京东1店"),
      createJdSystemStore(baseDate, "jd3", "京东3店"),
      createJdSystemStore(baseDate, "jd6", "京东6店")
    ]
  };
}

module.exports = {
  createJdDefaultConfig
};
