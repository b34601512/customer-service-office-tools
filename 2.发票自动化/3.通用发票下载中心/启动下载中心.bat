@echo off
setlocal EnableExtensions DisableDelayedExpansion
if /i not "%~1"=="--launcher-maximized" (
    start "" /max "%ComSpec%" /d /c call "%~f0" --launcher-maximized %*
    exit /b
)
if /i "%~1"=="--launcher-maximized" shift
chcp 65001>nul
title 通用发票下载中心 CLI
cd /d "%~dp0"

set "NODE_EXE=%~dp0runtime\node\node.exe"
if exist "%NODE_EXE%" goto NODE_READY
where node.exe >nul 2>nul
if errorlevel 1 goto NODE_MISSING
set "NODE_EXE=node.exe"

:NODE_READY

"%NODE_EXE%" src\tui\startTui.js
set "EXIT_CODE=%ERRORLEVEL%"
if "%EXIT_CODE%"=="0" goto START_OK
goto START_FAILED

:NODE_MISSING
echo [ERROR] Node.js not found.
echo [LOG] Node startup was not reached.
echo.
pause
exit /b 1

:START_OK
echo.
exit /b 0

:START_FAILED
echo.
echo [ERROR] Start failed. Exit code: %EXIT_CODE%
echo [LOG] runtime\latest-run.log
echo.
pause
exit /b %EXIT_CODE%


