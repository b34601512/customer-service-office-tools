@echo off
setlocal EnableExtensions DisableDelayedExpansion

rem Run directly in the current console. Never spawn another window.
set "LAUNCHER_DIR=%~dp0"
set "BACKEND_DIR="
for /d %%D in ("%LAUNCHER_DIR%*") do (
    if exist "%%~fD\cli.py" set "BACKEND_DIR=%%~fD"
)
if not defined BACKEND_DIR (
    echo Startup failed: backend folder with cli.py was not found.
    pause
    exit /b 1
)
cd /d "%BACKEND_DIR%"
set "TEMP=%BACKEND_DIR%\tmp"
set "TMP=%BACKEND_DIR%\tmp"
set "PYTHONIOENCODING=utf-8"
if not exist "%TEMP%" mkdir "%TEMP%"
if /i "%~1"=="--check" (
    echo BACKEND_DIR=%BACKEND_DIR%
    echo CLI_PATH=%CD%\cli.py
    exit /b 0
)
echo [START] Starting phone missed-call CLI...
python cli.py
set "EXIT_CODE=%ERRORLEVEL%"
if not "%EXIT_CODE%"=="0" (
    echo.
    echo Startup failed. Check the run log in this folder.
    pause
)
exit /b %EXIT_CODE%
