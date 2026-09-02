@echo off
setlocal EnableExtensions DisableDelayedExpansion
if /i not "%~1"=="--launcher-maximized" (
    start "" /max "%ComSpec%" /d /c call "%~f0" --launcher-maximized %*
    exit /b
)
if /i "%~1"=="--launcher-maximized" shift
chcp 65001 >nul
title Store Metric CLI v0.01
pushd "%~dp0"
if errorlevel 1 (
  echo Failed to open the program directory.
  pause
  exit /b 1
)
where node.exe >nul 2>nul
if errorlevel 1 (
  echo Node.js was not found.
  popd
  pause
  exit /b 1
)
node.exe "%~dp0src\cli\startCli.js"
set "programExitCode=%errorlevel%"
popd
if not "%programExitCode%"=="0" pause
exit /b %programExitCode%
