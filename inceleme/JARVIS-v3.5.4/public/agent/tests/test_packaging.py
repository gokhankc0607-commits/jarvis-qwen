"""Paketleme testleri — Windows'ta derlemeyi bozan dosya biçimi hataları.

En önemlisi: **.bat dosyaları CRLF olmalı.**
Windows cmd.exe, LF (Unix) satır sonlu bir .bat dosyasında her satırın
İLK KARAKTERİNİ yer. Belirti konsolda şöyle görünür:

    'hcp' is not recognized as an internal or external command   (chcp)
    'etlocal' is not recognized ...                              (setlocal)
    'cho.' is not recognized ...                                 (echo.)
    'all' is not recognized ...                                  (call)

Bu testler o hatayı kalıcı olarak yakalar.
"""
from __future__ import annotations

import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

AGENT = Path(__file__).resolve().parent.parent
ROOT = next((p for p in [AGENT, *AGENT.parents[:3]]
             if (p / "VERSION").exists() and (p / "package.json").exists()), AGENT)
SKIP = {"node_modules", ".next", "__pycache__", ".git", "dist", "build", ".venv"}


def _bats():
    out = []
    for pat in ("*.bat", "*.cmd"):
        for p in sorted(ROOT.rglob(pat)):
            if any(part in SKIP for part in p.parts):
                continue
            out.append(p)
    return out


class TestBatLineEndings(unittest.TestCase):
    def test_bat_files_exist(self):
        self.assertGreaterEqual(len(_bats()), 5, "hiç .bat dosyası bulunamadı")

    def test_all_bat_use_crlf(self):
        """cmd.exe LF satır sonunda her satırın ilk karakterini yutar."""
        broken = []
        for p in _bats():
            body = p.read_bytes()
            if body.startswith(b"\xef\xbb\xbf"):
                body = body[3:]
            bare_lf = body.replace(b"\r\n", b"").count(b"\n")
            if bare_lf:
                broken.append(f"{p.relative_to(ROOT)} ({bare_lf} satır LF)")
        self.assertFalse(broken, "LF satır sonlu .bat dosyaları: " + ", ".join(broken))

    def test_no_utf8_bom(self):
        """BOM, ilk satırın ('@echo off') komut olarak tanınmasını bozar."""
        with_bom = [str(p.relative_to(ROOT)) for p in _bats()
                    if p.read_bytes().startswith(b"\xef\xbb\xbf")]
        self.assertFalse(with_bom, "UTF-8 BOM'lu dosyalar: " + ", ".join(with_bom))

    def test_bat_files_are_utf8(self):
        """Türkçe karakterler (ş ğ ı ö ç ü) bozulmadan okunabilmeli."""
        broken = []
        for p in _bats():
            try:
                p.read_bytes().decode("utf-8")
            except UnicodeDecodeError as e:
                broken.append(f"{p.name}: {e}")
        self.assertFalse(broken, "; ".join(broken))

    def test_build_scripts_reference_existing_files(self):
        """build_exe.bat / test_build.bat yalnızca var olan dosyaları çağırmalı."""
        for name in ("build_exe.bat", "test_build.bat", "KUR.bat", "CALISTIR.bat"):
            f = AGENT / name
            if not f.exists():
                continue
            text = f.read_text(encoding="utf-8", errors="ignore")
            for token in ("build.py", "find_python.bat", "jarvis_launcher.py"):
                if token in text:
                    self.assertTrue((AGENT / token).exists(),
                                    f"{name} '{token}' dosyasına başvuruyor ama yok")


if __name__ == "__main__":
    unittest.main(verbosity=2)
