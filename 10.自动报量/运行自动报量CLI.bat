@echo off
rem 用 Windows Terminal 起（老板 2026-10-23 要求，统一外壳）
rem 真正干活的还是 运行自动报量CLI-内部.bat；wt 只负责窗口：-M 最大化、-d 指定工作目录（等价原来的 cd /d "%~dp0"）。
where wt.exe >nul 2>nul || (echo 需要 Windows Terminal，请先安装 & pause & exit /b 1)
start "" wt.exe -M -d "%~dp0." cmd /c "运行自动报量CLI-内部.bat"
