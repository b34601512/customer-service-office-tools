@echo off
setlocal EnableExtensions DisableDelayedExpansion
rem Run directly in the current console. Never spawn another window.
set "LAUNCHER_DIR=%~dp0"
chcp 65001 >nul
set "PYTHONUTF8=1"
set "AUTO_REPORT_PYTHON_EXE="
set "AUTO_REPORT_DIR="
set "AUTO_REPORT_ENTRY="

for /f "delims=" %%I in ('where python 2^>nul') do if not defined AUTO_REPORT_PYTHON_EXE set "AUTO_REPORT_PYTHON_EXE=%%I"
for /d %%D in ("%LAUNCHER_DIR%*") do if exist "%%~fD\requirements.txt" set "AUTO_REPORT_DIR=%%~fD"
for %%F in ("%AUTO_REPORT_DIR%\*CLI.py") do if exist "%%~fF" set "AUTO_REPORT_ENTRY=%%~fF"

if not defined AUTO_REPORT_PYTHON_EXE (
    echo Python was not found. Please install Python first.
    pause
    exit /b 1
)
if not defined AUTO_REPORT_DIR (
    echo The auto-report project folder was not found.
    pause
    exit /b 1
)
if not defined AUTO_REPORT_ENTRY (
    echo The auto-report CLI entry file was not found.
    pause
    exit /b 1
)

"%AUTO_REPORT_PYTHON_EXE%" -c "import openpyxl; from PIL import Image; import playwright" >nul 2>&1
if errorlevel 1 (
    echo Installing required auto-report packages...
    "%AUTO_REPORT_PYTHON_EXE%" -m pip install --disable-pip-version-check -r "%AUTO_REPORT_DIR%\requirements.txt"
    if errorlevel 1 (
        echo Package installation failed. Please check the network and retry.
        pause
        exit /b 1
    )
)

"%AUTO_REPORT_PYTHON_EXE%" "%AUTO_REPORT_ENTRY%"
set "AUTO_REPORT_EXIT_CODE=%ERRORLEVEL%"
if not "%AUTO_REPORT_EXIT_CODE%"=="0" (
    echo.
    echo The program exited with code: %AUTO_REPORT_EXIT_CODE%
    echo Keep this window open for troubleshooting.
    pause
)

endlocal & exit /b %AUTO_REPORT_EXIT_CODE%
