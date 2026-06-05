@echo off
cd /d "%~dp0"
echo Hwatu Holdem server
echo URL: http://localhost:4173
echo.
node server.js
echo.
echo Server stopped.
pause
