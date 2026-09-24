// 该文件用于解决京东下载目录中文件状态枚举和新下载痕迹识别问题。
const fs = require("fs");
const path = require("path");
const { 查找完整临时下载产物 } = require("../../../shared/completeTemporaryArtifact");

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
  // 这里只返回本轮新增、非临时且非空的真实下载文件；
  // Chrome 偶发不把已完整的 .crdownload 收尾改名时，校验结构完整后恢复成正式文件再返回。
  const normal = listDownloadArtifacts(downloadDir).find(
    (item) => !beforeFiles.has(item.name) && !isTemporaryDownloadFile(item.name) && item.size > 0
  );
  if (normal) return normal;
  return 查找完整临时下载产物(downloadDir, beforeFiles, { stableMs: 2000 });
}

module.exports = {
  isTemporaryDownloadFile,
  listDownloadArtifacts,
  findLatestNewDownloadArtifact
};
