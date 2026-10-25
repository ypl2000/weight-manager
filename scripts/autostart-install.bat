@echo off
rem Install auto-start shortcut (current user, no admin needed)
chcp 65001 >nul
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0autostart-install.ps1"
pause
