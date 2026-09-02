@echo off
setlocal
cd /d "%~dp0"

powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\buildPortablePackage.ps1"
set "packageExitCode=%ERRORLEVEL%"
pause
endlocal & exit /b %packageExitCode%
