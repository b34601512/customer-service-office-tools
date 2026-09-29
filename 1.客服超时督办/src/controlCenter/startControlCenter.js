const net = require("net");
const { log, logError, resetCurrentLogFileOnce } = require("../engine/logger");
const { subscribeLogs } = require("../engine/logHub");
const { ControlCenterState } = require("./controlCenterState");
const { ControlCenterTaskService } = require("./controlCenterTaskService");
const { createServer } = require("./controlCenterServer");
const { startControlCenterCleanupWatchdog } = require("./controlCenterCleanupWatchdog");
const { createTui } = require("./tui/startTui");
const { startRuntimeMaintenanceLoop } = require("../engine/runtimeMaintenance/runtimeMaintenance");

const defaultPort = 39360;

function assertTuiTerminalAvailable() {
  if (process.stdout.isTTY && process.stdin.isTTY) {
    return;
  }

  throw new Error("控制台仅支持 TUI：请双击「启动中心.bat」或在终端执行 npm run panel。");
}

function suppressConsoleOutput() {
  // 这里在 TUI 模式接管屏幕后屏蔽 console 直出，避免结构化日志把 TUI 画面打花；
  // 日志仍会写入 current-run.log 并进入状态总线，只是不再直接铺到终端。
  const originalLog = console.log;
  const originalError = console.error;
  console.log = () => {};
  console.error = () => {};
  return () => {
    console.log = originalLog;
    console.error = originalError;
  };
}

function probePort(port) {
  return new Promise((resolve) => {
    const tester = net.createServer();
    tester.once("error", () => resolve(false));
    tester.once("listening", () => {
      tester.close(() => resolve(true));
    });
    tester.listen(port, "127.0.0.1");
  });
}

async function findAvailablePort(startPort) {
  for (let currentPort = startPort; currentPort < startPort + 20; currentPort += 1) {
    const available = await probePort(currentPort);
    if (available) {
      return currentPort;
    }
  }

  throw new Error("本地控制台 API 端口全部被占用，请先关闭冲突程序。");
}

async function main() {
  resetCurrentLogFileOnce();
  const argv = process.argv.slice(2);
  if (argv.includes("--web")) {
    throw new Error("网页控制台已移除，请双击「启动中心.bat」或执行 npm run panel。");
  }
  assertTuiTerminalAvailable();
  log("主线:启动", "控制台", "解析模式", "控制台界面：终端界面(TUI)");

  const port = await findAvailablePort(defaultPort);
  const state = new ControlCenterState();
  const unsubscribeLogs = subscribeLogs((line) => {
    state.appendLog(line);
  });
  let shutdownStarted = false;
  let server;
  let stopRuntimeMaintenanceLoop = null;
  let tuiHandle = null;
  let restoreConsoleOutput = null;

  const shutdown = async (reason = "未说明原因") => {
    if (shutdownStarted) {
      return;
    }

    shutdownStarted = true;
    log("主线:停止", "控制台", "彻底退出", `原因=${reason}`);

    if (typeof stopRuntimeMaintenanceLoop === "function") {
      stopRuntimeMaintenanceLoop();
      stopRuntimeMaintenanceLoop = null;
    }

    if (tuiHandle) {
      tuiHandle.dispose();
      tuiHandle.app.stop();
      tuiHandle = null;
    }

    if (typeof restoreConsoleOutput === "function") {
      restoreConsoleOutput();
      restoreConsoleOutput = null;
    }

    try {
      await taskService.shutdownAllRunningTasks();
    } catch (error) {
      logError("主线:失败", "控制台", "退出前清理任务", error);
    }

    unsubscribeLogs();

    if (server) {
      await new Promise((resolve) => {
        server.close(resolve);
      });
    }

    process.exit(0);
  };

  const taskService = new ControlCenterTaskService(require("../config/appConfig").projectRoot, state, {
    onTaskExit: ({ taskName, status, exitMessage }) => {
      if (taskName !== "start") {
        return;
      }

      log(
        status === "failed" ? "主线:等待" : "主线:完成",
        "控制台",
        "后台任务退出",
        status === "failed"
          ? `后台督办异常退出，控制台保持打开用于排障：${exitMessage}`
          : `后台督办已结束，控制台保持打开：${exitMessage}`
      );
    }
  });

  server = createServer({
    port,
    state,
    taskService,
    shutdownControlCenter: shutdown,
    getResourceRootPids: () => [process.pid, taskService.currentProcess?.pid]
  });

  await new Promise((resolve) => {
    server.listen(port, "127.0.0.1", resolve);
  });

  log("主线:完成", "控制台", "启动服务", `本地 API 已监听：127.0.0.1:${port}（仅清理看门狗使用，无网页界面）`);
  log("主线:等待", "控制台", "后台运行", "TUI 已接管，日志写入 runtime/current-run.log。");

  process.on("SIGINT", () => {
    shutdown("宿主终端收到 SIGINT").catch((error) => {
      logError("主线:失败", "控制台", "关闭服务", error);
      process.exit(0);
    });
  });

  process.on("SIGTERM", () => {
    shutdown("宿主进程收到 SIGTERM").catch((error) => {
      logError("主线:失败", "控制台", "关闭服务", error);
      process.exit(0);
    });
  });

  process.on("SIGBREAK", () => {
    shutdown("宿主终端收到 SIGBREAK").catch((error) => {
      logError("主线:失败", "控制台", "关闭服务", error);
      process.exit(0);
    });
  });

  process.on("SIGHUP", () => {
    shutdown("宿主终端窗口已关闭").catch((error) => {
      logError("主线:失败", "控制台", "关闭服务", error);
      process.exit(0);
    });
  });

  restoreConsoleOutput = suppressConsoleOutput();
  tuiHandle = createTui({
    state,
    taskService,
    shutdown,
    getResourceRootPids: () => [process.pid, taskService.currentProcess?.pid],
    serverPort: port
  });
  tuiHandle.app.start();
  log("主线:完成", "控制台", "TUI 界面", "终端控制台已就绪。");

  startControlCenterCleanupWatchdog({
    controlBrowserPid: 0,
    serverPort: port
  });
  stopRuntimeMaintenanceLoop = startRuntimeMaintenanceLoop({
    moduleName: "控制台运行膨胀治理"
  });
}

main().catch((error) => {
  logError("主线:失败", "控制台", "启动失败", error);
  process.exitCode = 1;
});
