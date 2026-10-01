@echo off
rem Open the always-on "Mu Wanqing" WeCom listener window in the repo root.
rem First prompt = 27\boot-prompt.md (path via %~dp0; this file stays ASCII-only on purpose).
cd /d "%~dp0..\.."
call "C:\Users\b3460\AppData\Local\PiCodingAgentInstaller\bin\pi.cmd" "@%~dp0..\boot-prompt.md"
if errorlevel 1 pause
