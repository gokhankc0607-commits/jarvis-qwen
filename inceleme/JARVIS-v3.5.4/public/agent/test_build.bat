@echo off
chcp 65001 >nul
setlocal EnableDelayedExpansion
title JARVIS - Derleme ve Acilis Testi
cd /d "%~dp0"

echo.
echo  ===============================================
echo    J A R V I S  -  DERLEME VE ACILIS TESTI
echo  ===============================================
echo   Bu betik: (1) statik dogrulamalari, (2) birim testlerini,
echo   (3) tek EXE derlemesini, (4) tasinabilir paketi ve
echo   (5) gercek acilis testini (--version / --selftest) calistirir.
echo   Sure: ~3-8 dk (modeller hariç). Internet gerekir.
echo  ===============================================
echo.

where python >nul 2>nul || (
  echo [HATA] Python bulunamadi. Once KUR.bat calistirin.
  pause & exit /b 1
)

echo [1/5] Statik dogrulamalar + birim testleri
echo ---------------------------------------------------------------
python build.py --check
if errorlevel 1 (
  echo [HATA] Dogrulamalar basarisiz.
  pause & exit /b 1
)

echo.
echo [2/5] Tek dosya EXE derleniyor
echo ---------------------------------------------------------------
python build.py --onefile --no-models
if errorlevel 1 (
  echo [HATA] PyInstaller basarisiz.
  pause & exit /b 1
)

echo.
echo [3/5] Tasinabilir paket hazirlaniyor
echo ---------------------------------------------------------------
python build.py --portable
if errorlevel 1 (
  echo [HATA] Tasinabilir paket basarisiz.
  pause & exit /b 1
)

echo.
echo [4/5] Acilis testi (EXE gercekten calistiriliyor)
echo ---------------------------------------------------------------
python build.py --smoke
if errorlevel 1 (
  echo [HATA] Acilis testi basarisiz.
  pause & exit /b 1
)

echo.
echo [5/5] Panel guncelleme deposuna yayinlaniyor
echo ---------------------------------------------------------------
python build.py --publish

echo.
echo  ===============================================
echo    TUM TESTLER GECTI
echo  ===============================================
echo   dist\JARVIS-Portable\JARVIS.exe   - cift tikla, calisir
echo   dist\JARVIS-Portable-v*.zip       - USB'ye at, tasi
echo   agent-dist\JARVIS.exe             - panelden ajanlara dagitilir
echo.
pause
