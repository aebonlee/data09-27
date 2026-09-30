@echo off
rem data09-27 - monthly report collector. Double-click this file.
rem Runs collector\Collect-OutlookMail.ps1 (read-only, local only). See README.
setlocal
cd /d "%~dp0"
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0collector\Collect-OutlookMail.ps1" -Mode monthly
if errorlevel 1 pause
endlocal
