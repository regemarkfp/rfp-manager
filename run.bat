@echo off
title RFP Manager
cd /d "%~dp0"
where node >nul 2>nul
if errorlevel 1 (
  echo Node.js is not installed. Install the current LTS from https://nodejs.org and run this again.
  pause
  exit /b 1
)
:start
node --disable-warning=ExperimentalWarning server.js
rem exit code 75: RFP Manager updated itself, start it again
if %errorlevel%==75 goto start
pause
