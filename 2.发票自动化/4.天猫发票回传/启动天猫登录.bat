@echo off
setlocal EnableExtensions DisableDelayedExpansion
rem Start one independent maximized window; never call this batch file recursively.
chcp 65001>nul
cd /d "%~dp0"
set "NODE_EXE=%~dp0runtime\node\node.exe"
if not exist "%NODE_EXE%" set "NODE_EXE=node.exe"
start "" /max /D "%~dp0" "%NODE_EXE%" src\tui\startTui.js
set "START_CODE=%ERRORLEVEL%"
endlocal & exit /b %START_CODE%

