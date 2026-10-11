#Requires -Version 5.1
<#
    launcher.ps1 —— 中文提示都放在这份文件里（UTF-8 with BOM、CRLF）
    配套 launcher.bat：纯 ASCII 启动器，只负责调用本文件。
    规范：bat 一个中文都不写；ps1 开头加「三件套」保证控制台中文正常。
#>
$ErrorActionPreference = 'Stop'

# —— 三件套：控制台统一 UTF-8，防中文乱码 ——
& chcp.com 65001 > $null
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
$OutputEncoding           = [System.Text.Encoding]::UTF8

Write-Host '[提示] 中文显示正常：你好，世界！' -ForegroundColor Green
Write-Host '[提示] 把你自己的启动命令写在下面（照第二行的样子换成你的程序）。' -ForegroundColor Yellow

# 示例（按需取消注释）：
# & "$PSScriptRoot\你的程序.exe"

Write-Host ("[信息] 当前 PowerShell 版本：{0}" -f $PSVersionTable.PSVersion) -ForegroundColor Cyan
Write-Host '[完成] 启动器执行完毕。' -ForegroundColor Cyan
