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
if not exist node_modules\electron (
  echo First run: installing the desktop app. This takes a minute or two...
  call npm install
  if errorlevel 1 goto failed
)
rem Newer npm versions skip Electron's download step, so run it directly.
if not exist node_modules\electron\dist\electron.exe (
  echo Downloading the Electron app window. This takes a minute...
  node node_modules\electron\install.js
  if errorlevel 1 goto failed
)
call npm run desktop
if errorlevel 1 pause
exit /b 0

:failed
echo.
echo  Install failed. Check your internet connection and try again.
echo  If it keeps failing, delete the node_modules folder and run this file again.
pause
exit /b 1
