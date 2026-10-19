@echo off
setlocal
title JARVIS Komuta Merkezi
cd /d "%~dp0"

if not exist .next\BUILD_ID (
  echo Panel henuz derlenmemis. Once PANEL_KUR.bat calistiriliyor...
  call "%~dp0PANEL_KUR.bat"
  exit /b
)
set "BUILT="
set "WANT="
if exist .next\jarvis_built.txt set /p BUILT=<.next\jarvis_built.txt
if exist VERSION set /p WANT=<VERSION
if not "%BUILT%"=="%WANT%" (
  echo Panel guncellenmis ^(%BUILT% - %WANT%^). Yeniden derleniyor...
  call "%~dp0PANEL_KUR.bat"
  exit /b
)
if not exist .env.local (
  >.env.local echo DATABASE_URL=pglite:shared
)

REM 3000 portu doluysa uyar
netstat -ano | findstr /r /c:":3000 .*LISTENING" >nul && (
  echo [UYARI] 3000 portu kullanimda. Panel zaten acik olabilir: http://localhost:3000
  echo         Eski pencereyi kapatin veya devam etmek icin bir tusa basin.
  pause
)

echo.
echo  ============================================================
echo     PANEL HAZIR  -  tarayicida acin:  http://localhost:3000
echo.
echo     Giris:   demo@jarvis.local   /   jarvis123
echo     (veya "Hesap olustur" ile kendi hesabiniz)
echo.
echo     TELEFON: panelde  Ayarlar - Telefon (QR)  sayfasindan QR okutun
echo     (telefon ve bilgisayar ayni Wi-Fi aginda olmali)
echo.
echo     JARVIS.exe kurulum sihirbazinda Panel URL:
echo        http://localhost:3000
echo.
echo     Durdurmak icin bu pencerede CTRL+C
echo  ============================================================
echo.

start "" cmd /c "timeout /t 4 >nul & start http://localhost:3000"
call npm run start -- -p 3000
pause
