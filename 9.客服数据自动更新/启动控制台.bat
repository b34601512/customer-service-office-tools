@echo off
setlocal EnableExtensions DisableDelayedExpansion
rem Start one independent maximized window; never call this batch file recursively.
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
start "" /max /D "%~dp0" node.exe "%~dp0src\cli\startCli.js"
set "START_CODE=%ERRORLEVEL%"
popd
endlocal & exit /b %START_CODE%
