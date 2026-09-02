@echo off
setlocal EnableExtensions DisableDelayedExpansion
if /i not "%~1"=="--launcher-maximized" (
    start "" /max "%ComSpec%" /d /c call "%~f0" --launcher-maximized %*
    exit /b
)
if /i "%~1"=="--launcher-maximized" shift
chcp 65001>nul
cd /d "%~dp0"
set "NODE_EXE=%~dp0runtime\node\node.exe"
if not exist "%NODE_EXE%" set "NODE_EXE=node.exe"
"%NODE_EXE%" src\tui\startTui.js
set "EXIT_CODE=%ERRORLEVEL%"
endlocal & exit /b %EXIT_CODE%

