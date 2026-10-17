@echo off
rem Launcher ONLY. Pure ASCII (no Chinese, no BOM), CRLF.
rem All Chinese text lives in daemon-launcher.ps1 (UTF-8 with BOM).
rem NOTE: do NOT put a Chinese file name in here - those bytes are Chinese too.
chcp 65001 >nul
cd /d "%~dp0"
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0daemon-launcher.ps1"
if errorlevel 1 pause
