@echo off
chcp 65001 >nul
setlocal

REM Backup office source code to GitHub

cd /d "%~dp0" || goto :FAILED

echo [%date% %time%] [check] Verifying git work tree...
git rev-parse --is-inside-work-tree >nul 2>&1
if errorlevel 1 goto :FAILED

echo [%date% %time%] [stage] git add --all
git add --all
if errorlevel 1 goto :FAILED

echo [%date% %time%] [commit] Checking for changes...
git diff --cached --quiet
set "DIFF_EXIT=%errorlevel%"
if "%DIFF_EXIT%"=="0" (
    echo [%date% %time%] [skip] No changes to commit
) else if "%DIFF_EXIT%"=="1" (
    git commit -m "quick source backup"
    if errorlevel 1 goto :FAILED
) else (
    goto :FAILED
)

echo [%date% %time%] [push] Pushing to origin/main...
git push origin main --progress
if errorlevel 1 goto :FAILED

color 0A
echo.
echo [SUCCESS] Backup pushed to GitHub.
pause
exit /b 0

:FAILED
color 0C
echo.
echo [FAILED] Backup did not complete. Check errors above.
pause
exit /b 1
