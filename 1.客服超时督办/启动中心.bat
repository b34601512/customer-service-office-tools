@echo off
setlocal EnableExtensions DisableDelayedExpansion
if /i not "%~1"=="--launcher-maximized" (
    start "" /max "%ComSpec%" /d /c call "%~f0" --launcher-maximized %*
    exit /b
)
if /i "%~1"=="--launcher-maximized" shift
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

node src\controlCenter\startControlCenter.js --tui
if errorlevel 1 (
  echo.
  echo [ERROR] The program exited with an error. Press any key to close.
  pause >nul
)
endlocal
