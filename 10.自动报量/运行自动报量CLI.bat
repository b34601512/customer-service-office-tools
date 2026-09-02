@echo off
setlocal EnableExtensions DisableDelayedExpansion
if /i not "%~1"=="--launcher-maximized" (
    start "" /max "%ComSpec%" /d /c call "%~f0" --launcher-maximized %*
    exit /b
)
rem shift makes %0 become old %1, so %~dp0 would degrade to cwd; pin script dir before shift
set "LAUNCHER_DIR=%~dp0"
if /i "%~1"=="--launcher-maximized" shift
chcp 65001 >nul
set "PYTHONUTF8=1"
set "AUTO_REPORT_PYTHON_EXE="

for /f "delims=" %%I in ('where python 2^>nul') do if not defined AUTO_REPORT_PYTHON_EXE set "AUTO_REPORT_PYTHON_EXE=%%I"

if not defined AUTO_REPORT_PYTHON_EXE (
    echo 未找到Python，请先安装Python后重试。
    pause
    exit /b 1
)

"%AUTO_REPORT_PYTHON_EXE%" -c "import openpyxl; from PIL import Image; import playwright" >nul 2>&1
if errorlevel 1 (
    echo 首次运行，正在安装自动报量所需组件...
    "%AUTO_REPORT_PYTHON_EXE%" -m pip install --disable-pip-version-check -r "%LAUNCHER_DIR%自动报量CLI\requirements.txt"
    if errorlevel 1 (
        echo 组件安装失败，请检查网络后重新运行。
        pause
        exit /b 1
    )
)

"%AUTO_REPORT_PYTHON_EXE%" "%LAUNCHER_DIR%自动报量CLI\自动报量CLI.py"
set "AUTO_REPORT_EXIT_CODE=%ERRORLEVEL%"
if not "%AUTO_REPORT_EXIT_CODE%"=="0" (
    echo.
    echo 程序异常退出，错误码：%AUTO_REPORT_EXIT_CODE%
    echo 请保留本窗口内容，方便排查。
    pause
)

endlocal & exit /b %AUTO_REPORT_EXIT_CODE%
