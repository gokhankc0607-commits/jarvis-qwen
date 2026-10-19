@echo off
chcp 65001 >nul
setlocal EnableDelayedExpansion
title JARVIS - EXE Derleyici
cd /d "%~dp0"

echo.
echo  ===============================================
echo    J A R V I S   -   Windows EXE derleyici
echo  ===============================================
echo.

echo [1/6] Python kontrol ediliyor...
call "%~dp0find_python.bat" || (pause & exit /b 1)

REM Eski / yanlis surumle olusturulmus sanal ortami temizle
if exist .venv\Scripts\python.exe (
  .venv\Scripts\python.exe -c "import sys,struct;sys.exit(0 if sys.version_info[:2] in ((3,10),(3,11),(3,12)) and struct.calcsize('P')==8 else 1)" 2>nul || (
    echo      Eski sanal ortam uyumsuz Python ile olusturulmus, siliniyor...
    rmdir /s /q .venv
  )
)
if exist .venv if not exist .venv\Scripts\python.exe rmdir /s /q .venv
if not exist .venv (
  echo      Sanal ortam olusturuluyor...
  "%JPY%" -m venv .venv || (echo [HATA] venv olusturulamadi & pause & exit /b 1)
)
call .venv\Scripts\activate.bat

echo [2/6] Bagimliliklar kuruluyor (ilk seferde birkac dakika surer)...
python -m pip install --upgrade pip wheel setuptools >nul
pip install -r requirements.txt "pyinstaller>=6.10,<7" || (
  echo.
  echo [HATA] Cekirdek paketler kurulamadi. Internet baglantinizi kontrol edin.
  echo        Sorun devam ederse .venv klasorunu silip tekrar deneyin.
  pause & exit /b 1
)
echo      Ses paketleri kuruluyor (faster-whisper, piper)...
pip install -r requirements-voice.txt || (
  echo [UYARI] Ses paketleri kurulamadi - JARVIS sessiz modda / Windows sesiyle calisacak.
)

echo [3/6] Onceki derleme temizleniyor...
if exist build rmdir /s /q build
if exist dist rmdir /s /q dist

echo [4/6] Modeller (ses + Whisper) hazirlaniyor...
if /I "%~1"=="--no-models" goto :skipmodels
if not exist voices mkdir voices
if not exist voices\tr_TR-dfki-medium.onnx (
  echo      - Piper Turkce ses (tr_TR-dfki-medium) indiriliyor...
  set PV=https://huggingface.co/rhasspy/piper-voices/resolve/main/tr/tr_TR/dfki/medium
  curl -L -s -o voices\tr_TR-dfki-medium.onnx %PV%/tr_TR-dfki-medium.onnx
  curl -L -s -o voices\tr_TR-dfki-medium.onnx.json %PV%/tr_TR-dfki-medium.onnx.json
)
if not exist models\whisper-small (
  echo      - faster-whisper "small" modeli indiriliyor (cevrimdisi kullanim icin)...
  python -c "from faster_whisper import download_model; download_model('small', output_dir='models/whisper-small')" 2>nul || echo [UYARI] Whisper modeli indirilemedi, ilk kullanımda indirilir.
)
:skipmodels

echo [5/6] JARVIS.exe derleniyor, paketleniyor ve test ediliyor...
python build.py --onefile --portable --setup --publish --smoke --zip
if errorlevel 1 (
  echo.
  echo [HATA] Derleme basarisiz. Yukaridaki ciktiyi kontrol edin.
  pause & exit /b 1
)

echo.
echo [6/6] TAMAMLANDI
echo.
echo    Tek EXE       : dist\JARVIS-Portable\JARVIS.exe
echo    Tasinabilir   : dist\JARVIS-Portable-v*.zip
if exist dist\JARVIS-Setup.exe echo    Kurulum       : dist\JARVIS-Setup.exe
echo.
echo  Ilk calistirmada kurulum sihirbazi acilir. Yeniden acmak icin: JARVIS.exe --setup
echo  Kendi kendini test: JARVIS.exe --selftest     Ayarlari geri al: JARVIS.exe --rollback
echo.
if not "%JARVIS_AUTO%"=="1" pause
