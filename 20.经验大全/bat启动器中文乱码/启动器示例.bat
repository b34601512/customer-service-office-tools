@echo off
rem Launcher only. KEEP PURE ASCII - no Chinese here, no BOM.
rem All Chinese UI text lives in start_comfy.ps1 (UTF-8 with BOM, CRLF).
cd /d "%~dp0"
powershell -NoProfile -ExecutionPolicy Bypass -File start_comfy.ps1
if errorlevel 1 pause
