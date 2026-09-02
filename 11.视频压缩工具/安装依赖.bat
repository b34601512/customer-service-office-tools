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
echo Dependencies installed successfully.
pause
exit /b 0

:venv_failed
echo.
echo Failed to create the Python environment. Check that Python is installed.
pause
exit /b 1

:install_failed
echo.
echo Dependency installation failed. Check Python and network access.
pause
exit /b 1
