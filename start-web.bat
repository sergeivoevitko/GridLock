@echo off
title GridLock
cd /d "%~dp0"
where node >nul 2>nul
if errorlevel 1 (
  echo.
  echo  GridLock needs Node.js, and it was not found on this PC.
  echo.
  echo  1. Download the LTS version from https://nodejs.org and install it.
  echo  2. Close this window, then double-click this file again.
  echo     ^(If it still says this, restart your PC once.^)
  echo.
  start "" https://nodejs.org
  pause
  exit /b 1
)
node server.js --open
pause
