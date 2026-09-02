// 该文件用于保留 runtime 初始化入口，并把迁移、建目录和缓存清理委托给拆分后的子模块。
const { initializeRuntimeLayout } = require("./runtimeLayoutServiceParts/runtimeLayoutInitializer");
const {
  cleanRuntimeBrowserCachesWhenSafe,
  cleanStoreBrowserCachesWhenSafe,
  cleanActiveStoreBrowserCachesWhenSafe
} = require("./runtimeLayoutServiceParts/runtimeBrowserCacheCleanup");
const {
  cleanRuntimeDownloadRunsWhenSafe
} = require("./runtimeLayoutServiceParts/runtimeDownloadRunCleanup");

module.exports = {
  initializeRuntimeLayout,
  cleanRuntimeBrowserCachesWhenSafe,
  cleanStoreBrowserCachesWhenSafe,
  cleanActiveStoreBrowserCachesWhenSafe,
  cleanRuntimeDownloadRunsWhenSafe
};
