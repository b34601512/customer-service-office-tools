// 该文件只负责项目配置文件签名与内存缓存刷新。
const fs = require("fs");
const appConfig = require("../appConfig");
const projectConfigCacheState = require("./projectConfigCacheState");
const { clone } = require("./projectConfigValuePrimitives");

function readProjectConfigFileSignature() {
  // 该函数只读取配置文件的修改时间和大小签名。
  const stat = fs.statSync(appConfig.projectConfigPath);
  return {
    mtimeMs: stat.mtimeMs,
    size: stat.size
  };
}

function isProjectConfigCacheFresh(signature) {
  // 该函数只判断当前缓存签名是否仍与文件一致。
  return Boolean(
    projectConfigCacheState.projectConfigCache &&
      projectConfigCacheState.projectConfigCache.signature &&
      projectConfigCacheState.projectConfigCache.signature.mtimeMs === signature.mtimeMs &&
      projectConfigCacheState.projectConfigCache.signature.size === signature.size
  );
}

function refreshProjectConfigCache(normalizedConfig) {
  // 该函数只用最新文件签名和配置副本刷新缓存。
  projectConfigCacheState.projectConfigCache = {
    signature: readProjectConfigFileSignature(),
    config: clone(normalizedConfig)
  };
}

module.exports = {
  readProjectConfigFileSignature,
  isProjectConfigCacheFresh,
  refreshProjectConfigCache
};
