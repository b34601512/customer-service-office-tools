@echo off
chcp 65001 >nul
cd /d "%~dp0"
if not exist runtime\logs mkdir runtime\logs
echo. >> runtime\logs\每日检查.log
echo ===== %date% %time% ===== >> runtime\logs\每日检查.log
node "scripts\dailyCheck.js" >> runtime\logs\每日检查.log 2>&1
