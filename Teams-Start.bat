@echo off
setlocal
chcp 65001 >nul
title Teams - local server (do not close this window)

cd /d "%~dp0teams" || goto :fail

if not exist "node_modules" (
  echo [1/3] Installing packages. First run only, takes a few minutes...
  call npm install || goto :fail
)

if not exist ".env.local" (
  echo [ERROR] .env.local not found.
  echo Copy .env.local.example to .env.local and fill in the Supabase URL and key.
  goto :fail
)

echo [2/3] Starting server...
start "" powershell -NoProfile -WindowStyle Hidden -Command "Start-Sleep 8; Start-Process 'http://localhost:3000'"

echo [3/3] Open http://localhost:3000 in your browser.
echo Keep this window OPEN. Closing it stops the server. Press Ctrl+C to stop.
echo.
call npm run dev
goto :done

:fail
echo.
echo *** FAILED - see the message above ***

:done
echo.
pause
