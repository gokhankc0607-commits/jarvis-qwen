@echo off
setlocal
title JARVIS Masaustu (Electron)
cd /d "%~dp0"

REM --- Electron bagimliliklari bir kez kurulur ---
if not exist electron\node_modules\electron-store (
  echo Electron bagimliliklari kuruluyor...
  pushd electron
  call npm install --no-audit --no-fund
  popd
)

REM --- Node modulu eksikse (ilk kullanim) onarilir ---
if not exist node_modules\.bin\next.cmd (
  echo Panel bagimliliklari kuruluyor...
  call npm install --no-audit --no-fund
)

REM --- PANEL_KUR.bat mantigi: VERSION degistiyse yeniden derle ---
set "BUILT="
set "WANT="
if exist .next\jarvis_built.txt set /p BUILT=<.next\jarvis_built.txt
if exist VERSION set /p WANT=<VERSION
if not exist .next\BUILD_ID (
  echo Panel henuz derlenmemis. PANEL_KUR.bat calistiriliyor...
  call "%~dp0PANEL_KUR.bat"
) else if not "%BUILT%"=="%WANT%" (
  echo Panel guncellenmis ^(%BUILT% - %WANT%^). Yeniden derleniyor...
  call "%~dp0PANEL_KUR.bat"
)

if not exist .env.local (
  >.env.local echo DATABASE_URL=pglite:shared
)

echo.
echo  ============================================================
echo     JARVIS masaustu penceresi baslatiliyor...
echo     Giris:   demo@jarvis.local   /   jarvis123
echo     Durdurmak icin pencereyi kapatmaniz yeterlidir.
echo  ============================================================
echo.

REM --- Electron'u root node_modules'taki binary ile baslat ---
call "%~dp0node_modules\.bin\electron.cmd" "%~dp0electron"
pause
