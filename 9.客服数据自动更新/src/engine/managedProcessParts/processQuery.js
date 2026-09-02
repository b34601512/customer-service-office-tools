const { execFile } = require("child_process");

function escapePowerShellSingleQuoted(value) {
  // 这个函数只转义 PowerShell 单引号字符串中的单引号。
  return String(value ?? "").replaceAll("'", "''");
}

function normalizeProcessMatchTokens(matchTokens) {
  // 这个函数只把进程命令行匹配条件整理成非空唯一文本。
  return [...new Set(
    (Array.isArray(matchTokens) ? matchTokens : [])
      .map((item) => String(item || "").trim())
      .filter(Boolean)
  )];
}

function buildProcessQueryScript(matchTokens) {
  // 这个函数只生成同时包含全部 token 的 Windows 进程查询脚本。
  const conditionText = matchTokens
    .map((token) => `$cmd.IndexOf('${escapePowerShellSingleQuoted(token)}', [System.StringComparison]::OrdinalIgnoreCase) -ge 0`)
    .join(" -and ");
  return [
    "$ids = Get-CimInstance Win32_Process | Where-Object {",
    "  $cmd = $_.CommandLine",
    `  $cmd -and ${conditionText}`,
    "} | Select-Object -ExpandProperty ProcessId",
    "if ($null -ne $ids) {",
    "  $ids",
    "}"
  ].join("\n");
}

function parseProcessIdList(stdout) {
  // 这个函数只把 PowerShell 输出解析成唯一有效 PID 列表。
  const pidList = String(stdout || "")
    .split(/\r?\n/)
    .map((line) => Number(String(line).trim()))
    .filter((pid) => Number.isInteger(pid) && pid > 0);
  return [...new Set(pidList)];
}

function findProcessIdsByCommandLine(matchTokens) {
  // 这个函数只查询命令行同时包含全部指定文本的进程 PID。
  const tokens = normalizeProcessMatchTokens(matchTokens);
  if (!tokens.length) {
    return Promise.resolve([]);
  }
  const script = buildProcessQueryScript(tokens);
  return new Promise((resolve, reject) => {
    execFile(
      "powershell.exe",
      ["-NoProfile", "-NonInteractive", "-Command", script],
      { encoding: "utf8", windowsHide: true, timeout: 10000 },
      (error, stdout, stderr) => {
        if (error) {
          const stderrText = String(stderr || "").trim();
          reject(new Error(`读取进程列表失败：${stderrText || error.message}`));
          return;
        }
        resolve(parseProcessIdList(stdout));
      }
    );
  });
}

function isProcessRunning(pid, signalProcess = process.kill) {
  // 这个函数只判断 PID 是否存在；只有系统明确返回 ESRCH 才表示不存在。
  if (!Number.isInteger(pid) || pid <= 0) {
    return false;
  }
  try {
    signalProcess(pid, 0);
    return true;
  } catch (error) {
    if (error?.code === "ESRCH") {
      return false;
    }
    throw error;
  }
}

module.exports = {
  findProcessIdsByCommandLine,
  isProcessRunning
};
