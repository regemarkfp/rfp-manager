@echo off
rem Builds "RFP Manager.exe": RFP Manager in its own windows, with a tray icon. The first build fetches the WebView2 SDK (needs internet once).
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0tools\build-exe.ps1"
pause
