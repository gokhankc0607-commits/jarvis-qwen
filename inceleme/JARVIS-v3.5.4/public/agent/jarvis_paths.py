"""
jarvis_paths.py — JARVIS için merkezi yol çözümleme
===================================================

Tek kural: **ayarlar uygulamanın yanında, veriler ortak bir evde durur.**

  * ``config.json``  -> JARVIS.exe / jarvis_launcher.py'nin YANINDA.
                        (Kurulum paketi bu dosyayı asla ezmez.)
  * veri evi         -> 1) ``JARVIS_HOME`` ortam değişkeni
                        2) taşınabilir mod (yanında ``portable.txt``) -> <uygulama>/JARVIS-Data
                        3) Windows: %APPDATA%\\JARVIS   ·  diğerleri: ~/.jarvis
                        İçinde: logs/, backups/, kanal_setup_locks.json
                        (Windows'ta panelin veritabanı jarvis.db.tgz de aynı klasördedir.)

Böylece:
  * Setup.exe ile güncel kurulum yapılsın, taşınabilir sürüm USB'den çalıştırılsın
    ya da klasör taşınınsın -> ayarlar ve veriler korunur.
  * Kaldırma (uninstall) verileri silmez, yalnızca programı kaldırır.
"""
from __future__ import annotations

import os
import sys
from pathlib import Path

APP_NAME = "JARVIS"
CONFIG_NAME = "config.json"
PORTABLE_MARKER = "portable.txt"
PORTABLE_DATA_DIR = "JARVIS-Data"

#: Güncelleme / kurulum sırasında ASLA dokunulmayan dosya ve klasörler.
PRESERVE_NAMES = {
    CONFIG_NAME,
    "portable.txt",
    "jarvis.db.tgz",
    "jarvis.db.tgz.bak",
    "kanal_setup_locks.json",
}
PRESERVE_DIRS = {"logs", "backups", "voices", "models", "JARVIS-Data", ".update_backup", "data"}


def is_frozen() -> bool:
    """PyInstaller ile paketlenmiş (JARVIS.exe) olarak mı çalışıyoruz?"""
    return bool(getattr(sys, "frozen", False))


def app_dir() -> Path:
    """JARVIS.exe'nin (veya kaynak çalıştırmada jarvis_launcher.py'nin) klasörü."""
    if is_frozen():
        return Path(sys.executable).resolve().parent
    return Path(__file__).resolve().parent


def exe_path() -> Path:
    """Çalışan JARVIS.exe'nin kendisi (kaynak modda jarvis_launcher.py)."""
    if is_frozen():
        return Path(sys.executable).resolve()
    return Path(__file__).resolve().parent / "jarvis_launcher.py"


def is_portable(app: Path | None = None) -> bool:
    """Taşınabilir mod: yanında portable.txt olan (veya JARVIS_PORTABLE=1) kurulum."""
    if os.environ.get("JARVIS_PORTABLE", "").strip().lower() in ("1", "true", "yes", "on"):
        return True
    try:
        return ((app or app_dir()) / PORTABLE_MARKER).exists()
    except OSError:
        return False


def data_home(app: Path | None = None) -> Path:
    """Logların, yedeklerin ve KANAL kilit dosyasının durduğu ortak klasör."""
    env = os.environ.get("JARVIS_HOME", "").strip()
    if env:
        return Path(env).expanduser()
    app = app or app_dir()
    if is_portable(app):
        return app / PORTABLE_DATA_DIR
    appdata = os.environ.get("APPDATA")     # Windows ve WINE
    if os.name == "nt" or appdata:
        base = appdata or str(Path.home() / "AppData" / "Roaming")
        return Path(base) / APP_NAME
    return Path.home() / f".{APP_NAME.lower()}"


def config_path(app: Path | None = None) -> Path:
    """Ayar dosyasının YAZILACAĞI yer: her zaman uygulamanın yanı."""
    return (app or app_dir()) / CONFIG_NAME


def resolve_config(app: Path | None = None, home: Path | None = None) -> Path:
    """Ayar dosyasının OKUNACAĞI yer: uygulamanın yanı, yoksa veri evi (eski kurulumlar)."""
    p = config_path(app)
    if p.exists():
        return p
    alt = (home or data_home(app)) / CONFIG_NAME
    return alt if alt.exists() else p


def logs_dir(home: Path | None = None) -> Path:
    return (home or data_home()) / "logs"


def backup_dir(home: Path | None = None) -> Path:
    return (home or data_home()) / "backups"


def kanal_lock_file(home: Path | None = None) -> Path:
    return (home or data_home()) / "kanal_setup_locks.json"


def ensure_dirs(home: Path | None = None) -> Path:
    """Veri evini ve alt klasörlerini oluşturur (yazılamazsa uygulama klasörüne düşer)."""
    home = home or data_home()
    for d in (home, logs_dir(home), backup_dir(home)):
        try:
            d.mkdir(parents=True, exist_ok=True)
        except OSError:
            # son çare: uygulama klasörü (taşınabilir / salt-okunur APPDATA)
            home = app_dir() / PORTABLE_DATA_DIR
            for d2 in (home, logs_dir(home), backup_dir(home)):
                d2.mkdir(parents=True, exist_ok=True)
            break
    return home


def is_preserved(name: str) -> bool:
    """Bu dosya/klasör güncelleme ve kurulumda korunmalı mı?"""
    n = str(name).replace("\\", "/").lstrip("./")
    if n in PRESERVE_DIRS or n in PRESERVE_NAMES:
        return True
    return n.split("/")[0] in PRESERVE_DIRS


def describe() -> dict:
    """--selftest çıktısı ve loglar için yol özeti."""
    app, home = app_dir(), data_home()
    return {
        "frozen": is_frozen(),
        "portable": is_portable(app),
        "app_dir": str(app),
        "exe": str(exe_path()),
        "config": str(resolve_config(app, home)),
        "data_home": str(home),
        "logs": str(logs_dir(home)),
        "backups": str(backup_dir(home)),
    }
