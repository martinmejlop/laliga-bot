@echo off
setlocal
cd /d "%~dp0"
node scripts\launch-panel.mjs --stop
if errorlevel 1 pause
