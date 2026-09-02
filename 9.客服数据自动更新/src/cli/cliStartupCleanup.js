// 启动期清理调度：浏览器缓存迁移可能耗时数百毫秒，
// 首屏渲染后再后台执行；汇总任务启动前会确保清理已完成。
const { cleanStoreBrowserCachesWhenSafe, cleanRuntimeDownloadRunsWhenSafe } = require("../config/runtimeLayoutService");

let scheduledCleanupPromise = null;

function scheduleStartupCleanup(reason = "CLI启动前自动清理") {
  if (scheduledCleanupPromise) {
    return scheduledCleanupPromise;
  }
  // 用 setImmediate 而不是微任务：保证已排队的 TUI 首帧先绘制，清理在后台进行。
  scheduledCleanupPromise = new Promise((resolve) => {
    setImmediate(() => {
      try {
        cleanStoreBrowserCachesWhenSafe(reason);
        cleanRuntimeDownloadRunsWhenSafe(reason);
      } catch (_cleanupError) {
        // 清理失败不阻断控制台；日志中会保留原因。
      }
      resolve();
    });
  });
  return scheduledCleanupPromise;
}

function ensureStartupCleanupDone() {
  return scheduledCleanupPromise || scheduleStartupCleanup();
}

module.exports = { scheduleStartupCleanup, ensureStartupCleanupDone };
