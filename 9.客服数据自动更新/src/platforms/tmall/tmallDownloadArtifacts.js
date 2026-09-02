// 该文件用于保留天猫下载产物公共入口，并统一导出拆分后的下载动作。
const {
  resolveStoreDownloadDir,
  buildDownloadPath,
  createRunDownloadDir,
  buildPreferredDownloadFileName,
  looksLikeGuidFileName
} = require("./downloadArtifactParts/tmallDownloadPathBuilders");
const { findLatestNewDownloadArtifact } = require("./downloadArtifactParts/tmallDownloadArtifactScanner");
const { copyDownloadToFinalPath } = require("./downloadArtifactParts/tmallDownloadPersistence");

module.exports = {
  resolveStoreDownloadDir,
  buildDownloadPath,
  createRunDownloadDir,
  buildPreferredDownloadFileName,
  looksLikeGuidFileName,
  findLatestNewDownloadArtifact,
  copyDownloadToFinalPath
};
