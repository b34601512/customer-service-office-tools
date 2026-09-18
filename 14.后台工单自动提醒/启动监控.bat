@echo off
setlocal EnableExtensions
chcp 65001 >nul
cd /d "%~dp0"
title 14号后台工单自动提醒

where node >nul 2>nul
if errorlevel 1 (
  echo [错误] 未找到 Node.js，请先安装 Node.js 18 以上版本。
  pause
  exit /b 1
)

echo ============================================================
echo  14号 后台工单自动提醒
echo   - 各店铺浏览器窗口会保持打开，登录态一直留着：别关窗口
echo   - 每 5 分钟一轮；有需要处理的工单就 @当日值班 发企微
echo   - 退出：按 Ctrl+C 只停程序，浏览器窗口不关
echo ============================================================
echo.
echo   回车 = 启动常驻监控（发现新工单会真发企微）
echo   输入 d + 回车 = 演练常驻（只判断、不发送）
echo   输入 m + 回车 = 登录/状态/自测 菜单
echo.
set "MODE="
set /p "MODE=请选择后回车 [默认=启动监控]: "

if /i "%MODE%"=="d" (
  echo.
  echo [演练模式] 只判断、不发送。
  node src\cli\startCli.js run --dry-run
) else if /i "%MODE%"=="m" (
  node src\cli\startCli.js menu
) else (
  echo.
  echo [监控模式] 发现新工单会真发企微并 @当日值班。
  node src\cli\startCli.js run
)

if errorlevel 1 (
  echo.
  echo [错误] 程序异常退出，上面的报错信息请截图反馈。
)
echo.
echo 已退出监控；浏览器窗口要关的话，直接关闭对应窗口即可。
pause
endlocal
