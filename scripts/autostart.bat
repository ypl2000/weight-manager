@echo off
rem 体重管理服务开机自启载荷:由 Startup 文件夹快捷方式调用,窗口隐藏
chcp 65001 >nul
cd /d "%~dp0.."
start "" /b "%~dp0..\backend\.venv\Scripts\pythonw.exe" -m uvicorn main:app --host 0.0.0.0 --port 8000 --app-dir "%~dp0..\backend"
