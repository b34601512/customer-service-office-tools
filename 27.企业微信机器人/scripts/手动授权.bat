@echo off
setlocal EnableExtensions
chcp 65001 >nul
cd /d "%~dp0"

echo ============================================================
echo  WeCom CLI manual auth  (API-mode bot: Bot ID + Secret)
echo ============================================================
echo  Create the robot first in the WeCom client:
echo    Workbench - Smart Robot - Create - Manual - API mode
echo    Connection: "Long connection"
echo    Then copy the generated Bot ID and Secret.
echo  Official guide:
echo    https://open.work.weixin.qq.com/help2/pc/cat?doc_id=21677
echo.
echo  Type / paste them below. The Secret input is not echoed,
echo  and never leaves this window.
echo ============================================================
echo.

where wecom-cli >nul 2>nul
if errorlevel 1 (
  echo [ERROR] wecom-cli not found. Run: npm install -g @wecom/cli
  echo.
  pause
  exit /b 1
)

wecom-cli auth init --manual
set AUTH_EXIT=%ERRORLEVEL%

echo.
echo ---- auth status ----
wecom-cli auth show --status

echo.
if not "%AUTH_EXIT%"=="0" echo [WARN] auth init exited with code %AUTH_EXIT%.
echo If it shows "authorized", you are done. Close this window.
pause
