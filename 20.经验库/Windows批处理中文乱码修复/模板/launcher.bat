@echo off
rem ============================================================
rem  Launcher ONLY. Pure ASCII (no Chinese, no BOM), CRLF.
rem  All Chinese text lives in launcher.ps1 (UTF-8 with BOM).
rem  Usage: put this file and launcher.ps1 in the SAME folder,
rem         then double-click this file.
rem ============================================================
cd /d "%~dp0"
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0launcher.ps1"
if errorlevel 1 pause
