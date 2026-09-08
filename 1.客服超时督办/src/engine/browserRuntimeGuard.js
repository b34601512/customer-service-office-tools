const path = require("path");
const { spawnSync } = require("child_process");
const appConfig = require("../config/appConfig");

// 严格匹配 --user-data-dir 参数，不以目录子串误识别其他实例。
function usesBrowserProfile(commandLine, profileDir) {
  const match = String(commandLine || "").match(/(?:^|\s)(?:"--user-data-dir=([^"]+)"|--user-data-dir=(?:"([^"]+)"|([^\s"]+)))(?=\s|$)/i);
  if (!match) return false;
  const actual = match[1] || match[2] || match[3];
  return path.win32.resolve(actual).toLowerCase() === path.win32.resolve(profileDir).toLowerCase();
}

function assertBrowserProfileAvailable(profileDir, query = spawnSync) {
  if (process.platform !== "win32") return;
  const result = query("powershell.exe", [
    "-NoProfile", "-NonInteractive", "-Command",
    "Get-CimInstance Win32_Process -Filter \"Name = 'msedge.exe'\" | Select-Object ProcessId, CommandLine | ConvertTo-Json -Compress"
  ], { encoding: "utf8", windowsHide: true });
  if (result.error || result.status !== 0) {
    throw new Error(`无法检查 Edge 运行目录占用：${result.error?.message || result.stderr || result.status}`);
  }
  const output = String(result.stdout || "").trim();
  const payload = output ? JSON.parse(output) : [];
  const processes = Array.isArray(payload) ? payload : [payload];
  if (processes.some((item) => usesBrowserProfile(item.CommandLine, profileDir))) {
    throw new Error(`应用 Edge 目录正在使用，请先在原控制台停止或退出后重试。不会强杀进程或删除锁文件。目录=${profileDir}`);
  }
}

function prepareBrowserRuntimeForLaunch() {
  assertBrowserProfileAvailable(appConfig.userDataDir);
}

module.exports = { usesBrowserProfile, assertBrowserProfileAvailable, prepareBrowserRuntimeForLaunch };
