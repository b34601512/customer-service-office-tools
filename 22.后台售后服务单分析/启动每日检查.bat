@echo off
chcp 65001 >nul
cd /d "%~dp0"
if not exist runtime\logs mkdir runtime\logs
echo. >> runtime\logs\每日检查.log
echo ===== %date% %time% ===== >> runtime\logs\每日检查.log
node "scripts\dailyCheck.js" %* >> runtime\logs\每日检查.log 2>&1
echo.
echo 已跑完，日志：runtime\logs\每日检查.log
if not "%~1"=="--scheduled" (
  echo （每天 09:10 由 Windows 计划任务自动跑一次；本窗口双击运行时不会发消息，除非加 --send）
  pause
)
