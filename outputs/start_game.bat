@echo off
setlocal

cd /d "%~dp0"

where node >nul 2>nul
if errorlevel 1 (
  echo Node.js was not found.
  echo Install Node.js, then run this file again.
  pause
  exit /b 1
)

echo Starting server...
start "Hwatu Holdem Server" "%~dp0start_server.bat"

timeout /t 2 /nobreak >nul

echo Opening client...
call "%~dp0start_client.bat"

echo.
echo Close the server window to stop the game server.
echo Other players can connect to: http://YOUR-PC-IP:4173
pause
