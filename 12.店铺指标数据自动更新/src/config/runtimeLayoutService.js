// 该文件用于保留 runtime 初始化入口，并把迁移、建目录和缓存清理委托给拆分后的子模块。
// 缓存清理只保留开单店窗前的当前账号清理；全量清理链路经老板拍板已移除（issue #556）。
const { initializeRuntimeLayout } = require("./runtimeLayoutServiceParts/runtimeLayoutInitializer");
const {
  cleanActiveStoreBrowserCachesWhenSafe
} = require("./runtimeLayoutServiceParts/runtimeBrowserCacheCleanup");

module.exports = {
  initializeRuntimeLayout,
  cleanActiveStoreBrowserCachesWhenSafe
};
