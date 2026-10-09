@echo off
rem Builds "RFP Manager.exe" (the app with a tray icon and its own windows). Nothing is downloaded.
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0tools\build-exe.ps1"
pause
