@echo off
setlocal EnableExtensions DisableDelayedExpansion
pushd "%~dp0"
powershell -NoProfile -ExecutionPolicy Bypass -File ".\build_release.ps1" %*
set "EXIT_CODE=%ERRORLEVEL%"
echo.
if not "%EXIT_CODE%"=="0" (
    echo Build failed. Please check the log above.
) else (
    echo Build completed. Please check the release package above.
)
echo.
pause
popd
exit /b %EXIT_CODE%
