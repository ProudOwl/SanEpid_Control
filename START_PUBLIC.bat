@echo off
chcp 65001 >nul
title SanEpid - server + public link
cd /d "%~dp0"
echo.
echo Step 1: starting server...
start "SanEpid Server" cmd /k "%~dp0START.bat"
echo Waiting 12 sec for server...
timeout /t 12 /nobreak >nul
echo Step 2: public link...
start "SanEpid PUBLIC" cmd /k "%~dp0PUBLIC.bat"
