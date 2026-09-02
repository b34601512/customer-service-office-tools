// 该文件用于解决天猫下载文件复制到正式路径的问题。
const fs = require("fs");

function copyDownloadToFinalPath(downloadedPath, finalPath) {
  // 这里保留浏览器原始下载文件，只复制到正式目录，避免 Chrome 下载记录显示“已删除”。
  fs.copyFileSync(downloadedPath, finalPath);
}

module.exports = {
  copyDownloadToFinalPath
};
