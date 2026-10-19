@echo off
chcp 65001 >nul
setlocal
title JARVIS - .bat satir sonlarini duzelt
cd /d "%~dp0"

echo.
echo  ============================================================
echo     J A R V I S   -   .BAT SATIR SONU DUZELTME
echo  ============================================================
echo.
echo  SORUN: Windows cmd.exe, Unix satir sonlu (LF) .bat dosyalarinda
echo         her satirin ILK KARAKTERINI yutar. Boyle gorunur:
echo.
echo           'hcp' is not recognized ...      (chcp)
echo           'etlocal' is not recognized ...  (setlocal)
echo           'cho.' is not recognized ...     (echo.)
echo           'all' is not recognized ...      (call)
echo.
echo  COZUM: Tum .bat dosyalari CRLF + BOM'suz UTF-8 yapilir.
echo  ============================================================
echo.

py -3 build.py --fix-eol 2>nul
if not errorlevel 1 goto :done
python build.py --fix-eol 2>nul
if not errorlevel 1 goto :done

echo  [HATA] Python bulunamadi. Asagidaki satiri kopyalayip cmd'ye yapistirin:
echo.
echo  python -c "import pathlib;fs=list(pathlib.Path('.').rglob('*.bat'));[p.write_bytes(p.read_bytes().replace(b'\r\n',b'\n').replace(b'\n',b'\r\n')) for p in fs];print(len(fs),'dosya duzeltildi')"
echo.

:done
echo.
echo  Simdi build_exe.bat veya test_build.bat'i tekrar calistirin.
echo.
pause
