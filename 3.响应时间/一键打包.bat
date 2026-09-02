@echo off
setlocal EnableExtensions DisableDelayedExpansion
pushd "%~dp0"
if /I "%~1"=="--self-test" (
    powershell -NoProfile -ExecutionPolicy Bypass -File ".\build_release.ps1" -SelfTest
    set "EXIT_CODE=%ERRORLEVEL%"
    popd
    exit /b %EXIT_CODE%
)
powershell -NoProfile -ExecutionPolicy Bypass -File ".\build_release.ps1" %*
set "EXIT_CODE=%ERRORLEVEL%"
echo.
if not "%EXIT_CODE%"=="0" (
    echo Build failed. Please check the log above.
) else (
    echo Build completed. Please check the release directory and zip path above.
)
echo.
pause
popd
exit /b %EXIT_CODE%
