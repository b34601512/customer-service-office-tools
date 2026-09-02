const http = require("http");
const childProcess = require("child_process");
const appConfig = require("../config/appConfig");
const { log } = require("../engine/logger");
const { normalizeProcessPid, processExistsByPid } = require("../engine/processPid");
const { killProcessTree } = require("./processTree");

const CLEANUP_WATCHDOG_WORKER_FLAG = "--control-center-cleanup-watchdog";
const DEFAULT_CHECK_INTERVAL_MS = 1000;
const BROWSER_MISSING_CHECK_LIMIT = 5;
const GRACEFUL_SHUTDOWN_TIMEOUT_MS = 25000;
const TASK_PID_FRESHNESS_MS = 15000;

function normalizeServerPort(port) {
  // 这里只接受有效本地端口，避免看门狗请求意外指向其他地址。
  const normalizedPort = Number(port);
  return Number.isInteger(normalizedPort) && normalizedPort > 0 && normalizedPort <= 65535
    ? normalizedPort
    : 0;
}

function buildCleanupWatchdogArguments(options = {}) {
  // 这里把明确 PID 作为普通 Node 参数传给独立进程，不再生成或编码系统脚本。
  const parentPid = normalizeProcessPid(options.parentPid || process.pid);
  const controlBrowserPid = normalizeProcessPid(options.controlBrowserPid);
  const serverPort = normalizeServerPort(options.serverPort);
  if (!parentPid || !serverPort) {
    throw new Error("启动清理看门狗失败：宿主 PID 或本地服务端口无效。");
  }

  return [
    CLEANUP_WATCHDOG_WORKER_FLAG,
    "--parent-pid",
    String(parentPid),
    "--control-browser-pid",
    String(controlBrowserPid),
    "--server-port",
    String(serverPort)
  ];
}

function readArgumentValue(args, name) {
  const index = args.indexOf(name);
  return index >= 0 ? args[index + 1] : undefined;
}

function parseCleanupWatchdogArguments(args = []) {
  // 这里对独立进程入口再次校验参数，拒绝模糊目标或无效 PID。
  const parentPid = normalizeProcessPid(readArgumentValue(args, "--parent-pid"));
  const controlBrowserPid = normalizeProcessPid(readArgumentValue(args, "--control-browser-pid"));
  const serverPort = normalizeServerPort(readArgumentValue(args, "--server-port"));
  if (!args.includes(CLEANUP_WATCHDOG_WORKER_FLAG) || !parentPid || !serverPort) {
    throw new Error("清理看门狗参数无效。");
  }

  return {
    parentPid,
    controlBrowserPid,
    serverPort
  };
}

function requestLocalJson(options) {
  // 这里只访问控制中心的回环地址，用于读取真实任务 PID 或请求现有退出主线。
  const bodyText = options.body ? JSON.stringify(options.body) : "";
  return new Promise((resolve, reject) => {
    const request = http.request({
      hostname: "127.0.0.1",
      port: options.port,
      path: options.path,
      method: options.method || "GET",
      headers: bodyText
        ? {
            "Content-Type": "application/json; charset=utf-8",
            "Content-Length": Buffer.byteLength(bodyText)
          }
        : undefined
    }, (response) => {
      let responseText = "";
      response.setEncoding("utf8");
      response.on("data", (chunk) => {
        responseText += String(chunk);
      });
      response.on("end", () => {
        if (response.statusCode < 200 || response.statusCode >= 300) {
          reject(new Error(`本地控制中心返回 HTTP ${response.statusCode}。`));
          return;
        }

        try {
          resolve(responseText ? JSON.parse(responseText) : {});
        } catch (error) {
          reject(new Error(`本地控制中心返回无效数据：${error.message}`));
        }
      });
    });

    request.setTimeout(options.timeoutMs || 1500, () => {
      request.destroy(new Error("本地控制中心请求超时。"));
    });
    request.on("error", reject);
    request.end(bodyText);
  });
}

async function readCleanupWatchdogState(serverPort) {
  return requestLocalJson({
    port: serverPort,
    path: "/api/control-center/watchdog-state"
  });
}

async function requestGracefulShutdown(serverPort) {
  return requestLocalJson({
    port: serverPort,
    path: "/api/control-center/shutdown",
    method: "POST",
    body: {
      reason: "控制台窗口已关闭"
    }
  });
}

function createCleanupWatchdogState() {
  // 这里只缓存最近从控制中心真源读取到的运行任务 PID，不维护第二套任务状态。
  return {
    taskPid: 0,
    taskPidObservedAt: 0,
    browserMissingChecks: 0,
    shutdownRequestedAt: null
  };
}

function resolveDependencies(overrides = {}) {
  return {
    now: overrides.now || Date.now,
    processExistsByPid: overrides.processExistsByPid || processExistsByPid,
    readState: overrides.readState || readCleanupWatchdogState,
    requestShutdown: overrides.requestShutdown || requestGracefulShutdown,
    terminateParent: overrides.terminateParent || ((pid) => process.kill(pid, "SIGTERM")),
    killProcessTree: overrides.killProcessTree || killProcessTree
  };
}

async function refreshActiveTaskPid(config, state, dependencies) {
  // 这里从控制中心服务读取当前子进程，读取失败时不猜测新 PID。
  try {
    const snapshot = await dependencies.readState(config.serverPort);
    if (normalizeProcessPid(snapshot.parentPid) !== config.parentPid) {
      return;
    }

    const taskPid = normalizeProcessPid(snapshot.taskPid);
    state.taskPid = taskPid;
    state.taskPidObservedAt = taskPid ? dependencies.now() : 0;
  } catch (error) {
    // 宿主退出过程中服务会先关闭；下一步以宿主 PID 为最终判断依据。
  }
}

async function cleanupOwnedProcessTrees(config, state, dependencies) {
  // 这里只清理刚从真源确认过的任务 PID 与启动时记录的受控浏览器 PID。
  const now = dependencies.now();
  const taskPidIsFresh = state.taskPid && now - state.taskPidObservedAt <= TASK_PID_FRESHNESS_MS;
  const ownedPids = [
    taskPidIsFresh ? state.taskPid : 0,
    config.controlBrowserPid
  ];
  const uniquePids = [...new Set(ownedPids)]
    .map(normalizeProcessPid)
    .filter((pid) => pid && pid !== process.pid && pid !== config.parentPid);

  for (const pid of uniquePids) {
    if (!dependencies.processExistsByPid(pid)) {
      continue;
    }

    try {
      await dependencies.killProcessTree(pid);
    } catch (error) {
      // 外部看门狗没有交互界面；单个目标失败时继续清理其余明确目标。
    }
  }
}

async function checkCleanupWatchdogOnce(config, state, overrides = {}) {
  // 这里执行单次判断：宿主消失立即清理；网页窗口消失则先走正常退出主线。
  const dependencies = resolveDependencies(overrides);
  if (!dependencies.processExistsByPid(config.parentPid)) {
    await cleanupOwnedProcessTrees(config, state, dependencies);
    return false;
  }

  await refreshActiveTaskPid(config, state, dependencies);
  if (!config.controlBrowserPid) {
    return true;
  }

  if (dependencies.processExistsByPid(config.controlBrowserPid)) {
    state.browserMissingChecks = 0;
    return true;
  }

  state.browserMissingChecks += 1;
  if (state.browserMissingChecks < BROWSER_MISSING_CHECK_LIMIT) {
    return true;
  }

  if (state.shutdownRequestedAt === null) {
    state.shutdownRequestedAt = dependencies.now();
    try {
      await dependencies.requestShutdown(config.serverPort);
    } catch (error) {
      // 正常退出接口不可用时仍保留超时后的精确清理路径。
    }
    return true;
  }

  if (dependencies.now() - state.shutdownRequestedAt < GRACEFUL_SHUTDOWN_TIMEOUT_MS) {
    return true;
  }

  try {
    dependencies.terminateParent(config.parentPid);
  } catch (error) {
    // 宿主可能已在当前检查间隙退出，继续清理其余明确目标即可。
  }
  await cleanupOwnedProcessTrees(config, state, dependencies);
  return false;
}

function delay(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

async function runCleanupWatchdog(config, overrides = {}) {
  // 这里让独立 Node 进程保持轻量轮询，不枚举系统进程，也不执行动态脚本。
  const state = createCleanupWatchdogState();
  const intervalMs = Math.max(300, Number(overrides.intervalMs) || DEFAULT_CHECK_INTERVAL_MS);
  while (await checkCleanupWatchdogOnce(config, state, overrides)) {
    await delay(intervalMs);
  }
}

function startControlCenterCleanupWatchdog(options = {}, overrides = {}) {
  // 这里拉起项目自身的 Node 文件；detached 保证宿主崩溃后仍能完成最后清理。
  const spawnProcess = overrides.spawnProcess || childProcess.spawn;
  const workerArguments = buildCleanupWatchdogArguments(options);
  const worker = spawnProcess(process.execPath, [__filename, ...workerArguments], {
    cwd: appConfig.projectRoot,
    detached: true,
    stdio: "ignore",
    windowsHide: true
  });

  worker.once("error", (error) => {
    log("主线:失败", "网页控制台", "外部清理看门狗", `独立 Node 看门狗启动失败：${error.message}`);
  });
  worker.unref();
  log("主线:完成", "网页控制台", "外部清理看门狗", `独立 Node 看门狗已启动，PID=${worker.pid || 0}`);
  return worker.pid || 0;
}

if (require.main === module && process.argv.includes(CLEANUP_WATCHDOG_WORKER_FLAG)) {
  const config = parseCleanupWatchdogArguments(process.argv.slice(2));
  runCleanupWatchdog(config).catch(() => {
    process.exitCode = 1;
  });
}

module.exports = {
  BROWSER_MISSING_CHECK_LIMIT,
  CLEANUP_WATCHDOG_WORKER_FLAG,
  GRACEFUL_SHUTDOWN_TIMEOUT_MS,
  buildCleanupWatchdogArguments,
  checkCleanupWatchdogOnce,
  createCleanupWatchdogState,
  parseCleanupWatchdogArguments,
  requestGracefulShutdown,
  runCleanupWatchdog,
  startControlCenterCleanupWatchdog
};
