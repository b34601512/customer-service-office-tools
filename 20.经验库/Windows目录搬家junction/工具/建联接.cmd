@echo off
rem Junction maker: make OLD_PATH a directory junction pointing to NEW_PATH.
rem ASCII only on purpose (see the pack README). No admin rights needed.
rem Usage: %~nx0 "OLD_PATH" "NEW_PATH" [--yes]
rem   OLD_PATH : the path to become a portal (must NOT exist yet)
rem   NEW_PATH : the existing real folder (must exist)
rem   --yes    : skip the confirmation prompt (for scripts)
setlocal
if "%~1"=="" goto usage
if "%~2"=="" goto usage
set "OLD=%~f1"
set "NEW=%~f2"
if not exist "%NEW%\" (
  echo [ERR] Target folder does not exist: %NEW%
  exit /b 2
)
if exist "%OLD%\" (
  echo [ERR] Link path already exists: %OLD%
  echo       If it is an old junction, remove it first:  rmdir "%OLD%"
  exit /b 3
)
echo Will create a junction:
echo   OLD : %OLD%
echo   NEW : %NEW%
if /i "%~3"=="--yes" goto doit
set /p OK=Proceed? [y/N] 
if /i not "%OK%"=="y" exit /b 0
:doit
mklink /J "%OLD%" "%NEW%"
if errorlevel 1 exit /b 1
echo.
echo [OK] Junction created. Verify with:
echo      dir /AL "%OLD%"
exit /b 0

:usage
echo Usage: %~nx0 "OLD_PATH" "NEW_PATH" [--yes]
echo   OLD_PATH must NOT exist yet; NEW_PATH must exist.
echo   Example: %~nx0 "D:\data\old" "D:\data\new"
exit /b 2
