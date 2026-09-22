#Requires -Version 5.1
<#
    ComfyUI 启动脚本（Qwen-Image-2.1-Uncensored 本地文生图）

    编码约定（本经验的由来）：
      1. bat/.cmd 只做启动器，纯 ASCII、无 BOM、CRLF；
      2. 中文提示一律放在本文件里 —— UTF-8 with BOM、CRLF；
      3. 控制台先切 65001 再输出中文，避免 GBK 控制台乱码。
#>
$ErrorActionPreference = 'Stop'

$port = 8188
$url  = "http://127.0.0.1:$port"

# ---- 控制台统一 UTF-8，防止中文乱码 ----
& chcp.com 65001 > $null
[Console]::OutputEncoding  = [System.Text.Encoding]::UTF8
$OutputEncoding             = [System.Text.Encoding]::UTF8
$Host.UI.RawUI.WindowTitle  = 'Qwen-Image-2.1-Uncensored 本地文生图'

function Test-TcpPort([int]$p) {
    try {
        $c = New-Object Net.Sockets.TcpClient
        $c.Connect('127.0.0.1', $p)
        $c.Close()
        $true
    } catch { $false }
}

# ---- 1) 服务已在运行：只开浏览器，不重复启动 ----
if (Test-TcpPort $port) {
    Write-Host "[提示] ComfyUI 已在运行，直接打开：$url" -ForegroundColor Yellow
    Start-Process $url
    exit 0
}

$root   = Split-Path -Parent $MyInvocation.MyCommand.Path
$runBat = Join-Path $root 'ComfyUI_windows_portable\run_nvidia_gpu.bat'
if (-not (Test-Path $runBat)) {
    Write-Host "[错误] 找不到 $runBat" -ForegroundColor Red
    exit 1
}

Write-Host '=================================================='
Write-Host '  Qwen-Image-2.1-Uncensored 本地文生图（本机运行）'
Write-Host "  服务地址: $url"
Write-Host '  首次加载模型约 1 分钟，就绪后自动打开浏览器'
Write-Host '  关闭本窗口或按 Ctrl+C 即停止服务'
Write-Host '=================================================='
Write-Host ''

# ---- 2) 同窗口启动 ComfyUI（日志与本窗口合为一体） ----
$wd  = Split-Path -Parent $runBat
$proc = Start-Process -FilePath $env:ComSpec -ArgumentList '/c', $runBat `
                      -WorkingDirectory $wd -NoNewWindow -PassThru

# ---- 3) 轮询端口，就绪即开浏览器（最多等 3 分钟） ----
$deadline = (Get-Date).AddMinutes(3)
while ((Get-Date) -lt $deadline) {
    if (Test-TcpPort $port) { break }
    if ($proc.HasExited) {
        Write-Host "[失败] 服务进程提前退出，退出码: $($proc.ExitCode)" -ForegroundColor Red
        Read-Host '按回车键退出'
        exit 1
    }
    Start-Sleep -Milliseconds 1500
}

if (Test-TcpPort $port) {
    Write-Host ''
    Write-Host "[就绪] $url  正在打开浏览器..." -ForegroundColor Green
    Start-Process $url
} else {
    Write-Host '[警告] 3 分钟内未检测到端口，请检查上面的日志。' -ForegroundColor Yellow
}

# ---- 4) 等服务真正结束 ----
Write-Host ''
Write-Host '[提示] 服务运行中：关窗口 / Ctrl+C 均可停止。'
$proc.WaitForExit()
Write-Host ''
Write-Host '[已停止] ComfyUI 服务已关闭。' -ForegroundColor Cyan
exit 0
