@echo off
setlocal
chcp 65001>nul
cd /d "%~dp0"
set "PYTHON_EXE=%~dp0runtime\python\python.exe"
if exist "%PYTHON_EXE%" goto run_pack
set "PYTHON_EXE=%~dp0.venv\Scripts\python.exe"
if exist "%PYTHON_EXE%" goto run_pack
where python >nul 2>nul
if errorlevel 1 (
    echo Python not found and runtime\python is missing.
    exit /b 1
)
echo Creating project Python environment...
python -m venv "%~dp0.venv"
if errorlevel 1 exit /b %errorlevel%
set "PYTHON_EXE=%~dp0.venv\Scripts\python.exe"
if not exist "%PYTHON_EXE%" (
    echo Project Python environment creation failed: %PYTHON_EXE%
    exit /b 1
)

:run_pack
"%PYTHON_EXE%" -m refund_reminder.dependency_bootstrap
if errorlevel 1 exit /b %errorlevel%
"%PYTHON_EXE%" -m release.build_portable_package
set "EXIT_CODE=%ERRORLEVEL%"
echo.
pause
exit /b %EXIT_CODE%
