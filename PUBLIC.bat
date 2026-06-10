@echo off
chcp 65001 >nul
title SanEpid PUBLIC - do not close (phones use this link)
cd /d "%~dp0"

set "PY=%~dp0server\.venv\Scripts\python.exe"
if not exist "%PY%" (
  echo Run START.bat first.
  pause
  exit /b 1
)

echo.
echo  This creates a link for PHONES and other laptops.
echo  Keep this window OPEN while showing the project.
echo.
"%PY%" "%~dp0scripts\public_link.py"
echo.
echo Link stopped - phones cannot open it anymore.
pause
