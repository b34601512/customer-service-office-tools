@echo off
setlocal EnableExtensions DisableDelayedExpansion
if /i not "%~1"=="--launcher-maximized" (
    start "" /max "%ComSpec%" /d /c call "%~f0" --launcher-maximized %*
    exit /b
)
if /i "%~1"=="--launcher-maximized" shift
chcp 65001 >nul
title Customer Performance CLI v1.0.1
pushd "%~dp0"
where node.exe >nul 2>&1
if errorlevel 1 (
  echo Node.js was not found. Please install Node.js or use the portable package.
  pause
  popd
  endlocal
  exit /b 1
)
node.exe "%~dp0src\cli\startCli.js"
set "applicationExitCode=%ERRORLEVEL%"
if not "%applicationExitCode%"=="0" pause
popd
endlocal & exit /b %applicationExitCode%
