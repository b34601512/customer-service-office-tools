const { execFile } = require("child_process");
const { log } = require("../logger");
const { findProcessIdsByCommandLine, isProcessRunning } = require("./processQuery");

function buildProcessCommandFailureDetail(error) {
  // 这个函数只把进程命令失败信息整理成不含乱码的退出状态。
  const exitCodeText = error && typeof error.code !== "undefined" ? `退出码=${error.code}` : "没有拿到退出码";
  const signalText = error && error.signal ? `，信号=${error.signal}` : "";
  return `${exitCodeText}${signalText}`;
}

function closeProcessMainWindow(pid, processLabel) {
  // 这个函数只向一个图形进程发送正常关闭主窗口请求。
  return new Promise((resolve, reject) => {
    if (!isProcessRunning(pid)) {
      resolve(false);
      return;
    }
    const script = [
      `$process = Get-Process -Id ${pid} -ErrorAction SilentlyContinue`,
      "if ($null -eq $process) {",
      "  'false'",
      "  return",
      "}",
      "$closed = $process.CloseMainWindow()",
      "if ($closed) {",
      "  'true'",
      "} else {",
      "  'false'",
      "}"
    ].join("\n");
    execFile(
      "powershell.exe",
      ["-NoProfile", "-NonInteractive", "-Command", script],
      { encoding: "utf8", windowsHide: true, timeout: 10000 },
      (error, stdout) => {
        if (error) {
          reject(new Error(`${processLabel} 优雅关闭失败：${error.message}`));
          return;
        }
        const closed = String(stdout || "").trim().toLowerCase() === "true";
        if (closed) {
          log("主线:完成", "进程管理", "优雅关闭主窗口", `${processLabel} 已发送正常关闭请求，PID=${pid}`);
        }
        resolve(closed);
      }
    );
  });
}

function killProcessTree(pid, processLabel, dependencies = {}) {
  // 这个函数只用 taskkill 关闭一个 PID 的整棵进程树。
  const isProcessRunningFn = dependencies.isProcessRunning || isProcessRunning;
  const execFileFn = dependencies.execFile || execFile;
  const logFn = dependencies.logFn || log;
  return new Promise((resolve, reject) => {
    if (!isProcessRunningFn(pid)) {
      resolve(false);
      return;
    }
    execFileFn("taskkill.exe", ["/PID", String(pid), "/T", "/F"], { windowsHide: true }, (error) => {
      if (error) {
        if (!isProcessRunningFn(pid)) {
          logFn("主线:完成", "进程管理", "关闭进程树", `${processLabel} 在强制关闭过程中已不存在，按已关闭处理，PID=${pid}`);
          resolve(true);
          return;
        }
        reject(new Error(
          `${processLabel} 关闭失败：taskkill 执行后进程仍存在，${buildProcessCommandFailureDetail(error)}。请检查是否权限不足或进程被系统占用。`
        ));
        return;
      }
      logFn("主线:完成", "进程管理", "关闭进程树", `${processLabel} 已关闭，PID=${pid}`);
      resolve(true);
    });
  });
}

async function killProcessesByCommandLine(matchTokens, processLabel, dependencies = {}) {
  // 这个函数只并行关闭命令行匹配到的全部进程树。
  const findProcessIdsFn = dependencies.findProcessIdsByCommandLine || findProcessIdsByCommandLine;
  const killProcessTreeFn = dependencies.killProcessTree || killProcessTree;
  const pidList = await findProcessIdsFn(matchTokens);
  if (!pidList.length) {
    return false;
  }
  const closeResults = await Promise.all(pidList.map((pid) => killProcessTreeFn(pid, processLabel)));
  return closeResults.some(Boolean);
}

module.exports = {
  closeProcessMainWindow,
  killProcessTree,
  killProcessesByCommandLine
};
