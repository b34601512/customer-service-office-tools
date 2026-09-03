@echo off
setlocal EnableExtensions DisableDelayedExpansion
chcp 65001 >nul
cd /d "%~dp0"

where node >nul 2>nul
if errorlevel 1 (
  echo [错误] 未找到 Node.js，请先安装 Node.js 18 以上版本。
  pause
  exit /b 1
)

node src\cli\startCli.js menu
if errorlevel 1 (
  echo.
  echo [错误] 程序异常退出，上面的报错信息请截图反馈。
  pause
)
endlocal & exit /b %ERRORLEVEL%
