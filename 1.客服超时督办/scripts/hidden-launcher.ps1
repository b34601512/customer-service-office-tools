param(
  [switch]$CheckOnly
)

$ErrorActionPreference = "Stop"

function Get-ProjectRoot {
  # 该函数用于根据脚本位置定位项目根目录，避免从其他目录启动时路径跑偏。
  return (Split-Path -Parent $PSScriptRoot)
}

function Initialize-LaunchLog {
  param([string]$ProjectRoot)
  # 该函数用于创建并清空本次无黑窗启动日志，只保留启动器自己的运行现场。
  $logDirectory = Join-Path $ProjectRoot "runtime"
  New-Item -ItemType Directory -Force -Path $logDirectory | Out-Null
  $logPath = Join-Path $logDirectory "hidden-launch.log"
  Set-Content -LiteralPath $logPath -Value "" -Encoding UTF8
  return $logPath
}

function Initialize-CurrentRunLog {
  param([string]$ProjectRoot)
  # 该函数用于在启动链路最前面清空业务日志，并通过环境变量告诉后续 Node 进程不要重复清空。
  $logDirectory = Join-Path $ProjectRoot "runtime"
  New-Item -ItemType Directory -Force -Path $logDirectory | Out-Null
  $logPath = Join-Path $logDirectory "current-run.log"
  Set-Content -LiteralPath $logPath -Value "" -Encoding UTF8
  $env:CUSTOMER_SUPERVISOR_CURRENT_RUN_LOG_RESET = "1"
  return $logPath
}

function Write-LaunchLog {
  param([string]$LogPath, [string]$Message)
  # 该函数只记录启动器动作，业务日志由 Node 日志系统写入 current-run.log。
  $line = "[{0}][hidden-launcher.ps1:0][主线:执行][无黑窗启动][启动器] {1}" -f (Get-Date -Format "yyyy-MM-dd HH:mm:ss"), $Message
  Add-Content -LiteralPath $LogPath -Value $line -Encoding UTF8
}

function Invoke-LoggedCommand {
  param([string]$ProjectRoot, [string]$LogPath, [string]$Command, [string[]]$Arguments)
  # 该函数只记录命令开始和结束，不把业务 stdout/stderr 混写进启动器日志。
  Push-Location $ProjectRoot
  try {
    Write-LaunchLog -LogPath $LogPath -Message ("执行命令：{0} {1}" -f $Command, ($Arguments -join " "))
    & $Command @Arguments
    $exitCode = $LASTEXITCODE
    if ($null -eq $exitCode) {
      $exitCode = 0
    }

    if ($exitCode -ne 0) {
      throw "命令退出码异常：$exitCode"
    }

    Write-LaunchLog -LogPath $LogPath -Message ("命令执行完成：{0} {1}" -f $Command, ($Arguments -join " "))
  } finally {
    Pop-Location
  }
}

function Start-ControlCenterHidden {
  # 该函数用于按无黑窗方式启动客服督办控制台。
  $projectRoot = Get-ProjectRoot
  $logPath = Initialize-LaunchLog $projectRoot
  Initialize-CurrentRunLog $projectRoot | Out-Null
  Write-LaunchLog -LogPath $logPath -Message "开始启动客服督办控制台。"

  if ($CheckOnly) {
    Write-LaunchLog -LogPath $logPath -Message "自检模式通过。"
    return
  }

  Invoke-LoggedCommand -ProjectRoot $projectRoot -LogPath $logPath -Command "node" -Arguments @("src\controlCenter\ensureProjectDependencies.js")
  Invoke-LoggedCommand -ProjectRoot $projectRoot -LogPath $logPath -Command "node" -Arguments @("src\controlCenter\startControlCenter.js")
}

try {
  Start-ControlCenterHidden
} catch {
  $fallbackRoot = Get-ProjectRoot
  $fallbackLogPath = Join-Path $fallbackRoot "runtime\hidden-launch.log"
  New-Item -ItemType Directory -Force -Path (Split-Path -Parent $fallbackLogPath) | Out-Null
  Write-LaunchLog -LogPath $fallbackLogPath -Message ("启动失败：{0}" -f $_.Exception.Message)
  exit 1
}
