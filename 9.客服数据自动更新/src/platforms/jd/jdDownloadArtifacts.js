// 该文件用于保留京东下载产物公共入口，并统一导出拆分后的下载动作。
const {
  resolveStoreDownloadDir,
  buildDownloadPath,
  createRunDownloadDir,
  looksLikeGuidFileName,
  buildPreferredDownloadFileName
} = require("./downloadArtifactParts/jdDownloadPathBuilders");
const {
  findLatestNewDownloadArtifact
} = require("./downloadArtifactParts/jdDownloadArtifactScanner");
const { waitForDownloadStart } = require("./downloadArtifactParts/jdDownloadArtifactWaiters");
const {
  enableDownloadBehavior,
  copyDownloadToFinalPath
} = require("./downloadArtifactParts/jdBrowserDownloadPersistence");

module.exports = {
  resolveStoreDownloadDir,
  buildDownloadPath,
  createRunDownloadDir,
  looksLikeGuidFileName,
  buildPreferredDownloadFileName,
  findLatestNewDownloadArtifact,
  waitForDownloadStart,
  enableDownloadBehavior,
  copyDownloadToFinalPath
};
