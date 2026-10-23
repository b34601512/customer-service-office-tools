@echo off
setlocal
chcp 65001 >nul
cd /d "%~dp0"
set PYTHONDONTWRITEBYTECODE=1

if not exist ".venv\Scripts\python.exe" (
  echo Please run the dependency installer first.
  pause
  exit /b 1
)

".venv\Scripts\python.exe" -B main.py %*
if errorlevel 1 (
  echo.
  echo Program failed to start. Check the error message above.
  pause
)
