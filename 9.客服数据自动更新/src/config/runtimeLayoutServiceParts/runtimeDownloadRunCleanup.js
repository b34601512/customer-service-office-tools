// 该文件用于解决下载中转目录跨运行长期保留重复源表的问题。
const fs = require("fs");
const path = require("path");
const appConfig = require("../appConfig");
const { ensureDir, movePathToBackup } = require("../../engine/fileSystem");
const { log } = require("../../engine/logger");
const { hasActiveGuardProcess } = require("./runtimeProcessGuard");

function hasDownloadRunArtifacts(downloadRunsRoot) {
  // 这个函数只判断下载中转目录里是否存在运行产物。
  if (!fs.existsSync(downloadRunsRoot)) {
    return false;
  }
  return fs.readdirSync(downloadRunsRoot, { withFileTypes: true }).some((entry) =>
    entry.isFile() ||
    (entry.isDirectory() && hasDownloadRunArtifacts(path.join(downloadRunsRoot, entry.name)))
  );
}

function cleanRuntimeDownloadRunsWithDependencies(options = {}, dependencies = {}) {
  // 这个函数只把一轮下载中转目录整体迁入备份，并重建空目录。
  const runtimeConfig = options.runtimeConfig || appConfig;
  const logFn = dependencies.logFn || log;
  const downloadRunsRoot = runtimeConfig.runtime.cache.downloadRunsRoot;
  const triggerName = String(options.triggerName || "下载中转自动清理").trim() || "下载中转自动清理";

  if (hasActiveGuardProcess([runtimeConfig.chromePidPath], dependencies)) {
    logFn("主线:跳过", "运行目录", triggerName, "检测到受控下载浏览器仍在运行，暂不迁移下载中转目录");
    return { skipped: true, backupPath: "" };
  }

  if (!hasDownloadRunArtifacts(downloadRunsRoot)) {
    ensureDir(downloadRunsRoot);
    logFn("主线:完成", "运行目录", triggerName, "没有发现需要迁移的下载中转文件");
    return { skipped: false, backupPath: "" };
  }

  const backupPath = movePathToBackup(
    downloadRunsRoot,
    runtimeConfig.backupRootDir,
    "下载中转文件",
    { date: dependencies.date || new Date() }
  );
  ensureDir(downloadRunsRoot);
  logFn("主线:完成", "运行目录", triggerName, `已迁移下载中转目录：${downloadRunsRoot} -> ${backupPath}`);
  return { skipped: false, backupPath };
}

function cleanRuntimeDownloadRunsWhenSafe(triggerName = "下载中转自动清理") {
  // 这个函数只按当前运行配置执行下载中转目录生命周期收尾。
  return cleanRuntimeDownloadRunsWithDependencies({ triggerName });
}

module.exports = {
  cleanRuntimeDownloadRunsWhenSafe,
  cleanRuntimeDownloadRunsWithDependencies,
  hasDownloadRunArtifacts
};
