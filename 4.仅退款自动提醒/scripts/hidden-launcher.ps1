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
  # 该函数用于创建并清空本次无黑窗启动日志，只保留当前运行现场。
  $logDirectory = Join-Path $ProjectRoot "logs"
  New-Item -ItemType Directory -Force -Path $logDirectory | Out-Null
  $logPath = Join-Path $logDirectory "hidden-launch.log"
  Set-Content -LiteralPath $logPath -Value "" -Encoding UTF8
  return $logPath
}

function Write-LaunchLog {
  param([string]$LogPath, [string]$Message)
  # 该函数用于记录启动器自身日志，业务日志由 Python 进程继续写入同一个文件。
  $line = "[{0}][hidden-launcher.ps1:0][主线:执行][无黑窗启动][启动器] {1}" -f (Get-Date -Format "yyyy-MM-dd HH:mm:ss"), $Message
  Add-Content -LiteralPath $LogPath -Value $line -Encoding UTF8
}

function Resolve-PythonExecutable {
  param([string]$ProjectRoot, [string]$LogPath)
  # 该函数用于按项目内置 Python、虚拟环境、系统 Python 的顺序找到运行解释器。
  $embeddedPython = Join-Path $ProjectRoot "runtime\python\python.exe"
  if (Test-Path -LiteralPath $embeddedPython) {
    return $embeddedPython
  }

  $venvPython = Join-Path $ProjectRoot ".venv\Scripts\python.exe"
  if (Test-Path -LiteralPath $venvPython) {
    return $venvPython
  }

  $systemPython = Get-Command "python" -ErrorAction SilentlyContinue
  if ($null -eq $systemPython) {
    throw "没有找到 Python，且项目内也不存在 runtime\python 或 .venv。"
  }

  Write-LaunchLog -LogPath $LogPath -Message "未找到项目虚拟环境，开始创建 .venv。"
  Push-Location $ProjectRoot
  try {
    & $systemPython.Source -m venv ".venv" *>> $LogPath
    if ($LASTEXITCODE -ne 0) {
      throw "创建 .venv 失败，退出码=$LASTEXITCODE"
    }
  } finally {
    Pop-Location
  }

  if (-not (Test-Path -LiteralPath $venvPython)) {
    throw "创建 .venv 后仍找不到解释器：$venvPython"
  }

  return $venvPython
}

function Invoke-LoggedCommand {
  param([string]$ProjectRoot, [string]$LogPath, [string]$Command, [string[]]$Arguments)
  # 该函数用于在隐藏宿主里执行一条命令，并把 stdout/stderr 统一落盘。
  Push-Location $ProjectRoot
  try {
  Write-LaunchLog -LogPath $LogPath -Message ("执行命令：{0} {1}" -f $Command, ($Arguments -join " "))
    & $Command @Arguments *>> $LogPath
    if ($LASTEXITCODE -ne 0) {
      throw "命令退出码异常：$LASTEXITCODE"
    }
  } finally {
    Pop-Location
  }
}

function Start-RefundReminderHidden {
  # 该函数用于按无黑窗方式启动仅退款自动提醒后台。
  $projectRoot = Get-ProjectRoot
  $logPath = Initialize-LaunchLog $projectRoot
  Write-LaunchLog -LogPath $logPath -Message "开始启动仅退款自动提醒后台。"
  $pythonExecutable = Resolve-PythonExecutable -ProjectRoot $projectRoot -LogPath $logPath

  if ($CheckOnly) {
    Write-LaunchLog -LogPath $logPath -Message ("自检模式通过，Python={0}" -f $pythonExecutable)
    return
  }

  Invoke-LoggedCommand -ProjectRoot $projectRoot -LogPath $logPath -Command $pythonExecutable -Arguments @("-m", "refund_reminder.dependency_bootstrap")
  Invoke-LoggedCommand -ProjectRoot $projectRoot -LogPath $logPath -Command $pythonExecutable -Arguments @("run.py")
}

try {
  Start-RefundReminderHidden
} catch {
  $fallbackRoot = Get-ProjectRoot
  $fallbackLogPath = Join-Path $fallbackRoot "logs\hidden-launch.log"
  New-Item -ItemType Directory -Force -Path (Split-Path -Parent $fallbackLogPath) | Out-Null
  Write-LaunchLog -LogPath $fallbackLogPath -Message ("启动失败：{0}" -f $_.Exception.Message)
  exit 1
}
