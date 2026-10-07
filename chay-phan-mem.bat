@echo off
cd /d "%~dp0"
title MAO - Phan mem goi mon QR
where node >nul 2>nul
if errorlevel 1 (
  echo Chua cai Node.js. Hay cai ban LTS tai https://nodejs.org roi chay lai file nay.
  pause
  exit /b
)
if not exist node_modules (
  echo Dang cai thu vien lan dau, can ket noi Internet...
  call npm install --omit=dev
  if errorlevel 1 (
    echo Cai thu vien that bai. Kiem tra Internet roi chay lai.
    pause
    exit /b
  )
)
start "" http://localhost:3000/
node server.js %*
pause
