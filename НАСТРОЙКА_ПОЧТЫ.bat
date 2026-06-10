@echo off
chcp 65001 >nul
cd /d "%~dp0"
if not exist "config\smtp.env" (
  copy "config\smtp.env.example" "config\smtp.env"
  echo Создан config\smtp.env — заполните SMTP_USER и SMTP_PASSWORD
) else (
  echo Редактирование config\smtp.env
)
notepad "config\smtp.env"
echo.
echo После сохранения перезапустите START.bat
pause
