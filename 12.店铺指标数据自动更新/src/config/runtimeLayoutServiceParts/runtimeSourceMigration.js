// 该文件用于解决旧 runtime 布局迁移到新 runtime 分层布局的问题。
const fs = require("fs");
const appConfig = require("../appConfig");
const { log } = require("../../engine/logger");
const { createRuntimeMigrationSourceLayout } = require("../runtimePathParts/runtimeMigrationPaths");
const { removeDirIfEmpty } = require("./runtimePathHelpers");
const { tryMoveWithLog } = require("./runtimePathMover");
const { isManagedProcessActive } = require("./runtimeProcessGuard");
const { migrateTaskHistory } = require("./runtimeHistoryMigration");

function buildMovePathFn(runtimeConfig, dependencies = {}) {
  // 这个函数只把迁移公共参数固化下来，避免每个迁移动作重复传备份目录和日志函数。
  return (sourcePath, targetPath, options = {}) =>
    tryMoveWithLog(sourcePath, targetPath, {
      ...options,
      backupRootDir: runtimeConfig.backupRootDir,
      logFn: dependencies.logFn || log
    });
}

function migrateManagedBrowserProfile(sourceDirPath, currentDirPath, runtimeConfig, pidPath, sourcePidPath, label, movePathFn, dependencies = {}) {
  // 这个函数只负责受控浏览器资料目录迁移，进程仍活着时必须延后。
  const logFn = dependencies.logFn || log;
  if (!sourceDirPath || !fs.existsSync(sourceDirPath)) {
    return false;
  }

  if (isManagedProcessActive(pidPath, sourcePidPath, dependencies)) {
    logFn("主线:提示", "运行目录", "延后迁移", `${label} 当前仍被受控进程占用，暂不迁移：${sourceDirPath}`);
    return false;
  }

  return movePathFn(sourceDirPath, currentDirPath, {
    moduleName: "运行目录",
    subAction: "迁移浏览器状态",
    pendingDetail: `${label} 目录当前仍被系统占用`
  });
}

function migrateRuntimeLayoutFromSource(runtimeConfig = appConfig, dependencies = {}) {
  // 这个函数只编排旧 runtime 布局迁移，不创建新目录，也不清理浏览器缓存。
  const sourceLayout = createRuntimeMigrationSourceLayout(runtimeConfig.projectRoot);
  const movePathFn = buildMovePathFn(runtimeConfig, dependencies);

  movePathFn(sourceLayout.chromePidPath, runtimeConfig.chromePidPath, {
    moduleName: "运行目录",
    subAction: "迁移进程状态"
  });
  movePathFn(`${sourceLayout.chromePidPath}.session.json`, runtimeConfig.chromeSessionPath, {
    moduleName: "运行目录",
    subAction: "迁移进程状态"
  });
  migrateManagedBrowserProfile(
    sourceLayout.chromeUserDataDir,
    runtimeConfig.chromeUserDataDir,
    runtimeConfig,
    runtimeConfig.chromePidPath,
    sourceLayout.chromePidPath,
    "人工登录浏览器状态",
    movePathFn,
    dependencies
  );
  migrateTaskHistory(sourceLayout, runtimeConfig, movePathFn, dependencies);

  movePathFn(sourceLayout.getPlatformDownloadRunDir("tmall"), runtimeConfig.runtime.cache.getPlatformDownloadRunDir("tmall"), {
    moduleName: "运行目录",
    subAction: "迁移下载缓存",
    pendingDetail: "天猫下载缓存当前被占用"
  });
  movePathFn(sourceLayout.getPlatformDownloadRunDir("jd"), runtimeConfig.runtime.cache.getPlatformDownloadRunDir("jd"), {
    moduleName: "运行目录",
    subAction: "迁移下载缓存",
    pendingDetail: "京东下载缓存当前被占用"
  });
  movePathFn(sourceLayout.getPlatformDownloadRunDir("pdd"), runtimeConfig.runtime.cache.getPlatformDownloadRunDir("pdd"), {
    moduleName: "运行目录",
    subAction: "迁移下载缓存",
    pendingDetail: "拼多多下载缓存当前被占用"
  });
  movePathFn(sourceLayout.getPlatformDownloadRunDir("douyin"), runtimeConfig.runtime.cache.getPlatformDownloadRunDir("douyin"), {
    moduleName: "运行目录",
    subAction: "迁移下载缓存",
    pendingDetail: "抖音下载缓存当前被占用"
  });
  movePathFn(sourceLayout.getPlatformDownloadDir("tmall"), runtimeConfig.tmall.downloadDir, {
    moduleName: "运行目录",
    subAction: "迁移业务下载",
    pendingDetail: "天猫业务下载当前被占用"
  });
  movePathFn(sourceLayout.getPlatformDownloadDir("jd"), runtimeConfig.jd.downloadDir, {
    moduleName: "运行目录",
    subAction: "迁移业务下载",
    pendingDetail: "京东业务下载当前被占用"
  });
  movePathFn(sourceLayout.getPlatformDownloadDir("pdd"), runtimeConfig.runtime.output.getPlatformDownloadDir("pdd"), {
    moduleName: "运行目录",
    subAction: "迁移业务下载",
    pendingDetail: "拼多多业务下载当前被占用"
  });
  movePathFn(sourceLayout.getPlatformDownloadDir("douyin"), runtimeConfig.runtime.output.getPlatformDownloadDir("douyin"), {
    moduleName: "运行目录",
    subAction: "迁移业务下载",
    pendingDetail: "抖音业务下载当前被占用"
  });
  movePathFn(sourceLayout.snapshotsRoot, runtimeConfig.runtime.cache.snapshotsRoot, {
    moduleName: "运行目录",
    subAction: "迁移页面快照",
    pendingDetail: "页面快照目录当前被占用"
  });

  removeDirIfEmpty(sourceLayout.downloadsRoot, runtimeConfig.backupRootDir);
  removeDirIfEmpty(sourceLayout.snapshotsRoot, runtimeConfig.backupRootDir);
}

module.exports = {
  migrateRuntimeLayoutFromSource
};
