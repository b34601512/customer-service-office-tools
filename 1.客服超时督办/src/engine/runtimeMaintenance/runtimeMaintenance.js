const appConfig = require("../../config/appConfig");
const { currentLogFilePath, log, logError } = require("../logger");
const {
  collectBusinessBrowserDataDirs,
  collectControlCenterBrowserDataDirs,
  sanitizeBrowserDataDirs
} = require("../browserCacheSanitizer");
const { compactLogFileIfNeeded } = require("./logFileCompactor");
const { compactRuntimeStateFiles } = require("./stateCompactor");

function normalizeMaintenanceInterval(intervalMs) {
  // 该函数限制自动巡检最短间隔，避免配置写错后清理任务反过来拖慢程序。
  const numericIntervalMs = Number(intervalMs);
  return Number.isFinite(numericIntervalMs) && numericIntervalMs >= 60 * 1000
    ? Math.floor(numericIntervalMs)
    : appConfig.runtimeMaintenanceIntervalMs;
}

function buildRuntimeMaintenanceOptions(options = {}) {
  // 该函数统一运行膨胀治理参数，让启动前治理和运行中治理共用同一套规则。
  return {
    moduleName: options.moduleName || "运行膨胀治理",
    browserDataDirs: Array.isArray(options.browserDataDirs) ? options.browserDataDirs : [],
    logMaxBytes: Number(options.logMaxBytes || appConfig.runtimeMaintenanceLogMaxBytes),
    logKeepBytes: Number(options.logKeepBytes || appConfig.runtimeMaintenanceLogKeepBytes),
    stateRetentionDays: Number(options.stateRetentionDays ?? appConfig.runtimeMaintenanceStateRetentionDays),
    maxStateEntries: Number(options.maxStateEntries || appConfig.runtimeMaintenanceMaxStateEntries),
    nowMs: Number(options.nowMs || Date.now())
  };
}

function logLogCompactionResult(moduleName, result) {
  // 该函数只在日志真的被裁剪时打印结果，避免每次巡检都刷屏。
  if (!result.changed) {
    return;
  }

  log(
    "主线:完成",
    moduleName,
    "裁剪日志",
    `裁剪前=${(result.beforeBytes / 1024 / 1024).toFixed(2)} MB，裁剪后=${(result.afterBytes / 1024 / 1024).toFixed(2)} MB`
  );
}

function logStateCompactionResult(moduleName, result) {
  // 该函数只在状态库真的裁剪时打印结果，保证日志有用但不刷屏。
  if (result.removedCount <= 0) {
    return;
  }

  log(
    "主线:完成",
    moduleName,
    "裁剪状态",
    `状态文件=${result.changedFileCount} 个，移除过期条目=${result.removedCount}`
  );
}

function runRuntimeMaintenanceOnce(options = {}) {
  // 该函数执行一次运行膨胀治理：启动前可清浏览器缓存，运行中只裁剪日志和状态。
  const normalizedOptions = buildRuntimeMaintenanceOptions(options);
  const logResult = compactLogFileIfNeeded(currentLogFilePath, {
    maxBytes: normalizedOptions.logMaxBytes,
    keepBytes: normalizedOptions.logKeepBytes
  });
  const stateResult = compactRuntimeStateFiles({
    retentionDays: normalizedOptions.stateRetentionDays,
    maxEntries: normalizedOptions.maxStateEntries,
    nowMs: normalizedOptions.nowMs
  });
  const browserResult = normalizedOptions.browserDataDirs.length > 0
    ? sanitizeBrowserDataDirs(normalizedOptions.browserDataDirs, `${normalizedOptions.moduleName}-浏览器缓存`)
    : { removedCount: 0, removedBytes: 0 };

  logLogCompactionResult(normalizedOptions.moduleName, logResult);
  logStateCompactionResult(normalizedOptions.moduleName, stateResult);
  if (logResult.changed || stateResult.removedCount > 0 || browserResult.removedCount > 0) {
    log(
      "主线:完成",
      normalizedOptions.moduleName,
      "自动治理完成",
      `日志裁剪=${logResult.changed ? "是" : "否"}，状态移除=${stateResult.removedCount}，缓存移除=${browserResult.removedCount}`
    );
  }

  return { logResult, stateResult, browserResult };
}

function startRuntimeMaintenanceLoop(options = {}) {
  // 该函数启动低频运行中巡检，不清正在使用的浏览器缓存，只处理日志和状态膨胀。
  const intervalMs = normalizeMaintenanceInterval(options.intervalMs);
  const moduleName = options.moduleName || "运行膨胀治理";
  const timer = setInterval(() => {
    try {
      runRuntimeMaintenanceOnce({
        ...options,
        moduleName,
        browserDataDirs: []
      });
    } catch (error) {
      logError("主线:失败", moduleName, "自动治理失败", error);
    }
  }, intervalMs);

  if (typeof timer.unref === "function") {
    timer.unref();
  }

  return () => clearInterval(timer);
}

function runBusinessRuntimeMaintenanceBeforeLaunch() {
  // 该函数在业务浏览器启动前清理可重建缓存，避免运行中删除浏览器正在使用的文件。
  return runRuntimeMaintenanceOnce({
    moduleName: "业务运行膨胀治理",
    browserDataDirs: collectBusinessBrowserDataDirs()
  });
}

function runControlCenterRuntimeMaintenanceBeforeLaunch() {
  // 该函数在控制台浏览器启动前清理控制台缓存，保留登录态和本地配置。
  return runRuntimeMaintenanceOnce({
    moduleName: "控制台运行膨胀治理",
    browserDataDirs: collectControlCenterBrowserDataDirs()
  });
}

module.exports = {
  buildRuntimeMaintenanceOptions,
  runBusinessRuntimeMaintenanceBeforeLaunch,
  runControlCenterRuntimeMaintenanceBeforeLaunch,
  runRuntimeMaintenanceOnce,
  startRuntimeMaintenanceLoop
};
