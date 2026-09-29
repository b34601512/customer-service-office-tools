param(
  [switch]$CheckOnly
)

$ErrorActionPreference = "Stop"

function Get-ProjectRoot {
  return (Split-Path -Parent $PSScriptRoot)
}

function Initialize-LaunchLog {
  param([string]$ProjectRoot)
  $logDirectory = Join-Path $ProjectRoot "runtime"
  New-Item -ItemType Directory -Force -Path $logDirectory | Out-Null
  $logPath = Join-Path $logDirectory "hidden-launch.log"
  Set-Content -LiteralPath $logPath -Value "" -Encoding UTF8
  return $logPath
}

function Write-LaunchLog {
  param([string]$LogPath, [string]$Message)
  $line = "[{0}][hidden-launcher.ps1:0][主线:执行][无黑窗启动][启动器] {1}" -f (Get-Date -Format "yyyy-MM-dd HH:mm:ss"), $Message
  Add-Content -LiteralPath $LogPath -Value $line -Encoding UTF8
}

$projectRoot = Get-ProjectRoot
$logPath = Initialize-LaunchLog $projectRoot
Write-LaunchLog -LogPath $logPath -Message "无黑窗网页模式已废弃，请双击「启动中心.bat」。"

if ($CheckOnly) {
  exit 0
}

Write-Error "控制台仅支持 TUI，请双击项目根目录的「启动中心.bat」。"
exit 1
