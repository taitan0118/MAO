@echo off
cd /d "%~dp0"
title MAO - Tao bo cai
where node >nul 2>nul
if errorlevel 1 (
  echo Can cai Node.js ban LTS truoc: https://nodejs.org
  pause
  exit /b
)
echo Dang tai thu vien va Electron, can Internet, mat vai phut...
call npm install
if errorlevel 1 (
  echo Tai thu vien that bai. Kiem tra Internet roi chay lai.
  pause
  exit /b
)
echo Dang tao bo cai...
call npm run bo-cai
if errorlevel 1 (
  echo Tao bo cai that bai. Chup man hinh loi gui lai nhe.
  pause
  exit /b
)
echo.
echo XONG! Bo cai MAO-Setup nam trong thu muc dist
start "" "%~dp0dist"
pause
