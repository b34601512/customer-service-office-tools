// 该文件用于解决运行目录存在性判断和空目录迁移问题。
const fs = require("fs");
const { movePathToBackup } = require("../../engine/fileSystem");

function pathExists(targetPath) {
  // 这个函数只判断路径是否真实存在，避免各模块重复写空值判断。
  return Boolean(targetPath) && fs.existsSync(targetPath);
}

function removeDirIfEmpty(dirPath, backupRootDir) {
  // 这个函数只处理空目录迁移，避免旧 runtime 空壳继续污染项目结构。
  if (!pathExists(dirPath) || !fs.statSync(dirPath).isDirectory()) {
    return false;
  }

  if (fs.readdirSync(dirPath).length > 0) {
    return false;
  }

  movePathToBackup(dirPath, backupRootDir, "空运行目录");
  return true;
}

module.exports = {
  pathExists,
  removeDirIfEmpty
};
