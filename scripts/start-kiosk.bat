@echo off
rem Starts the Video Kiosk server. Keep this window open during the event.
cd /d "%~dp0.."
title Video Kiosk Server
node server.js
echo.
echo Server stopped. Press any key to close.
pause >nul
