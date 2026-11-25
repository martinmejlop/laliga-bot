@echo off
setlocal
cd /d "%~dp0"
node src\cli.ts doctor --probe
if errorlevel 1 echo La comprobacion no termino correctamente. Abre Ollama y consulta README.md.
echo.
pause
