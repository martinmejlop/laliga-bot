@echo off
setlocal
cd /d "%~dp0"
node scripts\launch-panel.mjs
if errorlevel 1 echo No se pudo iniciar. Consulta README.md.
echo.
if errorlevel 1 pause
