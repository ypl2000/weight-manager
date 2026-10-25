@echo off
chcp 65001 >nul
cd /d %~dp0

if not exist backend\.venv (
  echo [1/2] First run: creating python venv and installing deps...
  python -m venv backend\.venv
  backend\.venv\Scripts\python -m pip install -r backend\requirements.txt
)

echo Starting server: http://127.0.0.1:8000
echo Phone: open http://^<PC-IP^>:8000 in the same WiFi. Press Ctrl+C to stop.
backend\.venv\Scripts\python -m uvicorn main:app --host 0.0.0.0 --port 8000 --app-dir backend
pause
