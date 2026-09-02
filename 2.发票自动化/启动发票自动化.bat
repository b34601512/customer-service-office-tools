@echo off
setlocal EnableExtensions DisableDelayedExpansion

rem Start one independent maximized window; never call this batch file recursively.
set "PROJECT_DIR=%~dp0"
set "NODE_EXE=%PROJECT_DIR%runtime\node\node.exe"
if exist "%NODE_EXE%" goto NODE_READY
where node.exe >nul 2>nul
if errorlevel 1 goto NODE_MISSING
set "NODE_EXE=node.exe"

:NODE_READY
set "ENTRY_FILE="
for %%F in ("%PROJECT_DIR%tui\*TUI.js") do (
    if exist "%%~fF" set "ENTRY_FILE=%%~fF"
)
if not defined ENTRY_FILE goto ENTRY_MISSING
title Invoice Automation Console
start "" /max /D "%PROJECT_DIR%" "%NODE_EXE%" "%ENTRY_FILE%"
set "START_CODE=%ERRORLEVEL%"
if not "%START_CODE%"=="0" echo [ERROR] The TUI window could not be started. Exit code: %START_CODE%.
exit /b %START_CODE%

:NODE_MISSING
echo [ERROR] Node.js was not found. Cannot start the main entry.
pause
exit /b 1

:ENTRY_MISSING
echo [ERROR] TUI entry file was not found in the tui folder.
pause
exit /b 1
