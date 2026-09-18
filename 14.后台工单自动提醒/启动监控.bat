@echo off
chcp 65001 >nul
cd /d "%~dp0"
title 14 Work Order Auto Reminder

where node >nul 2>nul
if errorlevel 1 goto :noNode

node src\cli\startCli.js menu
if errorlevel 1 echo.
if errorlevel 1 echo [ERROR] Program exited abnormally. Please screenshot the messages above.
echo.
pause
exit /b 0

:noNode
echo [ERROR] Node.js not found. Please install Node.js 18 or newer first.
pause
exit /b 1
