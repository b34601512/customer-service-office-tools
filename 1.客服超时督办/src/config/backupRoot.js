const path = require("path");

function resolveCurrentDiskBackupRoot(projectRoot) {
  // 该函数用于把备份目录固定到当前项目所在硬盘根目录，避免跨机器时盘符写死。
  const parsedRoot = path.parse(path.resolve(projectRoot));
  if (!parsedRoot.root) {
    throw new Error("备份目录解析失败：无法识别当前项目所在硬盘。");
  }

  return path.join(parsedRoot.root, "备份文件夹");
}

module.exports = {
  resolveCurrentDiskBackupRoot
};
