# 结束进程：按 PID 或命令行关键字（危险操作，先 -WhatIf 预览再真杀）
#   用法: powershell -ExecutionPolicy Bypass -File .\结束进程.ps1 -Match kdocs -WhatIf
#         powershell -ExecutionPolicy Bypass -File .\结束进程.ps1 -Id 12345 -Force
param(
  [string]$Match = "",
  [int[]]$Id = @(),
  [switch]$WhatIf,
  [switch]$Force
)

# 先校验参数（此时还不能设 SilentlyContinue，否则 throw 会被吞掉）
if (-not $Match -and $Id.Count -eq 0) {
  Write-Host "必须给 -Match <关键字> 或 -Id <PID>；不允许无参乱杀"
  exit 2
}
$ErrorActionPreference = "SilentlyContinue"

$targets = @()
if ($Id.Count) {
  $targets += Get-CimInstance Win32_Process | Where-Object { $Id -contains $_.ProcessId }
}
if ($Match) {
  $targets += Get-CimInstance Win32_Process |
    Where-Object { $_.CommandLine -like "*$Match*" -and $_.Name -in @("node.exe", "python.exe", "pythonw.exe", "cmd.exe", "msedge.exe", "chrome.exe") }
}
$targets = $targets | Sort-Object ProcessId -Unique
if (-not $targets) { "没有匹配的进程（关键字：$Match）"; exit 0 }

foreach ($p in $targets) {
  $cmd = $p.CommandLine
  if ($cmd -and $cmd.Length -gt 180) { $cmd = $cmd.Substring(0, 180) + " ..." }
  if ($WhatIf) {
    "[预览] 将结束 PID={0} {1} : {2}" -f $p.ProcessId, $p.Name, $cmd
  } else {
    "结束 PID={0} {1} : {2}" -f $p.ProcessId, $p.Name, $cmd
    if ($Force) { Stop-Process -Id $p.ProcessId -Force } else { Stop-Process -Id $p.ProcessId }
  }
}
if ($WhatIf) { "`n预览了 {0} 个进程；确认无误后去掉 -WhatIf 再跑一遍" -f $targets.Count }
else { "`n已处理 {0} 个进程；等 1~2 秒再重试被占用的目录/文件" -f $targets.Count }
