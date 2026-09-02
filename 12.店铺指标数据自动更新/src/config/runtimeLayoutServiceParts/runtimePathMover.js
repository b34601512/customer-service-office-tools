// 该文件用于解决旧运行目录到新分层目录的迁移问题。
const fs = require("fs");
const path = require("path");
const { ensureDir } = require("../../engine/fileSystem");
const { log } = require("../../engine/logger");
const { pathExists, removeDirIfEmpty } = require("./runtimePathHelpers");

function moveRuntimeEntry(sourcePath, targetPath, backupRootDir) {
  // 这个函数只负责把一个运行目录条目移动到目标位置，目录冲突时递归合并。
  if (!pathExists(sourcePath)) {
    return false;
  }

  const normalizedSourcePath = path.resolve(sourcePath);
  const normalizedTargetPath = path.resolve(targetPath);
  if (normalizedSourcePath === normalizedTargetPath) {
    return false;
  }

  ensureDir(path.dirname(normalizedTargetPath));
  if (!pathExists(normalizedTargetPath)) {
    fs.renameSync(normalizedSourcePath, normalizedTargetPath);
    return true;
  }

  const sourceStat = fs.statSync(normalizedSourcePath);
  const targetStat = fs.statSync(normalizedTargetPath);
  if (!sourceStat.isDirectory() || !targetStat.isDirectory()) {
    throw new Error(`运行目录迁移失败，目标已存在且无法自动合并：${normalizedTargetPath}`);
  }

  for (const childName of fs.readdirSync(normalizedSourcePath)) {
    moveRuntimeEntry(
      path.join(normalizedSourcePath, childName),
      path.join(normalizedTargetPath, childName),
      backupRootDir
    );
  }

  removeDirIfEmpty(normalizedSourcePath, backupRootDir);
  return true;
}

function moveWithLog(sourcePath, targetPath, options = {}) {
  // 这个函数只负责迁移成功后的统一日志，迁移动作本身交给 moveRuntimeEntry。
  const logFn = options.logFn || log;
  const moved = moveRuntimeEntry(sourcePath, targetPath, options.backupRootDir);
  if (moved) {
    logFn("主线:完成", options.moduleName || "运行目录", options.subAction || "迁移运行目录", `已迁移：${sourcePath} -> ${targetPath}`);
  }
  return moved;
}

function isDeferredMigrationError(error) {
  // 这个函数只识别 Windows 目录占用错误，用于把旧目录迁移延后到下次启动。
  return Boolean(error) && ["EPERM", "EACCES", "EBUSY"].includes(error.code);
}

function tryMoveWithLog(sourcePath, targetPath, options = {}) {
  // 这个函数只负责把可延后迁移的占用错误转成日志，其它错误必须暴露。
  const logFn = options.logFn || log;
  try {
    return moveWithLog(sourcePath, targetPath, options);
  } catch (error) {
    if (isDeferredMigrationError(error)) {
      logFn(
        "主线:提示",
        "运行目录",
        "延后迁移",
        `${options.pendingDetail || "目标目录当前被占用"}，暂不迁移：${sourcePath}，原因=${error.message || String(error)}`
      );
      return false;
    }

    throw error;
  }
}

module.exports = {
  tryMoveWithLog
};
