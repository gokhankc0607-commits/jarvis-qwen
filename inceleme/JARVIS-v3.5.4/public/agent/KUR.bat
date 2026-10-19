@echo off
chcp 65001 >nul
setlocal EnableDelayedExpansion
title JARVIS - Tek Tikla Kurulum
cd /d "%~dp0"

echo.
echo  ======================================================
echo     J A R V I S   -   TEK TIKLA KURULUM
echo  ======================================================
echo   Bu pencere her seyi otomatik yapar:
echo     1) Python 3.11 64-bit (yoksa kurar; diger surumlere dokunmaz)
echo     2) Inno Setup  (Setup.exe icin, yoksa kurar)
echo     3) Ollama + yerel model (istege bagli)
echo     4) JARVIS.exe ve JARVIS-Setup.exe derler
echo     5) Kurulumu baslatir
echo   Internet gerekir. Ilk seferde 10-20 dakika surebilir.
echo  ======================================================
echo.
pause

where winget >nul 2>nul || (
  echo [HATA] winget bulunamadi. Microsoft Store'dan "Uygulama Yukleyici / App Installer" kurun.
  pause & exit /b 1
)

REM ---------------- 1) Python ----------------
echo [1/5] Python 3.11 ^(64-bit^) kontrol ediliyor...
call "%~dp0find_python.bat" || (pause & exit /b 1)
set "PYEXE=%JPY%"

REM ---------------- 2) Inno Setup ----------------
if not exist "%ProgramFiles(x86)%\Inno Setup 6\ISCC.exe" (
  echo [2/5] Inno Setup kuruluyor ^(yonetici izni isteyebilir^)...
  winget install -e --id JRSoftware.InnoSetup --accept-package-agreements --accept-source-agreements --silent
)
if exist "%ProgramFiles(x86)%\Inno Setup 6\ISCC.exe" (echo [2/5] Inno Setup hazir) else (echo [2/5] Inno Setup yok - sadece tasinabilir JARVIS.exe uretilecek)

REM ---------------- 3) Ollama ----------------
where ollama >nul 2>nul
if errorlevel 1 if not exist "%LOCALAPPDATA%\Programs\Ollama\ollama.exe" (
  choice /c EH /m "[3/5] Yerel yapay zeka (Ollama) kurulsun mu? E=Evet H=Hayir"
  if !errorlevel! == 1 winget install -e --id Ollama.Ollama --accept-package-agreements --accept-source-agreements --silent
)
set "PATH=%LOCALAPPDATA%\Programs\Ollama;%PATH%"
where ollama >nul 2>nul && (
  choice /c 7FH /m "[3/5] Model indir: 7=qwen2.5-coder:7b (4.7GB, hizli)  F=qwen2.5-coder:14b (9GB, guclu)  H=atla"
  if !errorlevel! == 1 ( ollama pull qwen2.5-coder:7b & set "JMODEL=qwen2.5-coder:7b" )
  if !errorlevel! == 2 ( ollama pull qwen2.5-coder:14b & set "JMODEL=qwen2.5-coder:14b" )
)
if defined JMODEL if exist config.json (
  "!PYEXE!" -c "import json;p='config.json';c=json.load(open(p,encoding='utf-8'));c['llm']['model']='!JMODEL!';json.dump(c,open(p,'w',encoding='utf-8'),indent=2,ensure_ascii=False)"
)

REM ---------------- 4) Derleme ----------------
echo [4/5] JARVIS derleniyor...
set JARVIS_AUTO=1
call build_exe.bat
if not exist dist\JARVIS\JARVIS.exe (
  echo [HATA] Derleme basarisiz. Yukaridaki hata mesajini kontrol edin.
  pause & exit /b 1
)

REM ---------------- 5) Kurulum ----------------
echo.
if exist dist\JARVIS-Setup.exe (
  echo [5/5] Kurulum sihirbazi aciliyor: dist\JARVIS-Setup.exe
  start "" "dist\JARVIS-Setup.exe"
) else (
  echo [5/5] Tasinabilir surum baslatiliyor: dist\JARVIS\JARVIS.exe
  start "" /d "dist\JARVIS" "dist\JARVIS\JARVIS.exe"
)
echo.
echo  TAMAM! Bundan sonra JARVIS'i Baslat menusunden veya masaustu kisayolundan acabilirsiniz.
echo.
pause
