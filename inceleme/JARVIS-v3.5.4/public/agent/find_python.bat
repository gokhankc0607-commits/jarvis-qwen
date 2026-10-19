@echo off
REM ------------------------------------------------------------------
REM  JARVIS icin uygun Python'u bulur: 64-bit, surum 3.10 / 3.11 / 3.12
REM  (MetaTrader5 + faster-whisper + PyInstaller ile uyumlu)
REM  Yoksa winget ile Python 3.11 (x64) kurar. Sonuc: JPY degiskeni.
REM ------------------------------------------------------------------
set "JPY="
REM Yeni "Python install manager" (py) eksik surumu sormadan kurmaya calismasin
set "PYTHON_MANAGER_AUTOMATIC_INSTALL=false"

REM 1) py launcher ile ara
for %%V in (3.11 3.12 3.10) do (
  if not defined JPY (
    for /f "delims=" %%P in ('py -%%V-64 -c "import sys;print(sys.executable)" 2^>nul ^<nul') do set "JPY=%%P"
  )
)

REM 2) Bilinen kurulum klasorleri
for %%D in (Python311 Python312 Python310) do (
  if not defined JPY if exist "%LOCALAPPDATA%\Programs\Python\%%D\python.exe" set "JPY=%LOCALAPPDATA%\Programs\Python\%%D\python.exe"
  if not defined JPY if exist "%ProgramFiles%\%%D\python.exe" set "JPY=%ProgramFiles%\%%D\python.exe"
  if not defined JPY if exist "%ProgramFiles%\Python\%%D\python.exe" set "JPY=%ProgramFiles%\Python\%%D\python.exe"
)

REM 3) Bulunani dogrula (surum + 64-bit)
if defined JPY (
  "%JPY%" -c "import sys,struct;sys.exit(0 if sys.version_info[:2] in ((3,10),(3,11),(3,12)) and struct.calcsize('P')==8 else 1)" 2>nul || set "JPY="
)

REM 4) Yoksa kur
if not defined JPY (
  echo.
  echo  [Python] Uygun surum bulunamadi. MetaTrader5 icin 64-bit Python 3.11 kuruluyor...
  echo           ^(Bilgisayardaki diger Python surumlerine dokunulmaz^)
  where winget >nul 2>nul || (
    echo  [HATA] winget yok. Python 3.11 64-bit'i elle kurun:
    echo         https://www.python.org/ftp/python/3.11.9/python-3.11.9-amd64.exe
    exit /b 1
  )
  winget install -e --id Python.Python.3.11 --scope user --architecture x64 --accept-package-agreements --accept-source-agreements --silent
  if exist "%LOCALAPPDATA%\Programs\Python\Python311\python.exe" set "JPY=%LOCALAPPDATA%\Programs\Python\Python311\python.exe"
)

if not defined JPY (
  echo  [HATA] Python 3.11 kurulamadi. Elle kurun ^(64-bit^):
  echo         https://www.python.org/ftp/python/3.11.9/python-3.11.9-amd64.exe
  exit /b 1
)
for /f "delims=" %%v in ('call "%JPY%" -c "import sys;print(sys.version.split()[0])"') do echo  [Python] Kullanilan: %JPY%  - surum %%v, 64-bit
exit /b 0
