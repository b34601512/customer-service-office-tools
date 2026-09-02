const {
  resolveDownloadRootDir,
  buildStoreDownloadDirFromRoot
} = require("./projectConfigDownloadPaths");

const PROJECT_PLATFORM_KEYS = ["tmall", "jd", "pdd", "douyin"];

function applyGlobalDownloadRootToProjectConfig(projectConfig) {
  // 这个函数只按总下载根目录重建四个平台的店铺隔离目录。
  const downloadRootDir = resolveDownloadRootDir(projectConfig?.globalDefaults?.downloadRootDir);
  if (!downloadRootDir) {
    return projectConfig;
  }
  PROJECT_PLATFORM_KEYS.forEach((platformKey) => {
    const platform = projectConfig?.[platformKey];
    if (!Array.isArray(platform?.stores)) {
      return;
    }
    platform.stores = platform.stores.map((store) => ({
      ...store,
      downloadDir: buildStoreDownloadDirFromRoot(downloadRootDir, platformKey, store.key)
    }));
  });
  return projectConfig;
}

module.exports = {
  applyGlobalDownloadRootToProjectConfig
};
