@echo off
chcp 65001 >nul
setlocal EnableDelayedExpansion
title JARVIS Ajan
cd /d "%~dp0"

REM Kaynak koddan calistirir. Ajan her basladiginda panelden yeni surumu kendisi indirir (config.json'a dokunmaz).
if not exist .venv\Scripts\python.exe (
  echo [Ilk calistirma] Python ortami hazirlaniyor ^(birkac dakika^)...
  call "%~dp0find_python.bat" || (pause & exit /b 1)
  "%JPY%" -m venv .venv || (echo [HATA] venv olusturulamadi & pause & exit /b 1)
  call .venv\Scripts\activate.bat
  python -m pip install --upgrade pip wheel setuptools >nul
  pip install -r requirements.txt || (echo [HATA] paketler kurulamadi & pause & exit /b 1)
  pip install -r requirements-voice.txt || echo [UYARI] Ses paketleri kurulamadi - sessiz modda calisir
) else (
  call .venv\Scripts\activate.bat
)

python jarvis_launcher.py %*
echo.
echo Ajan kapandi. Hata varsa yukaridaki mesaji kontrol edin.
pause
