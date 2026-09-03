@echo off
setlocal EnableExtensions
rem Install dependencies for BOSS Zhipin collector (requests / websocket-client)
chcp 65001 >nul
cd /d "%~dp0" || ( echo [ERROR] cannot enter program dir & pause & exit /b 1 )

where python.exe >nul 2>nul
if errorlevel 1 (
  echo [ERROR] python not found. Install Python 3.10+ and check "Add to PATH".
  pause
  exit /b 1
)

python -m pip install -r requirements.txt
if errorlevel 1 (
  echo [ERROR] install failed. Check network or pip config.
  pause
  exit /b 1
)
echo.
echo [DONE] dependencies ready.
pause