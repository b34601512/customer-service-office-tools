const fs = require("fs");
const path = require("path");

function ensureDir(dirPath) {
  // 这里统一补齐运行目录，避免首次启动时因为目录不存在直接失败。
  fs.mkdirSync(dirPath, { recursive: true });
}

function formatLocalDateTimeTag(date = new Date()) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  const hour = String(date.getHours()).padStart(2, "0");
  const minute = String(date.getMinutes()).padStart(2, "0");
  const second = String(date.getSeconds()).padStart(2, "0");
  return `${year}${month}${day}-${hour}${minute}${second}`;
}

function sanitizeBackupSegment(value) {
  return String(value || "未分类").replace(/[\\/:*?"<>|]/g, "-").trim() || "未分类";
}

function resolveUniquePath(targetPath) {
  if (!fs.existsSync(targetPath)) {
    return targetPath;
  }

  const parsedPath = path.parse(targetPath);
  let index = 2;
  while (true) {
    const candidatePath = path.join(parsedPath.dir, `${parsedPath.name}-${index}${parsedPath.ext}`);
    if (!fs.existsSync(candidatePath)) {
      return candidatePath;
    }
    index += 1;
  }
}

function movePathToBackup(sourcePath, backupRootDir, categoryName, options = {}) {
  // 这里把“清理文件”统一改成迁移到备份区，避免生产运行态被硬删除后无法追溯。
  if (!sourcePath || !fs.existsSync(sourcePath)) {
    return "";
  }
  if (!backupRootDir) {
    throw new Error("移动到备份文件夹失败：缺少备份根目录。");
  }

  const backupDir = path.join(
    backupRootDir,
    "店铺指标数据自动更新",
    sanitizeBackupSegment(categoryName),
    formatLocalDateTimeTag(options.date || new Date())
  );
  ensureDir(backupDir);
  const backupPath = resolveUniquePath(path.join(backupDir, path.basename(sourcePath)));
  fs.renameSync(sourcePath, backupPath);
  return backupPath;
}

module.exports = {
  ensureDir,
  movePathToBackup
};
