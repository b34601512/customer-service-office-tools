const fs = require("fs");
const path = require("path");
const { spawnSync } = require("child_process");
const appConfig = require("../config/appConfig");
const { log } = require("./logger");
const { processExistsByPid } = require("./processPid");
const { collectBusinessBrowserDataDirs } = require("./browserCacheSanitizer");

const LOCK_FILE_NAMES = new Set([
  "LOCK",
  "SingletonLock",
  "SingletonCookie",
  "SingletonSocket"
]);

function normalizePathForJson(filePath) {
  // 这里统一清洗路径文本，避免传给 PowerShell 时掺入空值。
  return String(filePath || "");
}

function quotePowerShellString(text) {
  // 这里统一转义 PowerShell 单引号字符串，避免路径里特殊字符打断脚本。
  return `'${String(text).replace(/'/g, "''")}'`;
}

function findProjectChromeProcesses() {
  // 这里精确筛出占用本项目运行目录的 Chrome 进程，避免误杀用户自己开的普通浏览器。
  const targetDirs = collectBusinessBrowserDataDirs().map(normalizePathForJson);

  if (targetDirs.length === 0) {
    return [];
  }

  const script = `
$ErrorActionPreference = 'Stop'
$targetDirs = @(${targetDirs.map(quotePowerShellString).join(", ")})
Get-CimInstance Win32_Process |
  Where-Object {
    $commandLine = $_.CommandLine
    $_.Name -eq 'chrome.exe' -and
    $commandLine -and
    ($targetDirs | Where-Object { $_.Length -gt 0 -and $commandLine -like "*$_*" } | Select-Object -First 1)
  } |
  Select-Object ProcessId, ParentProcessId, Name, CommandLine |
  ConvertTo-Json -Compress
`;

  const result = spawnSync("powershell.exe", ["-NoProfile", "-Command", script], {
    cwd: appConfig.projectRoot,
    encoding: "utf8",
    windowsHide: true
  });

  if (result.status !== 0) {
    throw new Error(`查询残留 Chrome 进程失败：${result.stderr.trim() || result.stdout.trim() || `退出码=${result.status}`}`);
  }

  const output = String(result.stdout || "").trim();
  if (!output) {
    return [];
  }

  const parsed = JSON.parse(output);
  return Array.isArray(parsed) ? parsed : [parsed];
}

function killProcessTree(pid) {
  // 这里统一结束残留进程树，避免只杀主进程后子进程继续占住运行目录。
  const result = spawnSync("taskkill.exe", ["/PID", String(pid), "/T", "/F"], {
    cwd: appConfig.projectRoot,
    encoding: "utf8",
    windowsHide: true
  });

  if (result.status !== 0) {
    const stderr = `${result.stderr || ""}${result.stdout || ""}`.trim();
    if (
      stderr.includes("该进程不存在") ||
      stderr.includes("not found") ||
      !processExistsByPid(pid)
    ) {
      return;
    }

    throw new Error(`结束残留 Chrome 失败：PID=${pid}，原因=${stderr || `退出码=${result.status}`}`);
  }
}

function killProjectChromeProcesses() {
  // 这里先清掉异常残留的项目 Chrome，避免直接复用持久化目录时再次撞锁。
  const processes = findProjectChromeProcesses();
  if (processes.length === 0) {
    log("主线:执行", "浏览器守卫", "检查残留进程", "未发现占用运行目录的残留 Chrome 进程");
    return 0;
  }

  const processIdSet = new Set(processes.map((item) => Number(item.ProcessId)).filter(Number.isFinite));
  const rootProcesses = processes.filter((item) => !processIdSet.has(Number(item.ParentProcessId)));

  for (const processInfo of rootProcesses) {
    log(
      "主线:停止",
      "浏览器守卫",
      "结束残留进程",
      `PID=${processInfo.ProcessId}，命令行=${processInfo.CommandLine}`
    );
    killProcessTree(processInfo.ProcessId);
  }

  return rootProcesses.length;
}

function removeLockArtifactsInDir(targetDir, removedPaths) {
  // 这里递归删除锁文件，只处理明确的锁标记，不碰登录态和业务数据。
  if (!fs.existsSync(targetDir)) {
    return;
  }

  for (const entry of fs.readdirSync(targetDir, { withFileTypes: true })) {
    const entryPath = path.join(targetDir, entry.name);
    if (entry.isDirectory()) {
      removeLockArtifactsInDir(entryPath, removedPaths);
      continue;
    }

    if (!LOCK_FILE_NAMES.has(entry.name)) {
      continue;
    }

    fs.rmSync(entryPath, { force: false });
    removedPaths.push(entryPath);
  }
}

function clearStaleLockArtifacts() {
  // 这里在确认没有残留 Chrome 后清掉锁文件，避免上次异常退出留下假锁挡住本次启动。
  const removedPaths = [];

  for (const browserDataDir of collectBusinessBrowserDataDirs()) {
    removeLockArtifactsInDir(browserDataDir, removedPaths);
  }

  if (removedPaths.length === 0) {
    log("主线:执行", "浏览器守卫", "清理锁文件", "未发现需要清理的残留锁文件");
    return 0;
  }

  for (const targetPath of removedPaths) {
    log("主线:执行", "浏览器守卫", "删除锁文件", `路径=${targetPath}`);
  }

  log("主线:完成", "浏览器守卫", "清理锁文件", `共删除 ${removedPaths.length} 个残留锁文件`);
  return removedPaths.length;
}

function prepareBrowserRuntimeForLaunch() {
  // 这里把“清残留进程 + 清残留锁”合成一个启动前守卫，避免用户每次都手工排障。
  const killedCount = killProjectChromeProcesses();
  const removedLockCount = clearStaleLockArtifacts();
  log(
    "主线:完成",
    "浏览器守卫",
    "启动前自检",
    `残留进程=${killedCount}，残留锁文件=${removedLockCount}`
  );
}

module.exports = {
  killProjectChromeProcesses,
  killProcessTree,
  prepareBrowserRuntimeForLaunch,
  processExistsByPid
};
