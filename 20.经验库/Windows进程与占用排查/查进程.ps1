# 列出 node/python/cmd 进程的 PID + 完整命令行（只读）
#   用法: powershell -ExecutionPolicy Bypass -File .\查进程.ps1 [-Match 关键字] [-Full]
param(
  [string]$Match = "",
  [switch]$Full
)
$ErrorActionPreference = "SilentlyContinue"
$names = @("node.exe", "python.exe", "pythonw.exe", "cmd.exe", "msedge.exe", "chrome.exe")
$procs = Get-CimInstance Win32_Process | Where-Object { $names -contains $_.Name }
if ($Match) { $procs = $procs | Where-Object { $_.CommandLine -like "*$Match*" } }
if (-not $procs) { "没有匹配的进程"; exit 0 }

"{0,-8} {1,-12} {2,-8} {3}" -f "PID", "名字", "内存MB", "命令行"
foreach ($p in $procs | Sort-Object Name, ProcessId) {
  $cmd = $p.CommandLine
  if (-not $Full -and $cmd -and $cmd.Length -gt 200) { $cmd = $cmd.Substring(0, 200) + " ..." }
  "{0,-8} {1,-12} {2,-8:N0} {3}" -f $p.ProcessId, $p.Name, (($p.WorkingSetSize / 1MB)), $cmd
}
"`n共 {0} 个进程（-Match 过滤 / -Full 看完整命令行）" -f $procs.Count
