@echo off
setlocal
chcp 65001 >nul
cd /d "%~dp0"

if not exist ".venv\Scripts\python.exe" (
  python -m venv .venv
  if errorlevel 1 goto venv_failed
)

".venv\Scripts\python.exe" -m pip install --upgrade pip
if errorlevel 1 goto install_failed

".venv\Scripts\python.exe" -m pip install -r requirements.txt
if errorlevel 1 goto install_failed

echo.
echo 依赖安装完成。
pause
exit /b 0

:venv_failed
echo.
echo 创建独立 Python 环境失败，请检查 Python 是否已安装。
pause
exit /b 1

:install_failed
echo.
echo 依赖安装失败，请检查 Python 环境或网络。
pause
exit /b 1
