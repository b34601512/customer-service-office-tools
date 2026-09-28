@echo off
setlocal EnableExtensions
chcp 65001 >nul
cd /d "%~dp0"

echo ============================================================
echo  WeCom CLI auth by QR code  (recommended, one scan)
echo ============================================================
echo  1. A QR code appears below (valid for 5 minutes).
echo  2. Open WeCom  on your phone and scan it.
echo  3. Confirm on the phone; wait until it prints "authorized".
echo.
echo  Tip: if the phone cannot scan the terminal QR code, ask your AI
echo  to run:  wecom-cli auth init --noninteractive --output-qrcode qr.png
echo  then scan the generated qr.png image.
echo ============================================================
echo.

where wecom-cli >nul 2>nul
if errorlevel 1 (
  echo [ERROR] wecom-cli not found. Run: npm install -g @wecom/cli
  echo.
  pause
  exit /b 1
)

wecom-cli auth init --noninteractive
set AUTH_EXIT=%ERRORLEVEL%

echo.
echo ---- auth status ----
wecom-cli auth show --status
echo.
if not "%AUTH_EXIT%"=="0" echo [WARN] auth init exited with code %AUTH_EXIT%.
echo If it shows "authorized", you are done. Close this window.
pause
