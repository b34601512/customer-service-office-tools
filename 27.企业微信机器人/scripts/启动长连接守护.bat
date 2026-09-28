@echo off
chcp 65001 >nul
cd /d "%~dp0.."
echo 企业微信长连接守护（官方 SDK，只收不回，记录到 .state\inbox.jsonl）
echo 关掉本窗口即停止。
echo.
node scripts\长连接守护.js
pause
