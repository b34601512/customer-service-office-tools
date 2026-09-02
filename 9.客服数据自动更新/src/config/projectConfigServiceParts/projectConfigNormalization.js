const { createDefaultProjectConfig } = require("../projectConfigDefaults");
const { validateGlobalDefaults } = require("./projectConfigGlobalDefaultsValidation");
const { validatePlatformStores } = require("./projectConfigPlatformValidation");
const { validateWorkbookConfig } = require("./projectConfigWorkbookValidation");
const { validateKdocsDataDetailSyncConfig } = require("./projectConfigKdocsSyncValidation");

function normalizeProjectConfigPayload(fileConfig) {
  // 这个函数只把配置内容校验成唯一运行结构，不读取也不保存文件。
  const defaultConfig = createDefaultProjectConfig();
  const normalizedPlatforms = {
    workbook: validateWorkbookConfig(fileConfig.workbook || defaultConfig.workbook),
    kdocsDataDetailSync: validateKdocsDataDetailSyncConfig(
      fileConfig.kdocsDataDetailSync || defaultConfig.kdocsDataDetailSync
    ),
    tmall: validatePlatformStores("tmall", fileConfig.tmall, defaultConfig.tmall, "天猫"),
    jd: validatePlatformStores("jd", fileConfig.jd, defaultConfig.jd, "京东"),
    pdd: validatePlatformStores("pdd", fileConfig.pdd, defaultConfig.pdd, "拼多多", { allowEmptyStores: true }),
    douyin: validatePlatformStores("douyin", fileConfig.douyin, defaultConfig.douyin, "抖音", { allowEmptyStores: true })
  };
  return {
    ...normalizedPlatforms,
    globalDefaults: validateGlobalDefaults(
      fileConfig.globalDefaults,
      defaultConfig.globalDefaults,
      [normalizedPlatforms.tmall, normalizedPlatforms.jd, normalizedPlatforms.pdd, normalizedPlatforms.douyin]
    )
  };
}

module.exports = {
  normalizeProjectConfigPayload
};
