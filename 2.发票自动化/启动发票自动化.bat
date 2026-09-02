@echo off
setlocal EnableExtensions DisableDelayedExpansion
if /i not "%~1"=="--launcher-maximized" (
    start "" /max "%ComSpec%" /d /c call "%~f0" --launcher-maximized %*
    exit /b
)
if /i "%~1"=="--launcher-maximized" shift
chcp 65001>nul
title 发票自动化总控制台
cd /d "%~dp0"

set "NODE_EXE=%~dp0runtime\node\node.exe"
if exist "%NODE_EXE%" goto NODE_READY
where node.exe >nul 2>nul
if errorlevel 1 goto NODE_MISSING
set "NODE_EXE=node.exe"

:NODE_READY

"%NODE_EXE%" "%~dp0tui\总入口TUI.js"
set "EXIT_CODE=%ERRORLEVEL%"
if "%EXIT_CODE%"=="0" exit /b 0

echo.
echo [错误] 总控制台启动失败，退出码：%EXIT_CODE%
pause
exit /b %EXIT_CODE%

:NODE_MISSING
echo [错误] 未找到 Node.js，无法启动总入口。
pause
exit /b 1
