// 该文件用于解决受控 Chrome 优雅关闭、强制清理和会话状态清理问题。
const appConfig = require("../../config/appConfig");
const { log, logError } = require("../logger");
const { readManagedPid, clearManagedPid } = require("../managedProcessParts/managedPidStore");
const {
  closeProcessMainWindow,
  killProcessTree,
  killProcessesByCommandLine
} = require("../managedProcessParts/processCloser");
const {
  buildManagedChromeMatchTokens,
  clearManagedChromeSession,
  readManagedChromeSession
} = require("./chromeSessionPaths");
const { requestChromeCloseOverCDP } = require("./chromeHeadlessCloser");
const { waitForChromeDebugPortClosed } = require("./chromePortWaiters");
const { releaseDebugPort } = require("./chromePortGuard");
const { findProcessIdsByCommandLine } = require("../managedProcessParts/processQuery");

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
  const recordedPid = readManagedPidFn(appConfig.chromePidPath);
  const commandLineTokens = buildManagedChromeMatchTokens();
  const findOwnedPidsFn = dependencies.findProcessIdsByCommandLine || findProcessIdsByCommandLine;
  let chromePid = 0;
  let closedGracefully = false;
  let debugPortClosed = false;

  try {
    const ownedPids = recordedPid ? await findOwnedPidsFn(commandLineTokens) : [];
    chromePid = ownedPids.includes(recordedPid) ? recordedPid : 0;
    if (chromePid) {
      try {
        const currentSession = (dependencies.readManagedChromeSession || readManagedChromeSession)();
        const requestedGracefulClose = currentSession?.headless === true
          ? await (dependencies.requestChromeCloseOverCDP || requestChromeCloseOverCDP)(appConfig.tmall.cdpEndpoint)
          : await closeProcessMainWindowFn(chromePid, "调试 Chrome");
        if (requestedGracefulClose) {
          logFn(
            "主线:等待",
            "浏览器引擎",
            "优雅关闭",
            currentSession?.headless === true
              ? `已发送 Chrome CDP 关闭请求，PID=${chromePid}，等待调试端口释放`
              : `已发送 Chrome 主窗口关闭请求，PID=${chromePid}，等待调试端口释放`
          );
          closedGracefully = await waitForChromeDebugPortClosedFn({
            timeoutMs: 8000,
            pollIntervalMs: 300
          });
          if (closedGracefully) {
            logFn("主线:完成", "浏览器引擎", "优雅关闭", `调试 Chrome 已正常退出，PID=${chromePid}`);
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
      logFn("主线:等待", "浏览器引擎", "强制清理", `已按记录 PID 强制关闭调试 Chrome，等待调试端口释放，PID=${chromePid}`);
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
        logFn("主线:等待", "浏览器引擎", "强制清理", "已按命令行清理残留调试 Chrome，继续等待调试端口释放");
      }
    } catch (error) {
      if (!chromePid) {
        throw new Error(`关闭调试 Chrome 失败：未读取到有效 PID，且扫描残留进程失败：${error.message}`);
      }
      logErrorFn("主线:失败", "浏览器引擎", "扫描残留进程", error);
    }

    debugPortClosed = await waitForChromeDebugPortClosedFn({
      timeoutMs: 5000,
      pollIntervalMs: 300
    });
    const closed = killedByPid || killedByScan;
    if (!debugPortClosed) {
      // 最终兜底：按端口清理带调试标志的监听进程（覆盖外部残留浏览器，如不同 user-data-dir 的僵尸 Chrome）。
      let releasedByPort = false;
      try {
        releasedByPort = await releaseDebugPortFn(appConfig.tmall.remoteDebuggingPort);
      } catch (error) {
        logErrorFn("主线:失败", "浏览器引擎", "端口守卫兜底", error);
      }
      if (!releasedByPort) {
        throw new Error(
          `关闭调试 Chrome 失败：已完成全部清理，但调试端口 ${appConfig.tmall.remoteDebuggingPort} 仍未释放，不能继续拉起新店浏览器。`
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
