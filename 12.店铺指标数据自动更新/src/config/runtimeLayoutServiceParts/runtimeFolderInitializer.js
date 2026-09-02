// 该文件用于解决 runtime 新分层目录创建问题。
const { ensureDir } = require("../../engine/fileSystem");

function ensureRuntimeFolders(runtimeConfig) {
  // 这个函数只补齐 runtime 必需目录，不做迁移和清理。
  ensureDir(runtimeConfig.runtime.root);
  ensureDir(runtimeConfig.runtime.stateRoot);
  ensureDir(runtimeConfig.runtime.outputRoot);
  ensureDir(runtimeConfig.runtime.cacheRoot);
  ensureDir(runtimeConfig.runtime.state.browserProfilesRoot);
  ensureDir(runtimeConfig.runtime.state.processRoot);
  ensureDir(runtimeConfig.runtime.state.historyRoot);
  ensureDir(runtimeConfig.runtime.output.downloadsRoot);
  ensureDir(runtimeConfig.runtime.cache.snapshotsRoot);
  ensureDir(runtimeConfig.runtime.cache.downloadRunsRoot);
  ensureDir(runtimeConfig.chromeUserDataDir);
  ensureDir(runtimeConfig.storeChromeProfilesRoot);
  ensureDir(runtimeConfig.tmall.snapshotDir);
  ensureDir(runtimeConfig.tmall.downloadDir);
  ensureDir(runtimeConfig.tmall.downloadRunDir);
  ensureDir(runtimeConfig.jd.downloadDir);
  ensureDir(runtimeConfig.jd.downloadRunDir);
  ensureDir(runtimeConfig.runtime.output.getPlatformDownloadDir("pdd"));
  ensureDir(runtimeConfig.runtime.cache.getPlatformDownloadRunDir("pdd"));
  ensureDir(runtimeConfig.runtime.output.getPlatformDownloadDir("douyin"));
  ensureDir(runtimeConfig.runtime.cache.getPlatformSnapshotDir("douyin"));
  ensureDir(runtimeConfig.runtime.cache.getPlatformDownloadRunDir("douyin"));
}

module.exports = {
  ensureRuntimeFolders
};
