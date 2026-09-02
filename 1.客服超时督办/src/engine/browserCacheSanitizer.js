const fs = require("fs");
const path = require("path");
const appConfig = require("../config/appConfig");
const { log } = require("./logger");

const ROOT_CACHE_NAMES = [
  "BrowserMetrics",
  "DeferredBrowserMetrics",
  "ActorSafetyLists",
  "CertificateRevocation",
  "component_crx_cache",
  "extensions_crx_cache",
  "GraphiteDawnCache",
  "GrShaderCache",
  "MediaFoundationWidevineCdm",
  "OpenCookieDatabase",
  "optimization_guide_model_store",
  "OptimizationHints",
  "Safe Browsing",
  "ShaderCache",
  "Crashpad",
  "WasmTtsEngine",
  "WidevineCdm",
  "ZxcvbnData"
];

const ROOT_CACHE_FILES = [
  "BrowserMetrics-spare.pma",
  "CrashpadMetrics-active.pma"
];

const PROFILE_CACHE_NAMES = [
  "Cache",
  "Code Cache",
  "GPUCache",
  "DawnGraphiteCache",
  "DawnWebGPUCache",
  "Shared Dictionary",
  "Safe Browsing Network",
  "AutofillAiModelCache"
];

function deduplicatePaths(paths) {
  // 该函数用于合并缓存清理目录，避免同一个目录被重复扫描和重复打印日志。
  return [...new Set((paths || []).filter(Boolean))];
}

function collectBusinessBrowserDataDirs() {
  // 该函数用于收集业务浏览器目录，只清后台督办使用的登录态目录和历史目录。
  return deduplicatePaths([appConfig.userDataDir, ...(appConfig.legacyBrowserDataDirs || [])]);
}

function collectControlCenterBrowserDataDirs() {
  // 该函数用于收集控制台浏览器目录，必须只在控制台窗口启动前调用。
  return deduplicatePaths([appConfig.controlCenterUserDataDir]);
}

function sumPathSizeBytes(targetPath) {
  // 该函数用于递归统计缓存目标大小，清理日志必须能说明释放了多少空间。
  const stat = fs.statSync(targetPath);
  if (stat.isFile()) {
    return stat.size;
  }

  let totalBytes = 0;
  for (const entry of fs.readdirSync(targetPath, { withFileTypes: true })) {
    totalBytes += sumPathSizeBytes(path.join(targetPath, entry.name));
  }
  return totalBytes;
}

function formatMegabytes(bytes) {
  // 该函数用于把字节数统一展示成 MB，方便直接判断清理收益。
  return `${(bytes / 1024 / 1024).toFixed(2)} MB`;
}

function buildCleanupTargets(browserDataDir) {
  // 该函数只列出可重建缓存，不碰 Cookies、Local Storage、IndexedDB 等登录态核心数据。
  const targets = [];

  for (const name of ROOT_CACHE_NAMES) {
    targets.push(path.join(browserDataDir, name));
  }

  for (const name of ROOT_CACHE_FILES) {
    targets.push(path.join(browserDataDir, name));
  }

  const profileDir = path.join(browserDataDir, appConfig.runtimeProfileName);
  for (const name of PROFILE_CACHE_NAMES) {
    targets.push(path.join(profileDir, name));
  }

  return targets;
}

function removeCacheTarget(targetPath) {
  // 该函数只执行缓存目标移除，调用前必须已经确认路径来自白名单。
  const stat = fs.statSync(targetPath);
  if (stat.isDirectory()) {
    fs.rmSync(targetPath, { recursive: true, force: false });
    return;
  }

  fs.rmSync(targetPath, { force: false });
}

function sanitizeSingleBrowserDataDir(browserDataDir, moduleName) {
  // 该函数清理单个浏览器数据目录里的可重建缓存，并保留登录态核心文件。
  if (!fs.existsSync(browserDataDir)) {
    log("主线:执行", moduleName, "跳过目录", `目录不存在，无需清理：${browserDataDir}`);
    return { removedCount: 0, removedBytes: 0 };
  }

  log("主线:执行", moduleName, "扫描目录", `开始清理浏览器缓存：${browserDataDir}`);
  let removedCount = 0;
  let removedBytes = 0;

  for (const targetPath of buildCleanupTargets(browserDataDir)) {
    if (!fs.existsSync(targetPath)) {
      continue;
    }

    const bytes = sumPathSizeBytes(targetPath);
    try {
      removeCacheTarget(targetPath);
    } catch (error) {
      throw new Error(`浏览器缓存清理失败：${targetPath}，原因=${error.message}`);
    }

    removedCount += 1;
    removedBytes += bytes;
    log("主线:执行", moduleName, "删除目标", `路径=${targetPath}，释放=${formatMegabytes(bytes)}`);
  }

  log(
    "主线:完成",
    moduleName,
    "目录清理完成",
    `目录=${browserDataDir}，删除=${removedCount} 项，释放=${formatMegabytes(removedBytes)}`
  );

  return { removedCount, removedBytes };
}

function sanitizeBrowserDataDirs(browserDataDirs, moduleName) {
  // 该函数统一调度一组浏览器目录清理，上层决定清业务浏览器还是控制台浏览器。
  let totalRemovedCount = 0;
  let totalRemovedBytes = 0;

  for (const browserDataDir of deduplicatePaths(browserDataDirs)) {
    const result = sanitizeSingleBrowserDataDir(browserDataDir, moduleName);
    totalRemovedCount += result.removedCount;
    totalRemovedBytes += result.removedBytes;
  }

  log(
    "主线:完成",
    moduleName,
    "自动清理完成",
    `共清理 ${totalRemovedCount} 项缓存，释放=${formatMegabytes(totalRemovedBytes)}`
  );

  return { removedCount: totalRemovedCount, removedBytes: totalRemovedBytes };
}

function sanitizeBusinessBrowserCaches() {
  // 该函数用于后台任务启动前清理业务浏览器缓存。
  return sanitizeBrowserDataDirs(collectBusinessBrowserDataDirs(), "业务浏览器缓存");
}

function sanitizeControlCenterBrowserCaches() {
  // 该函数用于控制台窗口启动前清理控制台浏览器缓存。
  return sanitizeBrowserDataDirs(collectControlCenterBrowserDataDirs(), "控制台浏览器缓存");
}

module.exports = {
  buildCleanupTargets,
  collectBusinessBrowserDataDirs,
  collectControlCenterBrowserDataDirs,
  sanitizeBrowserDataDirs,
  sanitizeBusinessBrowserCaches,
  sanitizeControlCenterBrowserCaches
};
