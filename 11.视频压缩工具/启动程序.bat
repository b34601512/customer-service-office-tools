@echo off
setlocal
chcp 65001 >nul
cd /d "%~dp0"
set PYTHONDONTWRITEBYTECODE=1

if not exist ".venv\Scripts\python.exe" (
  echo 请先运行“安装依赖.bat”。
  pause
  exit /b 1
)

".venv\Scripts\python.exe" -B main.py %*
if errorlevel 1 (
  echo.
  echo 程序启动失败，请查看上面的报错信息。
  pause
)
