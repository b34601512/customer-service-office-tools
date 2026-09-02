// 该文件用于解决用户直接关闭控制台浏览器窗口后后台仍继续运行的问题。
const { log, logError } = require("../engine/logger");

const DEFAULT_WINDOW_CHECK_INTERVAL_MS = 1000;

function createControlCenterWindowLifecycleState() {
  // 该函数用于保存控制台窗口生命周期监控状态，避免轮询逻辑散落临时变量。
  return {
    hasSeenWindow: false,
    checking: false,
    shutdownRequested: false,
    stopped: false
  };
}

async function checkControlCenterWindowLifecycle(state, dependencies) {
  // 该函数只做一次窗口存活判断，发现用户已关窗口时统一触发退出主线。
  if (!state || state.stopped || state.checking) {
    return false;
  }

  const isWindowOpen = dependencies && dependencies.isWindowOpen;
  const requestShutdown = dependencies && dependencies.requestShutdown;
  if (typeof isWindowOpen !== "function") {
    throw new Error("控制台窗口监控失败：缺少窗口存活检测函数。");
  }
  if (typeof requestShutdown !== "function") {
    throw new Error("控制台窗口监控失败：缺少统一退出函数。");
  }

  state.checking = true;
  try {
    const isOpen = await isWindowOpen();
    if (isOpen) {
      state.hasSeenWindow = true;
      return false;
    }

    if (!state.hasSeenWindow || state.shutdownRequested) {
      return false;
    }

    state.shutdownRequested = true;
    state.stopped = true;
    log("主线:停止", "网页控制台", "窗口生命周期", "检测到控制台窗口已关闭，准备执行统一退出清理");
    await requestShutdown("控制台窗口已关闭");
    return true;
  } catch (error) {
    logError("主线:失败", "网页控制台", "窗口生命周期", error);
    return false;
  } finally {
    state.checking = false;
  }
}

function startControlCenterWindowLifecycleMonitor(dependencies) {
  // 该函数只负责启动窗口监控轮询，退出清理始终交给 shutdown 主线执行。
  const state = createControlCenterWindowLifecycleState();
  const intervalMs = Math.max(300, Number(dependencies && dependencies.intervalMs) || DEFAULT_WINDOW_CHECK_INTERVAL_MS);
  const runCheck = () => {
    checkControlCenterWindowLifecycle(state, dependencies).catch((error) => {
      logError("主线:失败", "网页控制台", "窗口生命周期", error);
    });
  };

  runCheck();
  const timer = setInterval(runCheck, intervalMs);
  if (timer && typeof timer.unref === "function") {
    timer.unref();
  }

  return () => {
    state.stopped = true;
    clearInterval(timer);
  };
}

module.exports = {
  createControlCenterWindowLifecycleState,
  checkControlCenterWindowLifecycle,
  startControlCenterWindowLifecycleMonitor
};
