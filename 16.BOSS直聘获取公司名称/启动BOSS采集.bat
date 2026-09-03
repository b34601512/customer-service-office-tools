@echo off
setlocal EnableExtensions DisableDelayedExpansion
rem Start one independent maximized window for BOSS Zhipin TUI.
chcp 65001 >nul
cd /d "%~dp0"

where python.exe >nul 2>nul
if errorlevel 1 (
  echo [ERROR] python not found. Install Python 3.10+ and check "Add to PATH".
  pause
  exit /b 1
)

python -c "import requests, websocket" >nul 2>nul
if errorlevel 1 (
  echo [INFO] first run: installing dependencies requests + websocket-client...
  python -m pip install -r requirements.txt
  if errorlevel 1 (
    echo [ERROR] dependency install failed. Run install-deps.bat manually.
    pause
    exit /b 1
  )
)

rem Match project 1: create one independent maximized console window.
start "" /max /D "%~dp0" python.exe -B boss_tui.py
set "START_CODE=%ERRORLEVEL%"
if not "%START_CODE%"=="0" (
  echo [ERROR] failed to start TUI. Exit code: %START_CODE%.
  pause
  exit /b %START_CODE%
)
endlocal
exit /b 0