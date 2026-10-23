@echo off
setlocal EnableExtensions DisableDelayedExpansion
rem Runs the CLI inside the caller window (Windows Terminal shell); store collection defaults to hybrid Chrome mode.
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
set "START_CODE=%ERRORLEVEL%"
popd
endlocal & exit /b %START_CODE%
