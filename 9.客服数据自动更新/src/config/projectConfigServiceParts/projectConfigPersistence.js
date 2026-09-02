const appConfig = require("../appConfig");
const { log } = require("../../engine/logger");
const { readJsonFile, writeJsonFileAtomic } = require("../../shared/fileStore");
const {
  synchronizeGlobalExportDateRangeForSave
} = require("./projectConfigGlobalDateSync");
const { applyGlobalDownloadRootToProjectConfig } = require("./projectConfigGlobalDownloadSync");
const {
  readProjectConfigFileSignature,
  isProjectConfigCacheFresh,
  refreshProjectConfigCache
} = require("./projectConfigCache");
const projectConfigCacheState = require("./projectConfigCacheState");
const { normalizeProjectConfigPayload } = require("./projectConfigNormalization");
const { clone } = require("./projectConfigValuePrimitives");

function readProjectConfig() {
  // 这个函数只读取和校验配置，禁止创建、迁移、刷新日期或写盘。
  const fileSignature = readProjectConfigFileSignature();
  if (isProjectConfigCacheFresh(fileSignature)) {
    return clone(projectConfigCacheState.projectConfigCache.config);
  }
  const fileConfig = readJsonFile(appConfig.projectConfigPath, "项目配置");
  const normalizedConfig = normalizeProjectConfigPayload(fileConfig);
  refreshProjectConfigCache(normalizedConfig);
  return clone(normalizedConfig);
}

function applyRequestedGlobalConfigSynchronizations(nextConfig, options) {
  // 这个函数只执行本次保存明确请求的总配置同步动作。
  if (options.applyGlobalExportDateRangeToAllStores) {
    synchronizeGlobalExportDateRangeForSave(
      nextConfig,
      options.requestedGlobalExportDateMode,
      new Date()
    );
    log("主线:完成", "项目配置", "总配置同步", "首页总配置已同步覆盖全部平台店铺日期，并恢复为跟随全局。");
  }
  const synchronizationActions = [
    [options.applyGlobalDownloadRootToAllStores, applyGlobalDownloadRootToProjectConfig, "首页总配置已同步覆盖全部平台店铺下载目录。"]
  ];
  synchronizationActions.filter(([shouldApply]) => shouldApply).forEach(([, applyAction, message]) => {
    applyAction(nextConfig);
    log("主线:完成", "项目配置", "总配置同步", message);
  });
}

function saveProjectConfig(payload, options = {}) {
  // 这个函数只校验、同步并原子保存一次项目配置。
  const nextConfig = normalizeProjectConfigPayload(payload || {});
  applyRequestedGlobalConfigSynchronizations(nextConfig, options);
  writeJsonFileAtomic(appConfig.projectConfigPath, nextConfig);
  log("主线:完成", "项目配置", "保存配置", `配置文件已写入：${appConfig.projectConfigPath}`);
  refreshProjectConfigCache(nextConfig);
  return readProjectConfig();
}

module.exports = {
  readProjectConfig,
  saveProjectConfig
};
