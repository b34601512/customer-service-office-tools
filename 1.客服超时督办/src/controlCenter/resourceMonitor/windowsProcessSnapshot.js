const { execFile } = require("child_process");
const { normalizePid } = require("./pid");

function parseWindowsProcessJson(stdout) {
  // 该函数解析 PowerShell 输出，兼容单进程对象和多进程数组两种 JSON 形态。
  const text = String(stdout || "").trim();
  if (!text) {
    return [];
  }

  const parsed = JSON.parse(text);
  return Array.isArray(parsed) ? parsed : [parsed];
}

function normalizeProcessRecord(record) {
  // 该函数把 Windows 进程字段转成稳定数字，避免后续 CPU 和内存计算混入字符串。
  const pid = normalizePid(record.ProcessId);
  if (!pid) {
    return null;
  }

  const kernelModeTime = Number(record.KernelModeTime) || 0;
  const userModeTime = Number(record.UserModeTime) || 0;
  return {
    pid,
    parentPid: normalizePid(record.ParentProcessId) || 0,
    name: String(record.Name || "unknown"),
    commandLine: String(record.CommandLine || ""),
    workingSetBytes: Math.max(0, Number(record.WorkingSetSize) || 0),
    totalCpuTime100ns: Math.max(0, kernelModeTime + userModeTime)
  };
}

function queryWindowsProcessSnapshot(execFileImpl = execFile) {
  // 该函数只负责读取系统进程快照，不在这里混入项目过滤逻辑。
  const command = [
    "Get-CimInstance Win32_Process |",
    "Select-Object ProcessId,ParentProcessId,Name,CommandLine,WorkingSetSize,KernelModeTime,UserModeTime |",
    "ConvertTo-Json -Compress"
  ].join(" ");

  return new Promise((resolve, reject) => {
    execFileImpl(
      "powershell.exe",
      ["-NoProfile", "-Command", command],
      {
        encoding: "utf8",
        windowsHide: true,
        maxBuffer: 20 * 1024 * 1024
      },
      (error, stdout, stderr) => {
        if (error) {
          reject(new Error(`读取系统资源失败：${String(stderr || error.message).trim()}`));
          return;
        }

        try {
          resolve({
            capturedAtMs: Date.now(),
            processes: parseWindowsProcessJson(stdout).map(normalizeProcessRecord).filter(Boolean)
          });
        } catch (parseError) {
          reject(new Error(`解析系统资源失败：${parseError.message}`));
        }
      }
    );
  });
}

module.exports = {
  parseWindowsProcessJson,
  normalizeProcessRecord,
  queryWindowsProcessSnapshot
};
