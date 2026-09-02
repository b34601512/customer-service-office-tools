// 该文件用于解决 Chrome 浏览器资料目录里可再生成缓存的自动迁移问题。
const fs = require("fs");
const path = require("path");
const appConfig = require("../appConfig");
const { movePathToBackup } = require("../../engine/fileSystem");
const { log } = require("../../engine/logger");
const { hasActiveGuardProcess } = require("./runtimeProcessGuard");

const CLEANABLE_BROWSER_CACHE_DIR_NAMES = new Set([
  "cache",
  "code cache",
  "gpucache",
  "shadercache",
  "grshadercache",
  "dawncache",
  "safe browsing",
  "component_crx_cache",
  "widevinecdm",
  "wasmttsengine",
  "cachestorage"
]);

function isBrowserCacheDirName(dirName) {
  // 这个函数只判断目录名是不是 Chrome 可再生成缓存目录。
  return CLEANABLE_BROWSER_CACHE_DIR_NAMES.has(String(dirName || "").trim().toLowerCase());
}

function collectBrowserCacheDirs(profileRoot) {
  // 这个函数只收集缓存目录，碰到可清目录后不再继续深入，避免重复迁移子目录。
  const normalizedRoot = String(profileRoot || "").trim();
  if (!normalizedRoot || !fs.existsSync(normalizedRoot) || !fs.statSync(normalizedRoot).isDirectory()) {
    return [];
  }

  const cacheDirs = [];
  const visitDir = (currentDir) => {
    const dirName = path.basename(currentDir);
    if (isBrowserCacheDirName(dirName)) {
      cacheDirs.push(currentDir);
      return;
    }

    for (const entry of fs.readdirSync(currentDir, { withFileTypes: true })) {
      if (entry.isDirectory()) {
        visitDir(path.join(currentDir, entry.name));
      }
    }
  };

  visitDir(normalizedRoot);
  return cacheDirs;
}

function buildRuntimeBrowserCacheCleanupPlan(profileRoots) {
  // 这个函数只根据资料目录生成清理计划，不移动任何文件。
  const uniqueRoots = [...new Set((profileRoots || []).map((item) => String(item || "").trim()).filter(Boolean))];
  const cleanupPaths = uniqueRoots.flatMap((profileRoot) => collectBrowserCacheDirs(profileRoot));
  return [...new Set(cleanupPaths.map((item) => path.resolve(item)))].sort((left, right) => left.localeCompare(right));
}

function buildDefaultRuntimeBrowserCacheRoots(runtimeConfig = appConfig) {
  // 这个函数只返回业务采集浏览器资料根目录。
  return [
    runtimeConfig.storeChromeProfilesRoot,
    runtimeConfig.chromeUserDataDir
  ];
}

function buildActiveStoreBrowserCacheRoots(profileRoot, runtimeConfig = appConfig) {
  // 这个函数只返回当前店铺账号资料目录和旧共享目录，避免开单店窗口时扫描全部店铺账号。
  const normalizedProfileRoot = String(profileRoot || "").trim();
  return [
    normalizedProfileRoot,
    runtimeConfig.chromeUserDataDir
  ].filter(Boolean);
}

function moveBrowserCacheDirToBackup(cacheDir, backupRootDir, date) {
  // 这个函数只把一个缓存目录迁移到备份区，禁止硬删除。
  const backupPath = movePathToBackup(cacheDir, backupRootDir, "浏览器缓存", { date });
  if (!backupPath) {
    throw new Error(`浏览器缓存清理失败：缓存目录不存在或无法迁移：${cacheDir}`);
  }
  return backupPath;
}

function isTransientBrowserCacheLockError(error) {
  // Windows 关闭 Chrome 后句柄可能短暂滞留，只把明确的占用错误视为可恢复。
  return ["EPERM", "EBUSY", "EACCES"].includes(String(error?.code || "").toUpperCase());
}

function waitForBrowserCacheMoveRetry(milliseconds) {
  // 同步清理接口保持兼容，用很短的阻塞等待给 Chrome 子进程释放句柄。
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, milliseconds);
}

function moveBrowserCacheDirWithRetry(cacheDir, backupRootDir, date, dependencies = {}) {
  // 单个缓存最多迁移三次；持续占用时保留原目录，不阻断店铺主流程。
  const moveFn = dependencies.moveBrowserCacheDirToBackupFn || moveBrowserCacheDirToBackup;
  const waitFn = dependencies.waitForRetryFn || waitForBrowserCacheMoveRetry;
  const maximumAttempts = Number(dependencies.maximumMoveAttempts) || 3;
  let lastError = null;

  for (let attempt = 1; attempt <= maximumAttempts; attempt += 1) {
    try {
      return { backupPath: moveFn(cacheDir, backupRootDir, date), skippedLockedPath: "" };
    } catch (error) {
      if (!isTransientBrowserCacheLockError(error)) {
        throw error;
      }
      lastError = error;
      if (attempt < maximumAttempts) {
        waitFn(250);
      }
    }
  }

  return { backupPath: "", skippedLockedPath: cacheDir, error: lastError };
}

function cleanRuntimeBrowserCachesWithDependencies(options = {}, dependencies = {}) {
  // 这个函数只执行一次安全缓存清理，登录态目录由清理名单排除。
  const runtimeConfig = options.runtimeConfig || appConfig;
  const logFn = dependencies.logFn || log;
  const readManagedPid = dependencies.readManagedPid;
  const isProcessRunning = dependencies.isProcessRunning;
  const guardPidPaths = options.guardPidPaths || [];
  const triggerName = String(options.triggerName || "自动清理").trim() || "自动清理";

  if (hasActiveGuardProcess(guardPidPaths, { readManagedPid, isProcessRunning })) {
    logFn("主线:跳过", "运行目录", triggerName, "检测到浏览器进程仍在运行，暂不清理浏览器缓存");
    return {
      skipped: true,
      movedCount: 0,
      backupPaths: []
    };
  }

  const date = dependencies.date || new Date();
  const profileRoots = options.profileRoots || buildDefaultRuntimeBrowserCacheRoots(runtimeConfig);
  const cleanupPlan = buildRuntimeBrowserCacheCleanupPlan(profileRoots);
  if (!cleanupPlan.length) {
    logFn("主线:完成", "运行目录", triggerName, "没有发现需要迁移的浏览器缓存目录");
    return {
      skipped: false,
      movedCount: 0,
      backupPaths: []
    };
  }

  const backupPaths = [];
  const skippedLockedPaths = [];
  for (const cacheDir of cleanupPlan) {
    const moveResult = moveBrowserCacheDirWithRetry(cacheDir, runtimeConfig.backupRootDir, date, dependencies);
    if (moveResult.backupPath) {
      backupPaths.push(moveResult.backupPath);
      logFn("主线:完成", "运行目录", triggerName, `已迁移浏览器缓存：${cacheDir} -> ${moveResult.backupPath}`);
      continue;
    }
    skippedLockedPaths.push(moveResult.skippedLockedPath);
    logFn("主线:跳过", "运行目录", triggerName, `缓存仍被 Chrome 占用，已保留原目录并继续：${cacheDir}`);
  }

  logFn("主线:完成", "运行目录", triggerName, `本轮浏览器缓存清理完成，迁移目录数=${backupPaths.length}`);
  return {
    skipped: false,
    movedCount: backupPaths.length,
    backupPaths,
    skippedLockedPaths
  };
}

function cleanActiveStoreBrowserCachesWhenSafe(profileRoot, triggerName = "当前店铺浏览器缓存自动清理") {
  // 这个函数只在打开当前店铺窗口前清理本账号目录，避免日常路径递归扫描全部店铺资料。
  return cleanRuntimeBrowserCachesWithDependencies({
    triggerName,
    guardPidPaths: [appConfig.chromePidPath],
    profileRoots: buildActiveStoreBrowserCacheRoots(profileRoot, appConfig)
  });
}

module.exports = {
  cleanActiveStoreBrowserCachesWhenSafe,
  buildActiveStoreBrowserCacheRoots,
  buildRuntimeBrowserCacheCleanupPlan,
  cleanRuntimeBrowserCachesWithDependencies,
  moveBrowserCacheDirWithRetry,
  isTransientBrowserCacheLockError
};
