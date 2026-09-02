@echo off
setlocal EnableExtensions DisableDelayedExpansion
rem Start one independent maximized window; never call this batch file recursively.
chcp 65001>nul
title Invoice Download Center CLI
cd /d "%~dp0"

set "NODE_EXE=%~dp0runtime\node\node.exe"
if exist "%NODE_EXE%" goto NODE_READY
where node.exe >nul 2>nul
if errorlevel 1 goto NODE_MISSING
set "NODE_EXE=node.exe"

:NODE_READY

start "" /max /D "%~dp0" "%NODE_EXE%" src\tui\startTui.js
set "START_CODE=%ERRORLEVEL%"
if "%START_CODE%"=="0" goto START_OK
goto START_FAILED

:NODE_MISSING
echo [ERROR] Node.js not found.
echo [LOG] Node startup was not reached.
echo.
pause
exit /b 1

:START_OK
exit /b 0

:START_FAILED
echo.
echo [ERROR] TUI window could not be started. Exit code: %START_CODE%
echo [LOG] runtime\latest-run.log
echo.
pause
exit /b %START_CODE%


