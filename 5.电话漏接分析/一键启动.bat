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
echo [START] Opening maximized phone missed-call CLI...
rem Start one independent window directly; do not call this batch file recursively.
start "" /max /D "%BACKEND_DIR%" python.exe cli.py
set "START_CODE=%ERRORLEVEL%"
if not "%START_CODE%"=="0" echo Startup failed: Python window could not be started.
exit /b %START_CODE%
