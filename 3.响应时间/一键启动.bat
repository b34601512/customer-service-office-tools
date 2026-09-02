@echo off
setlocal EnableExtensions DisableDelayedExpansion
pushd "%~dp0"
powershell -NoProfile -ExecutionPolicy Bypass -File ".\launcher.ps1" -Mode "%~1"
set "EXIT_CODE=%ERRORLEVEL%"
if not "%EXIT_CODE%"=="0" (
    echo.
    echo Launcher failed. See logs\last_startup.log
    pause
)
popd
exit /b %EXIT_CODE%
