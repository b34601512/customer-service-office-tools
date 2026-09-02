@echo off
cd /d "%~dp0"
where pythonw >nul 2>nul
if %errorlevel%==0 (
    start "" pythonw app_entry.py
    exit /b 0
)
start "" python app_entry.py
