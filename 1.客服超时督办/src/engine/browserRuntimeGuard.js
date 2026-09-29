const fs = require("fs");
const path = require("path");
const { spawnSync } = require("child_process");
const appConfig = require("../config/appConfig");

const RUNTIME_EDGE_PROFILE_SUFFIX = path.win32.join("runtime", "edge-user-data");

function extractUserDataDirFromCommandLine(commandLine) {
  const match = String(commandLine || "").match(/(?:^|\s)(?:"--user-data-dir=([^"]+)"|--user-data-dir=(?:"([^"]+)"|([^\s"]+)))(?=\s|$)/i);
  if (!match) {
    return "";
  }

  return match[1] || match[2] || match[3] || "";
}

function profileDirsMatch(actualRaw, profileDir) {
  // 严格匹配 --user-data-dir 参数，不以目录子串误识别其他实例。
  const expected = path.win32.resolve(profileDir);
  const actual = path.win32.resolve(actualRaw);
  if (actual.toLowerCase() === expected.toLowerCase()) {
    return true;
  }

  try {
    const expectedRealPath = fs.realpathSync.native(expected);
    const actualRealPath = fs.realpathSync.native(actualRaw);
    if (actualRealPath.toLowerCase() === expectedRealPath.toLowerCase()) {
      return true;
    }
  } catch {
    // WMI 可能把中文路径读成乱码，realpath 会失败；下面用 runtime 后缀 + 盘符兜底。
  }

  const expectedSuffix = RUNTIME_EDGE_PROFILE_SUFFIX.toLowerCase();
  if (!expected.toLowerCase().endsWith(expectedSuffix)) {
    return false;
  }

  const actualNormalized = String(actualRaw).replace(/\//g, "\\").toLowerCase();
  if (!actualNormalized.endsWith(expectedSuffix)) {
    return false;
  }

  return path.win32.parse(expected).root.toLowerCase() === path.win32.parse(actualNormalized).root.toLowerCase();
}

// 严格匹配 --user-data-dir 参数，不以目录子串误识别其他实例。
function usesBrowserProfile(commandLine, profileDir) {
  const actual = extractUserDataDirFromCommandLine(commandLine);
  if (!actual) {
    return false;
  }

  return profileDirsMatch(actual, profileDir);
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
