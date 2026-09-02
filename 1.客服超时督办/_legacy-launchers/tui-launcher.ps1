# 客服督办控制台 - 终端界面(TUI)启动器
# 由「启动中心TUI.vbs」或双击本脚本调用；在可见控制台窗口里运行 TUI，需要真实终端。
param(
  [switch]$CheckOnly
)

$ErrorActionPreference = "Stop"

function Get-ProjectRoot {
  # 根据脚本位置定位项目根目录，避免从其它目录启动时路径跑偏。
  return (Split-Path -Parent $PSScriptRoot)
}

function Initialize-CurrentRunLog {
  param([string]$ProjectRoot)
  # 在启动链路最前面清空业务日志，并通过环境变量告诉后续 Node 进程不要重复清空。
  $logDirectory = Join-Path $ProjectRoot "runtime"
  New-Item -ItemType Directory -Force -Path $logDirectory | Out-Null
  $logPath = Join-Path $logDirectory "current-run.log"
  Set-Content -LiteralPath $logPath -Value "" -Encoding UTF8
  $env:CUSTOMER_SUPERVISOR_CURRENT_RUN_LOG_RESET = "1"
  return $logPath
}

function Start-TuiControlCenter {
  $projectRoot = Get-ProjectRoot
  Initialize-CurrentRunLog $projectRoot | Out-Null

  if ($CheckOnly) {
    Write-Host "自检模式通过。"
    return
  }

  # 切换控制台代码页为 UTF-8，保证中文与 TUI 绘制字符正常显示。
  chcp 65001 | Out-Null
  [Console]::OutputEncoding = [System.Text.Encoding]::UTF8
  [Console]::InputEncoding = [System.Text.Encoding]::UTF8

  Write-Host "正在启动客服督办控制台（终端界面），按 Ctrl+C 可退出..."
  Push-Location $projectRoot
  try {
    node src\controlCenter\startControlCenter.js --tui
    $exitCode = $LASTEXITCODE
    if ($null -ne $exitCode -and $exitCode -ne 0) {
      Write-Host "程序异常退出，退出码：$exitCode"
      Read-Host "按回车关闭窗口"
    }
  } finally {
    Pop-Location
  }
}

try {
  Start-TuiControlCenter
} catch {
  Write-Host "启动失败：$($_.Exception.Message)"
  Read-Host "按回车关闭窗口"
  exit 1
}
