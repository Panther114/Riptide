@echo off
rem Riptide quick launcher: frees the dev port, then starts the Vite dev server
rem and opens the game in your default browser.
rem   quickrun.bat          start + open browser
rem   quickrun.bat noopen   start without opening a browser
setlocal
set PORT=47823
cd /d "%~dp0"

echo Freeing port %PORT%...
for /f "tokens=5" %%P in ('netstat -ano ^| findstr /R /C:":%PORT% .*LISTENING"') do (
  if not "%%P"=="0" (
    taskkill /F /T /PID %%P >nul 2>&1 && echo   stopped PID %%P
  )
)

if not exist node_modules (
  echo Installing dependencies...
  call npm install || goto :fail
)

set OPEN=--open
if /i "%~1"=="noopen" set OPEN=

echo Starting Riptide at http://localhost:%PORT%/  ^(Ctrl+C to stop^)
call npm run dev -- --port %PORT% --strictPort %OPEN%
goto :eof

:fail
echo Failed to install dependencies.
pause
exit /b 1
