@echo off
setlocal EnableDelayedExpansion
title JARVIS Panel - Kurulum
cd /d "%~dp0"

echo.
echo  ============================================================
echo     J A R V I S   K O M U T A   M E R K E Z I  -  KURULUM
echo  ============================================================
echo   - Node.js yoksa kurar (winget)
echo   - PostgreSQL GEREKMEZ: gomulu veritabani kullanilir
echo     (veriler: %APPDATA%\JARVIS\jarvis.db.tgz - her kurulumda ayni)
echo   - Paketleri kurar, paneli derler ve baslatir
echo  ============================================================
echo.

REM ---------- 1) Node.js ----------
where node >nul 2>nul
if errorlevel 1 (
  echo [1/4] Node.js bulunamadi, kuruluyor...
  where winget >nul 2>nul || (
    echo [HATA] winget yok. Node.js LTS'i elle kurun: https://nodejs.org
    pause & exit /b 1
  )
  winget install -e --id OpenJS.NodeJS.LTS --accept-package-agreements --accept-source-agreements --silent
  set "PATH=%ProgramFiles%\nodejs;%PATH%"
)
where node >nul 2>nul || (
  echo [HATA] Node.js kuruldu ama bu pencere gormuyor. Pencereyi kapatip PANEL_KUR.bat'i tekrar calistirin.
  pause & exit /b 1
)
for /f "delims=" %%v in ('node -v') do set "NODEV=%%v"
node -e "const [a,b]=process.versions.node.split('.').map(Number);process.exit(a>20||(a===20&&b>=9)?0:1)" || (
  echo [HATA] Node.js !NODEV! cok eski. En az v20.9 gerekli: https://nodejs.org ^(LTS^)
  pause & exit /b 1
)
echo [1/4] Node.js !NODEV! hazir

REM ---------- 2) Yerel veritabani ayari ----------
REM .env.local, .env dosyasindaki sunucu adresini gecersiz kilar
>.env.local echo DATABASE_URL=pglite:shared
if not exist data mkdir data
echo [2/4] Gomulu veritabani: %APPDATA%\JARVIS\jarvis.db.tgz ^(yeni klasore kurulsa da veriler korunur^)

REM ---------- 3) Paketler ve derleme ----------
echo [3/4] Paketler kuruluyor (ilk seferde birkac dakika)...
call npm install --no-audit --no-fund || (echo [HATA] npm install basarisiz & pause & exit /b 1)
echo       Panel derleniyor...
if exist .next rmdir /s /q .next
call npm run build || (echo [HATA] Derleme basarisiz - yukaridaki hatayi gonderin & pause & exit /b 1)
if exist VERSION copy /y VERSION .next\jarvis_built.txt >nul

REM ---------- 4) Baslat ----------
echo [4/4] Baslatiliyor...
call "%~dp0PANEL_BASLAT.bat"
