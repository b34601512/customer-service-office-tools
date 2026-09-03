@echo off
setlocal EnableExtensions
rem One-click launcher for BOSS Zhipin TUI (auto install missing deps, maximize window)
chcp 65001 >nul
title BOSS Zhipin Collector
cd /d "%~dp0" || ( echo [ERROR] cannot enter program dir & pause & exit /b 1 )

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
    echo [ERROR] dependency install failed. Run "install-deps.bat" manually.
    pause
    exit /b 1
  )
)

rem maximize current console window without node dependency
python -c "import ctypes; ctypes.windll.user32.ShowWindow(ctypes.windll.kernel32.GetConsoleWindow(), 3)"

python -B boss_tui.py
if errorlevel 1 (
  echo.
  echo [ERROR] program exited with error, see output above.
  pause
)
endlocal