@echo off
setlocal EnableExtensions DisableDelayedExpansion

rem 通过新窗口启动，避免直接修改当前控制台窗口状态导致窗口被锁定。
if /i not "%~1"=="--check" if /i not "%~1"=="--launcher-maximized" (
    start "" /max "%ComSpec%" /d /c call "%~f0" --launcher-maximized %*
    exit /b
)
rem shift makes %0 become old %1, so %~dp0 would degrade to cwd; pin script dir before shift
set "LAUNCHER_DIR=%~dp0"
if /i "%~1"=="--launcher-maximized" shift
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
