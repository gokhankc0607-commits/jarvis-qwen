#!/usr/bin/env python3
"""
build.py — JARVIS dağıtım derleyicisi
=====================================

Tek komutla üretir:

  * **JARVIS.exe**        -> tek dosya (onefile) veya klasör (onedir) PyInstaller çıktısı
  * **Taşınabilir sürüm** -> dist/JARVIS-Portable/  (+ .zip)  — USB'den çalışır, veriler yanında
  * **Kurulum (Setup.exe)**-> Inno Setup ile dist/JARVIS-Setup.exe
  * **Yayınlama**         -> <proje>/agent-dist/JARVIS.exe + manifest  (panel buradan güncelleme dağıtır)

Kullanım
--------
    python build.py --check              # her platformda: statik doğrulamalar + testler
    python build.py --all                # Windows: her şeyi derle, paketle, duman testi yap
    python build.py --onefile --portable # yalnızca tek EXE + taşınabilir zip
    python build.py --setup              # yalnızca Setup.exe (önce --onefile gerekir)
    python build.py --smoke              # derlenmiş EXE'yi açılış testine sokar
    python build.py --rollback           # son yedekten ayarları geri getirir

Seçenekler: --onefile --onedir --no-models --portable --setup --publish --smoke --zip
"""
from __future__ import annotations

import argparse
import compileall
import hashlib
import json
import os
import re
import shutil
import subprocess
import sys
import time
import zipfile
from pathlib import Path

HERE = Path(__file__).resolve().parent
APP_NAME = "JARVIS"
EXE_NAME = "JARVIS.exe"

#: Derlemeye girmeyecek / güncellemede korunacak klasörler
SKIP_DIRS = {"__pycache__", ".venv", "build", "dist", "logs", "backups", "JARVIS-Data",
             "voices", "models", ".git", ".update_backup", "node_modules"}
CORE_FILES = ["jarvis_launcher.py", "app.py", "mt5_engine.py", "mql5_compiler.py",
              "local_ai.py", "kanal_strategy.py", "crypto_engine.py",
              "jarvis_paths.py", "updater.py"]

ok = lambda m: print(f"  \033[92m✓\033[0m {m}")
bad = lambda m: print(f"  \033[91m✗\033[0m {m}")
info = lambda m: print(f"  · {m}")
head = lambda m: print(f"\n\033[96m{m}\033[0m")


# --------------------------------------------------------------------------- #
def project_root() -> Path:
    """public/agent içindeysek bir üstteki proje kökünü bul (VERSION + package.json)."""
    for p in [HERE, *HERE.parents[:3]]:
        if (p / "VERSION").exists() and (p / "package.json").exists():
            return p
    return HERE


def read_version(root: Path) -> str:
    v = (root / "VERSION").read_text(encoding="utf-8").strip() if (root / "VERSION").exists() else ""
    return v or "0.0.0"


def iter_py(root: Path = HERE):
    for p in sorted(root.rglob("*.py")):
        if any(part in SKIP_DIRS for part in p.parts):
            continue
        yield p


# --------------------------------------------------------------------------- #
# Sürüm senkronizasyonu
# --------------------------------------------------------------------------- #
def write_version_files(root: Path, version: str) -> list[str]:
    """version.txt (ajan) ve version_info.txt (EXE imzası) üretir."""
    written = []
    vt = HERE / "version.txt"
    if not vt.exists() or vt.read_text(encoding="utf-8").strip() != version:
        vt.write_text(version + "\n", encoding="utf-8")
        written.append(str(vt))

    parts = [int(x) for x in re.findall(r"\d+", version)[:4]]
    while len(parts) < 4:
        parts.append(0)
    vi = HERE / "version_info.txt"
    txt = f"""# -*- coding: utf-8 -*-
# OTOMATIK URETILDI (build.py) — elle düzenlemeyin. Sürüm: {version}
VSVersionInfo(
  ffi=FixedFileInfo(filevers={tuple(parts)}, prodvers={tuple(parts)}, mask=0x3f, flags=0x0, OS=0x40004,
                    fileType=0x1, subtype=0x0, date=(0, 0)),
  kids=[
    StringFileInfo([StringTable('041F04B0', [
      StringStruct('CompanyName', 'JARVIS'),
      StringStruct('FileDescription', 'JARVIS - MT5 / MQL5 Yerel AI Ajani'),
      StringStruct('FileVersion', '{version}'),
      StringStruct('InternalName', 'JARVIS'),
      StringStruct('OriginalFilename', 'JARVIS.exe'),
      StringStruct('ProductName', 'JARVIS'),
      StringStruct('ProductVersion', '{version}')])]),
    VarFileInfo([VarStruct('Translation', [1055, 1200])])
  ]
)
"""
    if not vi.exists() or "Sürüm: " + version not in vi.read_text(encoding="utf-8", errors="ignore"):
        vi.write_text(txt, encoding="utf-8")
        written.append(str(vi))
    return written


def check_versions(root: Path, version: str) -> bool:
    """VERSION <> app.py <> panel version.ts uyumu."""
    good = True
    checks = [
        (HERE / "app.py", rf'^AGENT_VERSION\s*=\s*["\']{re.escape(version)}["\']'),
        (root / "src" / "lib" / "version.ts", rf'LATEST_AGENT\s*=\s*"{re.escape(version)}"'),
        (root / "src" / "lib" / "version.ts", rf'PANEL_VERSION\s*=\s*"{re.escape(version)}"'),
    ]
    for f, pat in checks:
        if not f.exists():
            bad(f"yok: {f.name}")
            good = False
            continue
        if re.search(pat, f.read_text(encoding="utf-8"), re.M):
            ok(f"sürüm eşleşiyor: {f.relative_to(root)} ({version})")
        else:
            bad(f"sürüm UYUŞMUYOR: {f.relative_to(root)} (beklenen {version})")
            good = False
    return good


# --------------------------------------------------------------------------- #
# Statik doğrulamalar
# --------------------------------------------------------------------------- #
def bat_files(root: Path) -> list[Path]:
    out: list[Path] = []
    for pat in ("*.bat", "*.cmd"):
        for p in sorted(root.rglob(pat)):
            if any(part in SKIP_DIRS for part in p.parts):
                continue
            out.append(p)
    return out


def fix_eol(root: Path) -> int:
    """Windows cmd.exe, **LF (Unix) satır sonlu** .bat dosyalarında her satırın
    İLK KARAKTERİNİ yer. Belirti: 'hcp' / 'etlocal' / 'cho.' / 'all' hataları
    ('command is not recognized'). Tüm .bat dosyalarını CRLF + BOM'suz yapar."""
    fixed = 0
    for p in bat_files(root):
        raw = p.read_bytes()
        b = raw[3:] if raw.startswith(b"\xef\xbb\xbf") else raw
        nb = b.replace(b"\r\n", b"\n").replace(b"\n", b"\r\n")
        if nb != raw:
            p.write_bytes(nb)
            fixed += 1
            bad(f"düzeltildi (LF → CRLF): {p.relative_to(root)}")
    if fixed:
        ok(f"{fixed} dosya CRLF'ye çevrildi")
    else:
        ok(f"{len(bat_files(root))} .bat dosyası zaten CRLF")
    return fixed


def check_eol(root: Path) -> bool:
    """.bat dosyaları CRLF mi, BOM'suz mu, UTF-8 mi? (cmd.exe ilk karakteri yutar)"""
    bad_files, bom_files = [], []
    for p in bat_files(root):
        b = p.read_bytes()
        if b.startswith(b"\xef\xbb\xbf"):
            bom_files.append(p)
        body = b[3:] if b.startswith(b"\xef\xbb\xbf") else b
        bare_lf = body.replace(b"\r\n", b"").count(b"\n")
        if bare_lf:
            bad_files.append((p, bare_lf))
    if bad_files:
        for p, n in bad_files:
            bad(f"LF satır sonu: {p.relative_to(root)} ({n} satır) — cmd.exe ilk karakteri YUTAR")
        bad("düzeltmek için: python build.py --fix-eol   (veya SATIR_SONU_DUZELT.bat)")
        return False
    if bom_files:
        for p in bom_files:
            bad(f"UTF-8 BOM var: {p.relative_to(root)}")
        return False
    ok(f"{len(bat_files(root))} .bat dosyası: CRLF ✔ BOM yok ✔")
    return True


def run_checks(root: Path, version: str, run_tests: bool = True) -> bool:
    head(f"[check] JARVIS {version} — doğrulamalar")
    good = True

    # 1) Python dosyaları derlenebilir mi
    import py_compile
    failures = []
    for p in iter_py():
        try:
            py_compile.compile(str(p), doraise=True, cfile=str(p) + "c")
            Path(str(p) + "c").unlink(missing_ok=True)
        except Exception as e:  # noqa: BLE001
            failures.append(f"{p.name}: {e}")
    if failures:
        bad(f"Python derleme hatası ({len(failures)})")
        for f in failures[:10]:
            info(f)
        good = False
    else:
        ok(f"{sum(1 for _ in iter_py())} Python dosyası derlendi")

    # 2) Gerekli dosyalar
    for f in CORE_FILES + ["requirements.txt", "jarvis.spec", "jarvis_onefile.spec", "installer.iss"]:
        if (HERE / f).exists():
            pass
        else:
            bad(f"eksik dosya: {f}")
            good = False
    if all((HERE / f).exists() for f in CORE_FILES):
        ok("çekirdek dosyalar yerinde")

    # 2b) Simge dosyaları — YOKSA PyInstaller ve Inno Setup DERLEMESİ DURUR
    for f, why in (("jarvis.ico", "EXE + Setup.exe simgesi (PyInstaller icon= / SetupIconFile=)"),
                   ("jarvis_icon.png", "paneldeki Yerel Ajan sayfası (/agent/jarvis_icon.png)")):
        p = HERE / f
        if p.exists() and p.stat().st_size > 100:
            ok(f"{f} ({p.stat().st_size} bayt) — {why}")
        else:
            bad(f"EKSİK/BOZUK: {f} — {why}")
            good = False

    # 3) .bat satır sonları (cmd.exe LF'de ilk karakteri yutar)
    good &= check_eol(root)

    # 4) Sürüm uyumu
    good &= check_versions(root, version)

    # 5) Panel tarafı: güncelleme uçları
    for rel in ("src/app/api/agent/manifest/route.ts", "src/app/api/agent/exe/route.ts",
                "src/app/api/agent/exe-manifest/route.ts"):
        if (root / rel).exists():
            ok(f"panel ucu: {rel}")
        elif root == HERE:
            info(f"panel yok (yalnızca ajan paketi): {rel}")
        else:
            bad(f"panel ucu eksik: {rel}")
            good = False

    # 6) Birim testleri
    if run_tests:
        r = subprocess.run([sys.executable, str(HERE / "tests" / "run_tests.py")],
                           cwd=str(HERE), capture_output=True, text=True)
        tail_lines = (r.stdout or "").strip().splitlines()[-3:]
        if r.returncode == 0:
            ok("birim testleri geçti — " + " | ".join(t.strip() for t in tail_lines))
        else:
            bad("birim testleri BAŞARISIZ")
            print((r.stdout or "")[-2500:], (r.stderr or "")[-1500:])
            good = False

    print(f"\n{'✔ TÜM DOĞRULAMALAR GEÇTİ' if good else '✖ DOĞRULAMALAR BAŞARISIZ'}\n")
    return good


# --------------------------------------------------------------------------- #
# PyInstaller
# --------------------------------------------------------------------------- #
def run_pyinstaller(onefile: bool) -> bool:
    spec = "jarvis_onefile.spec" if onefile else "jarvis.spec"
    head(f"[build] PyInstaller — {spec} ({'tek dosya' if onefile else 'klasör'})")
    cmd = [sys.executable, "-m", "PyInstaller", "--noconfirm", "--clean", spec]
    r = subprocess.run(cmd, cwd=str(HERE))
    if r.returncode != 0:
        bad("PyInstaller başarısız")
        return False
    exe = HERE / "dist" / EXE_NAME if onefile else HERE / "dist" / APP_NAME / EXE_NAME
    if exe.exists():
        ok(f"{exe} ({exe.stat().st_size / 1e6:.1f} MB)")
        return True
    bad(f"beklenen çıktı yok: {exe}")
    return False


def copy_side_files(dest: Path, version: str) -> None:
    """config.example.json, README, sürüm dosyası, taşınabilir işareti."""
    dest.mkdir(parents=True, exist_ok=True)
    for name in ("config.example.json", "README.md", "version.txt"):
        src = HERE / name
        if src.exists():
            shutil.copy2(src, dest / name)
    if (HERE / "jarvis.ico").exists():
        shutil.copy2(HERE / "jarvis.ico", dest / "jarvis.ico")
    (dest / "version.txt").write_text(version + "\n", encoding="utf-8")


def make_portable(version: str, zip_it: bool = True) -> Path:
    """Tek EXE + taşınabilir işaret + veri klasörü."""
    head("[portable] Taşınabilir sürüm")
    src = HERE / "dist" / EXE_NAME
    if not src.exists():
        raise SystemExit("Önce --onefile ile derleyin (dist/JARVIS.exe yok)")
    dest = HERE / "dist" / "JARVIS-Portable"
    if dest.exists():
        shutil.rmtree(dest, ignore_errors=True)
    dest.mkdir(parents=True)
    shutil.copy2(src, dest / EXE_NAME)
    copy_side_files(dest, version)
    (dest / "portable.txt").write_text(
        "Bu bir TAŞINABİLİR kurulumdur.\n"
        "Ayarlar config.json dosyasında, veriler JARVIS-Data/ klasöründe tutulur.\n"
        "Klasörü USB belleğe kopyalayıp başka bilgisayarda da aynı şekilde çalıştırabilirsiniz.\n"
        "Silmek için klasörü silmeniz yeterlidir — bilgisayarda kayıt/veri bırakmaz.\n",
        encoding="utf-8",
    )
    (dest / "JARVIS-Data").mkdir(exist_ok=True)
    (dest / "JARVIS-Data" / ".gitkeep").write_text("", encoding="utf-8")
    for sub in ("voices", "models"):
        s = HERE / sub
        if s.is_dir() and any(s.iterdir()):
            shutil.copytree(s, dest / sub, dirs_exist_ok=True)
            ok(f"{sub}/ kopyalandı")
    ok(f"taşınabilir klasör: {dest}")
    if zip_it:
        zp = HERE / "dist" / f"JARVIS-Portable-v{version}.zip"
        with zipfile.ZipFile(zp, "w", zipfile.ZIP_DEFLATED, compresslevel=6) as z:
            for p in sorted(dest.rglob("*")):
                if p.is_file():
                    z.write(p, p.relative_to(dest))
        ok(f"taşınabilir zip: {zp} ({zp.stat().st_size / 1e6:.1f} MB)")
    return dest


# --------------------------------------------------------------------------- #
# Inno Setup
# --------------------------------------------------------------------------- #
def find_iscc() -> Path | None:
    import shutil as sh
    for c in (r"C:\Program Files (x86)\Inno Setup 6\ISCC.exe",
              r"C:\Program Files\Inno Setup 6\ISCC.exe"):
        if Path(c).exists():
            return Path(c)
    w = sh.which("ISCC") or sh.which("iscc")
    return Path(w) if w else None


def run_innosetup() -> bool:
    head("[setup] Inno Setup")
    iscc = find_iscc()
    if not iscc:
        bad("Inno Setup 6 bulunamadı — https://jrsoftware.org/isdl.php")
        return False
    r = subprocess.run([str(iscc), "/Q", str(HERE / "installer.iss")], cwd=str(HERE))
    out = HERE / "dist" / "JARVIS-Setup.exe"
    if r.returncode == 0 and out.exists():
        ok(f"{out} ({out.stat().st_size / 1e6:.1f} MB)")
        return True
    bad("Inno Setup başarısız")
    return False


# --------------------------------------------------------------------------- #
# Yayınlama: panelin güncelleme olarak dağıtacağı EXE
# --------------------------------------------------------------------------- #
def publish(root: Path, version: str) -> Path | None:
    """dist/JARVIS.exe -> <proje>/agent-dist/JARVIS.exe + JARVIS.exe.json"""
    head("[publish] Panel güncelleme deposu")
    portable_exe = HERE / "dist" / "JARVIS-Portable" / EXE_NAME
    src = portable_exe if portable_exe.exists() else (HERE / "dist" / EXE_NAME)
    if not src.exists():
        bad("yayınlanacak EXE yok (önce --onefile)")
        return None
    dest_dir = root / "agent-dist"
    dest_dir.mkdir(parents=True, exist_ok=True)
    dest = dest_dir / EXE_NAME
    shutil.copy2(src, dest)
    data = dest.read_bytes()
    meta = {
        "version": version,
        "size": len(data),
        "sha256": hashlib.sha256(data).hexdigest(),
        "builtAt": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
        "python": f"{sys.version_info.major}.{sys.version_info.minor}",
        "platform": sys.platform,
    }
    (dest_dir / "JARVIS.exe.json").write_text(json.dumps(meta, ensure_ascii=False, indent=2), encoding="utf-8")
    ok(f"{dest} ({len(data) / 1e6:.1f} MB) · sha256 {meta['sha256'][:16]}…")
    ok(f"{dest_dir / 'JARVIS.exe.json'}")
    if root == HERE:
        info("NOT: bu klasör tek başına bir ajan paketi (yanında panel projesi yok).")
        info(f"     Panelin EXE'yi dağıtabilmesi için '{dest_dir.name}\\' klasörünü")
        info("     panel projesinin köküne (VERSION dosyasının yanına) kopyalayın.")
    else:
        info("Ajanlar artık panelden kendilerini bu EXE ile güncelleyecek.")
    return dest


# --------------------------------------------------------------------------- #
# Duman testi
# --------------------------------------------------------------------------- #
def smoke(exe: Path | None = None) -> bool:
    """Derlenmiş EXE'yi gerçekten çalıştırır: --version ve --selftest."""
    head("[smoke] Açılış testi")
    exe = exe or (HERE / "dist" / "JARVIS-Portable" / EXE_NAME)
    if not exe.exists():
        exe = HERE / "dist" / EXE_NAME
    if not exe.exists():
        bad(f"EXE yok: {exe}")
        return False
    env = {**os.environ, "JARVIS_PORTABLE": "1", "JARVIS_NO_UPDATE": "1"}
    for arg, label in (("--version", "sürüm"), ("--selftest", "kendi kendini test")):
        try:
            r = subprocess.run([str(exe), arg], capture_output=True, text=True, timeout=240, env=env)
        except subprocess.TimeoutExpired:
            bad(f"{arg} zaman aşımı")
            return False
        print(f"--- {exe.name} {arg} ---")
        print((r.stdout or "").strip()[:2000])
        if r.returncode != 0:
            bad(f"{label} başarısız (çıkış kodu {r.returncode})")
            print((r.stderr or "").strip()[:2000])
            return False
        ok(f"{label} tamam")
    return True


def zip_dist(version: str) -> Path:
    head("[zip] Dağıtım arşivi")
    zp = HERE / "dist" / f"JARVIS-Windows-v{version}.zip"
    with zipfile.ZipFile(zp, "w", zipfile.ZIP_DEFLATED, compresslevel=6) as z:
        for name in ("JARVIS-Setup.exe", EXE_NAME):
            p = HERE / "dist" / name
            if p.exists():
                z.write(p, name)
        pd = HERE / "dist" / "JARVIS-Portable"
        if pd.is_dir():
            for p in sorted(pd.rglob("*")):
                if p.is_file():
                    z.write(p, str(Path("JARVIS-Portable") / p.relative_to(pd)))
    ok(f"{zp} ({zp.stat().st_size / 1e6:.1f} MB)")
    return zp


# --------------------------------------------------------------------------- #
def main() -> int:
    root = project_root()
    version = read_version(root)
    ap = argparse.ArgumentParser(description="JARVIS dağıtım derleyicisi")
    ap.add_argument("--all", action="store_true", help="check + onefile + portable + setup + publish + smoke")
    ap.add_argument("--check", action="store_true", help="statik doğrulamalar ve testler")
    ap.add_argument("--onefile", action="store_true", help="tek dosya EXE")
    ap.add_argument("--onedir", action="store_true", help="klasör (hızlı açılan) EXE")
    ap.add_argument("--portable", action="store_true", help="taşınabilir klasör + zip")
    ap.add_argument("--setup", action="store_true", help="Inno Setup ile Setup.exe")
    ap.add_argument("--publish", action="store_true", help="panelin güncelleme deposuna kopyala")
    ap.add_argument("--smoke", action="store_true", help="derlenmiş EXE ile açılış testi")
    ap.add_argument("--zip", action="store_true", help="dağıtım arşivi")
    ap.add_argument("--no-models", action="store_true", help="ses/whisper modellerini indirme")
    ap.add_argument("--no-tests", action="store_true", help="--check içinde testleri atla")
    ap.add_argument("--rollback", action="store_true", help="son yedekten ayarları geri yükle")
    ap.add_argument("--fix-eol", action="store_true",
                    help=".bat dosyalarını CRLF yapar (cmd.exe LF'de ilk karakteri yutar)")
    a = ap.parse_args()

    if a.fix_eol:
        head("[fix-eol] .bat satır sonları")
        fix_eol(project_root())
        return 0

    if a.rollback:
        import jarvis_paths as P
        import updater
        return 0 if updater.rollback(P.app_dir(), P.data_home(), logger=print) else 1

    if not any(vars(a).values()):
        a.all = True

    for f in write_version_files(root, version):
        ok(f"yazıldı: {Path(f).name} ({version})")

    if a.check or a.all:
        if not run_checks(root, version, run_tests=not a.no_tests):
            return 1

    built = False
    if a.onefile or a.all:
        built = run_pyinstaller(True) or built
    if a.onedir:
        built = run_pyinstaller(False) or built

    if a.portable or a.all:
        if not (HERE / "dist" / EXE_NAME).exists() and not run_pyinstaller(True):
            return 1
        make_portable(version, zip_it=True)

    if a.setup or a.all:
        run_innosetup()

    if a.publish or a.all:
        publish(root, version)

    if a.smoke or a.all:
        if not smoke():
            return 1

    if a.zip or a.all:
        zip_dist(version)

    head("TAMAMLANDI")
    for p in ("dist/" + EXE_NAME, "dist/JARVIS-Portable", "dist/JARVIS-Setup.exe"):
        fp = HERE / p
        if fp.exists():
            info(str(fp))
    return 0


if __name__ == "__main__":
    sys.exit(main())
