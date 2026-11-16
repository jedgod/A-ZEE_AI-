@echo off
rem Starts AZee AI (the web app) if it is not already running, then opens it in your browser.
rem The desktop shortcut "AZee AI" runs this file. Close the minimized "AZee server" window to stop the app.
setlocal
set PORT=3001
set URL=http://localhost:%PORT%
cd /d "%~dp0..\.."

netstat -ano | findstr /R /C:":%PORT% .*LISTENING" >nul
if errorlevel 1 (
  start "AZee server" /min cmd /c "set PORT=%PORT%&& npm run dev:lan"
)

rem Wait (up to about 3 minutes; the first start compiles) until the page answers, then open it.
set /a tries=0
:wait
curl.exe -s -o nul -m 5 -w "%%{http_code}" %URL%/ | findstr /R /C:"^[23]" >nul
if not errorlevel 1 goto open
set /a tries+=1
if %tries% geq 60 goto open
timeout /t 3 /nobreak >nul
goto wait

:open
start "" %URL%
endlocal
