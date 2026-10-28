@echo off
title Lauwak - Corvus AI Server
cd /d "%~dp0"

where node >nul 2>&1
if errorlevel 1 (
  echo.
  echo   Node.js is not installed or not in PATH.
  echo   Install it first from https://nodejs.org then try again.
  echo.
  pause
  exit /b 1
)
rem Test-NetConnection with ">nul 2>&1" always left errorlevel at 0, so this step was
rem skipped even when MongoDB was down. A raw socket check reports the port honestly,
rem and the message says so either way: no window when a service already holds 27017.
powershell -NoProfile -Command "$c=New-Object Net.Sockets.TcpClient; try{ $c.Connect('127.0.0.1',27017); exit 0 } catch {} finally { $c.Close() }; exit 1"
if errorlevel 1 (
  echo Starting MongoDB on port 27017...
  start "Lauwak - MongoDB" /min cmd /c backend\start-mongo.bat
) else (
  echo MongoDB is already running on port 27017, no window needed.
)

echo Starting account server (Django + MongoDB) on port 8000...
rem The venv lives outside OneDrive on purpose: a Python environment is not
rem relocatable once it exists, and syncing thousands of small files makes
rem every import slower and can leave half-copied packages behind.
set "VENV=%LOCALAPPDATA%\Lauwak\.venv"
if not exist "%VENV%\Scripts\python.exe" (
  echo   Setting up Python environment, first run only...
  python -m venv "%VENV%"
  "%VENV%\Scripts\python" -m pip install -q -r backend\requirements.txt
)
start "Lauwak - Accounts (Django)" /min "%VENV%\Scripts\python.exe" backend\manage.py runserver 127.0.0.1:8000 --noreload

echo Starting Corvus AI server...
echo Keep this window open while using AI features.
echo.
start "" http://localhost:3847
node server\server.js
echo.
echo Server stopped. Press any key to close.
pause >nul
