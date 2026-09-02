@echo off
setlocal EnableExtensions DisableDelayedExpansion
rem 课件制作助手：独立最大化窗口启动（取数自动化 + AI 解析 + 程序出片）
chcp 65001 >nul
title 课件制作助手 v0.1
pushd "%~dp0"
if errorlevel 1 (
  echo 无法进入程序目录。
  pause
  exit /b 1
)
where node.exe >nul 2>nul
if errorlevel 1 (
  echo 未找到 Node.js，请先安装。
  popd
  pause
  exit /b 1
)
start "" /max /D "%~dp0" node.exe "%~dp0src\startTui.js"
set "START_CODE=%ERRORLEVEL%"
popd
endlocal & exit /b %START_CODE%
