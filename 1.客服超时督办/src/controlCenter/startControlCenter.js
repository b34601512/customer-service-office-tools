const net = require("net");
const path = require("path");
const appConfig = require("../config/appConfig");
const { log, logError, resetCurrentLogFileOnce } = require("../engine/logger");
const { subscribeLogs } = require("../engine/logHub");
const { ControlCenterState } = require("./controlCenterState");
const { ControlCenterTaskService } = require("./controlCenterTaskService");
const { ControlCenterBrowserWindow } = require("./controlCenterBrowserWindow");
const { createServer } = require("./controlCenterServer");
const { startControlCenterCleanupWatchdog } = require("./controlCenterCleanupWatchdog");
const { startControlCenterWindowLifecycleMonitor } = require("./controlCenterWindowLifecycleMonitor");
const { createTui } = require("./tui/startTui");
const { 最大化当前控制台窗口 } = require("../../../共享CLI/最大化控制台窗口");
const {
  runControlCenterRuntimeMaintenanceBeforeLaunch,
  startRuntimeMaintenanceLoop
} = require("../engine/runtimeMaintenance/runtimeMaintenance");

const defaultPort = 39360;

function resolveConsoleMode() {
  // 这里决定控制台界面形态：显式 --tui / --web 优先，未指定时按终端是否为 TTY 自动选择。
  const argv = process.argv.slice(2);
  if (argv.includes("--web")) {
    return "web";
  }
  if (argv.includes("--tui")) {
    return "tui";
  }
  return process.stdout.isTTY && process.stdin.isTTY ? "tui" : "web";
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
  // 这里先探测端口是否可用，避免控制台启动时直接因为端口冲突炸掉。
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
  // 这里从固定起始端口向后找空闲端口，保证双击启动时大概率一次成功。
  for (let currentPort = startPort; currentPort < startPort + 20; currentPort += 1) {
    const available = await probePort(currentPort);
    if (available) {
      return currentPort;
    }
  }

  throw new Error("本地网页控制台端口全部被占用，请先关闭冲突程序。");
}

async function main() {
  // 这里统一启动控制台服务，并按界面模式接入 TUI 或网页控制台。
  resetCurrentLogFileOnce();
  const consoleMode = resolveConsoleMode();
  if (consoleMode === "tui" && (!process.stdout.isTTY || !process.stdin.isTTY)) {
    throw new Error("TUI 界面需要真实终端窗口：请双击「启动中心.bat」或 npm run panel:tui 启动；无窗口环境请改用 npm run panel:web（网页界面）。");
  }
  log("主线:启动", "网页控制台", "解析模式", `控制台界面：${consoleMode === "tui" ? "终端界面(TUI)" : "网页界面(Web)"}`);
  const port = await findAvailablePort(defaultPort);
  const state = new ControlCenterState();
  const unsubscribeLogs = subscribeLogs((line) => {
    state.appendLog(line);
  });
  const browserWindow = new ControlCenterBrowserWindow(appConfig.projectRoot);
  let shutdownStarted = false;
  let server;
  let stopWindowLifecycleMonitor = null;
  let stopRuntimeMaintenanceLoop = null;
  let tuiHandle = null;
  let restoreConsoleOutput = null;

  const shutdown = async (reason = "未说明原因") => {
    // 这里统一执行彻底退出流程，保证后台任务、控制台界面和隐藏宿主进程一起收掉。
    if (shutdownStarted) {
      return;
    }

    shutdownStarted = true;
    log("主线:停止", "网页控制台", "彻底退出", `原因=${reason}`);

    if (typeof stopWindowLifecycleMonitor === "function") {
      stopWindowLifecycleMonitor();
      stopWindowLifecycleMonitor = null;
    }

    if (typeof stopRuntimeMaintenanceLoop === "function") {
      stopRuntimeMaintenanceLoop();
      stopRuntimeMaintenanceLoop = null;
    }

    // TUI 模式先退出备用屏幕并还原终端，再继续清理后台。
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
      await browserWindow.close();
    } catch (error) {
      logError("主线:失败", "网页控制台", "退出前关闭控制台网页", error);
    }

    try {
      await taskService.shutdownAllRunningTasks();
    } catch (error) {
      logError("主线:失败", "网页控制台", "退出前清理任务", error);
    }

    unsubscribeLogs();

    if (server) {
      await new Promise((resolve) => {
        server.close(resolve);
      });
    }

    process.exit(0);
  };

  const taskService = new ControlCenterTaskService(appConfig.projectRoot, state, {
    onTaskExit: ({ taskName, status, exitMessage }) => {
      // 这里后台任务退出只更新状态，不再触发控制台总退出，避免异常现场被自动关闭。
      if (taskName !== "start") {
        return;
      }

      log(
        status === "failed" ? "主线:等待" : "主线:完成",
        "网页控制台",
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
    webRoot: path.join(__dirname, "web"),
    shutdownControlCenter: shutdown,
    getResourceRootPids: () => [
      process.pid,
      taskService.currentProcess?.pid,
      browserWindow.getProcessId()
    ]
  });

  await new Promise((resolve) => {
    server.listen(port, "127.0.0.1", resolve);
  });

  const url = `http://127.0.0.1:${port}`;
  log("主线:完成", "网页控制台", "启动服务", `本地控制台已启动：${url}`);
  log("主线:等待", "网页控制台", "后台运行", "启动器已进入运行模式，日志会持续写入网页控制台和 runtime/current-run.log。");

  process.on("SIGINT", () => {
    shutdown("宿主终端收到 SIGINT")
      .catch((error) => {
        logError("主线:失败", "网页控制台", "关闭服务", error);
        process.exit(0);
      });
  });

  process.on("SIGTERM", () => {
    shutdown("宿主进程收到 SIGTERM")
      .catch((error) => {
        logError("主线:失败", "网页控制台", "关闭服务", error);
        process.exit(0);
      });
  });

  process.on("SIGBREAK", () => {
    shutdown("宿主终端收到 SIGBREAK")
      .catch((error) => {
        logError("主线:失败", "网页控制台", "关闭服务", error);
        process.exit(0);
      });
  });

  process.on("SIGHUP", () => {
    shutdown("宿主终端窗口已关闭")
      .catch((error) => {
        logError("主线:失败", "网页控制台", "关闭服务", error);
        process.exit(0);
      });
  });

  if (consoleMode === "tui") {
    // TUI 模式：接管当前终端渲染控制台，不再拉起独立浏览器窗口。
    最大化当前控制台窗口();
    restoreConsoleOutput = suppressConsoleOutput();
    tuiHandle = createTui({
      state,
      taskService,
      shutdown,
      getResourceRootPids: () => [
        process.pid,
        taskService.currentProcess?.pid
      ],
      serverPort: port
    });
    tuiHandle.app.start();
    log("主线:完成", "网页控制台", "TUI 界面", `终端控制台已接管，网页版仍可访问：${url}`);
  } else {
    runControlCenterRuntimeMaintenanceBeforeLaunch();
    await browserWindow.open(url);
    stopWindowLifecycleMonitor = startControlCenterWindowLifecycleMonitor({
      isWindowOpen: () => browserWindow.isOpen(),
      requestShutdown: shutdown
    });
  }

  startControlCenterCleanupWatchdog({
    controlBrowserPid: browserWindow.getProcessId(),
    serverPort: port
  });
  stopRuntimeMaintenanceLoop = startRuntimeMaintenanceLoop({
    moduleName: "控制台运行膨胀治理"
  });
}

main().catch((error) => {
  logError("主线:失败", "网页控制台", "启动失败", error);
  process.exitCode = 1;
});
