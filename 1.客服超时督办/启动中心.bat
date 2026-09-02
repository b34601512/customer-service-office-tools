@echo off
setlocal EnableExtensions DisableDelayedExpansion
rem Start one independent maximized window; never call this batch file recursively.
rem Customer Service Timeout Supervisor - TUI launcher (English-only)
rem Double-click this file to open the terminal UI control center.
chcp 65001 >nul
cd /d "%~dp0"

where node >nul 2>nul
if errorlevel 1 (
  echo [ERROR] Node.js not found. Please install Node.js first.
  pause
  exit /b 1
)

start "" /max /D "%~dp0" node.exe src\controlCenter\startControlCenter.js --tui
set "START_CODE=%ERRORLEVEL%"
if not "%START_CODE%"=="0" echo [ERROR] The TUI window could not be started. Exit code: %START_CODE%.
endlocal & exit /b %START_CODE%
