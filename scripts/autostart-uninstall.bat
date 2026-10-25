@echo off
rem Remove auto-start shortcut
chcp 65001 >nul
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0autostart-uninstall.ps1"
pause
