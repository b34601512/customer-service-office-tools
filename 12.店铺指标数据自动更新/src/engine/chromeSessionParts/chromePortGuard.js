// 该文件用于解决调试端口被占用时的根源兜底：
// 只清理“确实以该端口调试标志监听”的进程，不碰用户个人浏览器或其他无关进程。
const { execFile } = require("child_process");
const { log, logError } = require("../logger");
const { killProcessTree } = require("../managedProcessParts/processCloser");
const { isLocalPortOpen, waitForChromeDebugPortClosed } = require("./chromePortWaiters");

function findDebugPidsOnPort(port) {
  // 这里找出监听指定端口、且命令行带 --remote-debugging-port=<port> 的进程，双条件才认定为受控调试浏览器。
  return new Promise((resolve, reject) => {
    const script = [
      `$port = ${Number(port)}`,
      "$listeners = Get-NetTCPConnection -LocalPort $port -State Listen -ErrorAction SilentlyContinue",
      "if (-not $listeners) { exit 0 }",
      "foreach ($conn in $listeners) {",
      "  $proc = Get-CimInstance Win32_Process -Filter \"ProcessId=$($conn.OwningProcess)\" -ErrorAction SilentlyContinue",
      "  if ($proc -and $proc.CommandLine) {",
      "    if ($proc.CommandLine.IndexOf('--remote-debugging-port=' + $port, [System.StringComparison]::OrdinalIgnoreCase) -ge 0) {",
      "      $proc.ProcessId",
      "    }",
      "  }",
      "}"
    ].join("\n");
    execFile(
      "powershell.exe",
      ["-NoProfile", "-NonInteractive", "-Command", script],
      { encoding: "utf8", windowsHide: true, timeout: 15000 },
      (error, stdout) => {
        if (error) {
          reject(new Error(`查询调试端口监听进程失败：${error.message}`));
          return;
        }
        const pids = String(stdout || "")
          .split(/\r?\n/)
          .map((s) => s.trim())
          .filter(Boolean)
          .map((s) => Number(s))
          .filter((n) => Number.isInteger(n) && n > 0);
        resolve([...new Set(pids)]);
      }
    );
  });
}

async function releaseDebugPort(port, processLabel = "调试浏览器", dependencies = {}) {
  // 返回 true 表示端口已空闲；false 表示仍被非调试进程占用（不擅自杀）。
  const isLocalPortOpenFn = dependencies.isLocalPortOpen || isLocalPortOpen;
  const killProcessTreeFn = dependencies.killProcessTree || killProcessTree;
  const waitForChromeDebugPortClosedFn =
    dependencies.waitForChromeDebugPortClosed || waitForChromeDebugPortClosed;
  const logFn = dependencies.logFn || log;
  const logErrorFn = dependencies.logErrorFn || logError;

  if (!(await isLocalPortOpenFn(port))) {
    return true;
  }

  let pids;
  try {
    pids = await findDebugPidsOnPort(port);
  } catch (error) {
    logErrorFn("主线:失败", "浏览器引擎", "端口守卫查询", error);
    return false;
  }
  if (!pids.length) {
    logFn("主线:等待", "浏览器引擎", "端口守卫", `调试端口 ${port} 被非调试进程占用，等待其释放`);
    return false;
  }

  let killedAny = false;
  for (const pid of pids) {
    try {
      killedAny = (await killProcessTreeFn(pid, processLabel)) || killedAny;
    } catch (error) {
      logErrorFn("主线:失败", "浏览器引擎", "端口守卫清理", error);
    }
  }
  const closed = await waitForChromeDebugPortClosedFn({
    port,
    timeoutMs: 8000,
    pollIntervalMs: 300
  });
  if (closed) {
    logFn("主线:完成", "浏览器引擎", "端口守卫", `调试端口 ${port} 已释放（清理 PID=${pids.join(",")}）`);
    return true;
  }
  return false;
}

module.exports = {
  findDebugPidsOnPort,
  releaseDebugPort
};