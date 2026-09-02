// 该文件用于解决受控 Chrome 优雅关闭、强制清理和会话状态清理问题。
const appConfig = require("../../config/appConfig");
const { log, logError } = require("../logger");
const { readManagedPid, clearManagedPid } = require("../managedProcessParts/managedPidStore");
const {
  closeProcessMainWindow,
  killProcessTree,
  killProcessesByCommandLine
} = require("../managedProcessParts/processCloser");
const { buildManagedChromeMatchTokens, clearManagedChromeSession } = require("./chromeSessionPaths");
const { waitForChromeDebugPortClosed } = require("./chromePortWaiters");
const { releaseDebugPort } = require("./chromePortGuard");

async function closeManagedChromeWithDependencies(dependencies = {}) {
  // 这里先尝试正常关闭浏览器主窗口，再在必要时强制清理，既保证干净重置，也尽量避免弹出恢复页面气泡。
  const readManagedPidFn = dependencies.readManagedPid || readManagedPid;
  const closeProcessMainWindowFn = dependencies.closeProcessMainWindow || closeProcessMainWindow;
  const killProcessesByCommandLineFn = dependencies.killProcessesByCommandLine || killProcessesByCommandLine;
  const killProcessTreeFn = dependencies.killProcessTree || killProcessTree;
  const waitForChromeDebugPortClosedFn =
    dependencies.waitForChromeDebugPortClosed || waitForChromeDebugPortClosed;
  const releaseDebugPortFn = dependencies.releaseDebugPort || releaseDebugPort;
  const clearManagedPidFn = dependencies.clearManagedPid || clearManagedPid;
  const clearManagedChromeSessionFn =
    dependencies.clearManagedChromeSession || clearManagedChromeSession;
  const logFn = dependencies.logFn || log;
  const logErrorFn = dependencies.logErrorFn || logError;
  const chromePid = readManagedPidFn(appConfig.chromePidPath);
  const commandLineTokens = buildManagedChromeMatchTokens();
  let closedGracefully = false;
  let debugPortClosed = false;

  try {
    if (chromePid) {
      try {
        const requestedGracefulClose = await closeProcessMainWindowFn(chromePid, "调试浏览器");
        if (requestedGracefulClose) {
          logFn("主线:等待", "浏览器引擎", "优雅关闭", `已发送主窗口关闭请求，PID=${chromePid}，等待调试端口释放`);
          closedGracefully = await waitForChromeDebugPortClosedFn({
            timeoutMs: 8000,
            pollIntervalMs: 300
          });
          if (closedGracefully) {
            logFn("主线:完成", "浏览器引擎", "优雅关闭", `调试浏览器已正常退出，PID=${chromePid}`);
          } else {
            logFn("主线:等待", "浏览器引擎", "优雅关闭", `主窗口关闭后调试端口仍未释放，准备强制清理，PID=${chromePid}`);
          }
        }
      } catch (error) {
        logErrorFn("主线:失败", "浏览器引擎", "优雅关闭", error);
      }
    }

    if (closedGracefully) {
      return true;
    }

    const killedByPid = chromePid ? await killProcessTreeFn(chromePid, "调试浏览器") : false;
    if (killedByPid) {
      logFn("主线:等待", "浏览器引擎", "强制清理", `已按记录 PID 强制关闭调试浏览器，等待调试端口释放，PID=${chromePid}`);
    }
    debugPortClosed = await waitForChromeDebugPortClosedFn({
      timeoutMs: 15000,
      pollIntervalMs: 300
    });
    if (debugPortClosed) {
      return killedByPid;
    }

    let killedByScan = false;
    try {
      killedByScan = await killProcessesByCommandLineFn(commandLineTokens, "调试浏览器");
      if (killedByScan) {
        logFn("主线:等待", "浏览器引擎", "强制清理", "已按命令行清理残留调试浏览器，继续等待调试端口释放");
      }
    } catch (error) {
      if (!chromePid) {
        throw new Error(`关闭调试浏览器失败：未读取到有效 PID，且扫描残留进程失败：${error.message}`);
      }
      logErrorFn("主线:失败", "浏览器引擎", "扫描残留进程", error);
    }

    debugPortClosed = await waitForChromeDebugPortClosedFn({
      timeoutMs: 5000,
      pollIntervalMs: 300
    });
    const closed = killedByPid || killedByScan;
    if (!debugPortClosed) {
      // 最终兜底：按端口清理带调试标志的监听进程（覆盖外部残留浏览器，如不同 user-data-dir 的僵尸 Edge）。
      let releasedByPort = false;
      try {
        releasedByPort = await releaseDebugPortFn(appConfig.tmall.remoteDebuggingPort);
      } catch (error) {
        logErrorFn("主线:失败", "浏览器引擎", "端口守卫兜底", error);
      }
      if (!releasedByPort) {
        throw new Error(
          `关闭调试浏览器失败：已完成全部清理，但调试端口 ${appConfig.tmall.remoteDebuggingPort} 仍未释放，不能继续拉起新店浏览器。`
        );
      }
      return closed || true;
    }
    return closed;
  } finally {
    clearManagedPidFn(appConfig.chromePidPath);
    clearManagedChromeSessionFn();
  }
}

module.exports = {
  closeManagedChromeWithDependencies
};
