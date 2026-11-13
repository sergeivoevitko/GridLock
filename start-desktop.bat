@echo off
cd /d "%~dp0"
if not exist node_modules (
  echo First run: installing the desktop app, this takes a minute...
  call npm install
)
call npm run desktop
