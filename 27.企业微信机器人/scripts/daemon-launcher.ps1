# 企业微信长连接守护 —— 双击入口的中文提示都放这里（UTF-8 with BOM + CRLF）
# 规矩：本文件必须 UTF-8 带 BOM，否则 PowerShell 5.1 按 GBK 读，中文全乱。

Set-Location -LiteralPath (Split-Path -Parent $PSScriptRoot)   # scripts\ 的上一级 = 27.企业微信机器人

& chcp.com 65001 > $null
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
$OutputEncoding           = [System.Text.Encoding]::UTF8

Write-Host '企业微信长连接守护（官方 SDK，只收不回，记录到 .state\inbox.jsonl）' -ForegroundColor Cyan
Write-Host '关掉本窗口即停止。' -ForegroundColor DarkGray
Write-Host ''

& node scripts\长连接守护.js
$码 = $LASTEXITCODE
if ($null -eq $码) { $码 = 0 }
Read-Host '按回车关闭窗口'
exit $码
