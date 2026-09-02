// 该文件用于解决京东下载目录中文件状态枚举和新下载痕迹识别问题。
const fs = require("fs");
const path = require("path");

function isTemporaryDownloadFile(fileName) {
  return /\.(crdownload|tmp)$/i.test(fileName || "");
}

function listDownloadArtifacts(downloadDir) {
  // 这里统一枚举下载目录里的文件状态，供“开始下载”和“文件落盘”共用。
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

module.exports = {
  isTemporaryDownloadFile,
  listDownloadArtifacts,
  findLatestNewDownloadArtifact
};
