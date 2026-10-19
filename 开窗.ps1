# 开窗.ps1 -- 叫醒器专用：把本家 PI 监听窗拉起来（元老版；UTF-8 带 BOM）。
# 用法（叫醒器自动调）：powershell -NoProfile -ExecutionPolicy Bypass -File 开窗.ps1
$ErrorActionPreference = 'Stop'
$root = $PSScriptRoot
$boot = 'D:\桌面\木婉清\27.企业微信机器人\boot-prompt.md'
$pi = 'C:\Users\b3460\AppData\Local\PiCodingAgentInstaller\bin\pi.cmd'
if (-not (Test-Path $boot)) { throw "boot-prompt.md not found: $boot" }
if (-not (Test-Path $pi)) { throw "pi launcher not found: $pi" }
# 单实例守卫：认窗＝node 进程命令行含本家路径＋boot-prompt（排除 心跳/叫醒器 辅助进程）
$running = Get-CimInstance Win32_Process | Where-Object { $_.Name -eq 'node.exe' -and $_.CommandLine -and $_.CommandLine.Contains($root) -and $_.CommandLine -match 'boot-prompt' -and $_.CommandLine -notmatch '心跳|叫醒器' }
if ($running) { Write-Output 'SKIP: window already running'; exit 0 }
$p = Start-Process -FilePath $pi -ArgumentList @("@$boot","--provider","codebuddy-direct","--model","deepseek-v4.1-flash") -WorkingDirectory $root -PassThru
Write-Output ("PI_WINDOW_PID=" + $p.Id)
