// 该文件用于解决天猫下载目录扫描、重复后缀识别和完成文件定位问题。
const fs = require("fs");
const path = require("path");

function isTemporaryDownloadFile(fileName) {
  return /\.(crdownload|tmp)$/i.test(fileName || "");
}

function listDownloadArtifacts(downloadDir) {
  // 这里统一枚举下载目录里的文件状态，供“下载开始”和“下载完成”两段检测共用。
  if (!downloadDir || !fs.existsSync(downloadDir)) {
    return [];
  }

  return fs
    .readdirSync(downloadDir, { withFileTypes: true })
    .filter((entry) => entry.isFile())
    .map((entry) => {
      const fullPath = path.join(downloadDir, entry.name);
      const stat = fs.statSync(fullPath);
      return {
        name: entry.name,
        fullPath,
        size: stat.size,
        modifiedAt: stat.mtimeMs
      };
    })
    .sort((left, right) => right.modifiedAt - left.modifiedAt);
}

function findLatestNewDownloadArtifact(downloadDir, beforeFiles) {
  // 这里只返回本轮新增、非临时且非空的真实下载文件。
  return listDownloadArtifacts(downloadDir).find(
    (item) => !beforeFiles.has(item.name) && !isTemporaryDownloadFile(item.name) && item.size > 0
  ) || null;
}

function buildKnownFileSet(beforeFiles = [], preferredName = "") {
  const knownFiles = new Set(Array.from(beforeFiles || []));
  if (preferredName) {
    knownFiles.delete(preferredName);
  }
  return knownFiles;
}

function buildDuplicateSuffixPattern(preferredName = "") {
  const extension = path.extname(preferredName || "");
  const baseName = path.basename(preferredName || "", extension);
  if (!baseName) {
    return null;
  }

  const escapedBaseName = baseName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const escapedExtension = extension.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`^${escapedBaseName}( \\(\\d+\\))?${escapedExtension}$`, "i");
}

function findCompletedDownloadArtifact(downloadDirs, beforeFiles, preferredName = "") {
  // 这里统一从多个候选目录里找最终文件，避免浏览器把文件落到系统下载目录后后台还在原地等待。
  const knownFiles = buildKnownFileSet(beforeFiles, preferredName);
  const duplicateSuffixPattern = buildDuplicateSuffixPattern(preferredName);

  for (const downloadDir of downloadDirs) {
    const currentFiles = listDownloadArtifacts(downloadDir);

    if (preferredName) {
      const preferredFile = currentFiles.find(
        (item) =>
          (item.name === preferredName || duplicateSuffixPattern?.test(item.name)) &&
          !isTemporaryDownloadFile(item.name) &&
          item.size > 0
      );
      if (preferredFile) {
        return preferredFile;
      }
    }

    const stableNewFile = currentFiles.find(
      (item) =>
        !knownFiles.has(item.name) &&
        !isTemporaryDownloadFile(item.name) &&
        item.size > 0
    );
    if (stableNewFile) {
      return stableNewFile;
    }
  }

  return null;
}

module.exports = {
  isTemporaryDownloadFile,
  listDownloadArtifacts,
  findLatestNewDownloadArtifact,
  buildDuplicateSuffixPattern,
  findCompletedDownloadArtifact
};
