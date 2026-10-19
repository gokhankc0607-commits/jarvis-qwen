"""
updater.py — JARVIS uygulama içi güncelleyici
=============================================

Panel (Next.js) tüm ajan dosyalarının SHA-256 özetini ``/api/agent/manifest``
adresinde yayınlar. Bu modül:

  1. Panelden manifesti çeker, hangi dosyaların değiştiğini bulur.
  2. Değişen dosyaları indirir, özetini doğrular, **atomik** olarak yerine koyar
     (``.new`` -> ``os.replace``), değişiklikten önce yedek alır.
  3. Panelde derlenmiş bir ``JARVIS.exe`` varsa (``/api/agent/exe-manifest``)
     sürümü karşılaştırır, indirir ve **çalışan .exe'yi kendisiyle değiştirir**
     (Windows'ta çalışan dosya silinemez ama YENİDEN ADLANDIRILABİLİR).
  4. Gerekirse yeniden başlatır.

Korunanlar (ASLA güncellenmez / silinmez)
-----------------------------------------
``config.json`` (ayarlar) · ``portable.txt`` · ``logs/`` · ``backups/`` ·
``voices/`` · ``models/`` · ``JARVIS-Data/`` · ``kanal_setup_locks.json`` ·
``jarvis.db.tgz`` (panel veritabanı)

Güvenlik
--------
* Yalnızca paneldeki izinli dosya listesi (``SAFE_FILE``) indirilir — yol geçişi yok.
* İndirilen her dosyanın SHA-256'sı manifestle karşılaştırılır; uyuşmazsa
  hiçbir dosyaya yazılmaz (yarım güncelleme olmaz).
* EXE değişimi yalnızca sürüm YÜKSEKSE ve özet doğruysa yapılır.
* Yeniden başlatma döngüsünü önlemek için nesil sayacı (en fazla 2).
"""
from __future__ import annotations

import hashlib
import json
import os
import re
import shutil
import subprocess
import sys
import time
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any, Callable, Iterable

import jarvis_paths as P

#: Panelin otomatik güncellemek için izin verdiği dosyalar (agentFiles.ts ile AYNI olmalı).
SAFE_FILE = re.compile(
    r"^(?:[\w-]+\.py|mql5/[\w.-]+\.mq5|requirements(?:-voice)?\.txt|config\.example\.json|README\.md)$"
)

EXE_NAME = "JARVIS.exe"
RESTART_ENV = "JARVIS_UPDATE_GEN"     # yeniden başlatma nesli (döngü koruması)
MAX_RESTART_GEN = 2                   # en fazla 2 kez kendini yeniden başlat
DEFAULT_CHECK_INTERVAL = 1800.0       # arka plan kontrolü (saniye)


class UpdateError(RuntimeError):
    """Güncelleme sırasında kurtarılabilir hata."""


# --------------------------------------------------------------------------- #
# Sürüm
# --------------------------------------------------------------------------- #
def parse_version(v: Any) -> tuple[int, int, int]:
    """'3.5.4' -> (3, 5, 4). Bozuk/boş sürüm -> (0, 0, 0)."""
    parts = re.findall(r"\d+", str(v or ""))[:3]
    nums = [int(p) for p in parts]
    while len(nums) < 3:
        nums.append(0)
    return nums[0], nums[1], nums[2]


def cmp_version(a: Any, b: Any) -> int:
    pa, pb = parse_version(a), parse_version(b)
    return (pa > pb) - (pa < pb)


def current_version(root: Path | None = None) -> str:
    """Ajan sürümü: version.txt (derlemede üretilir) -> app.py içindeki AGENT_VERSION."""
    root = root or P.app_dir()
    for name in ("version.txt", "_version.txt"):
        f = root / name
        try:
            t = f.read_text(encoding="utf-8").strip()
            if re.match(r"^\d+\.\d+\.\d+", t):
                return t.split()[0]
        except OSError:
            pass
    try:
        src = (root / "app.py").read_text(encoding="utf-8", errors="ignore")
        m = re.search(r'^AGENT_VERSION\s*=\s*["\']([^"\']+)["\']', src, re.M)
        if m:
            return m.group(1)
    except OSError:
        pass
    return "0.0.0"


# --------------------------------------------------------------------------- #
# Ağ
# --------------------------------------------------------------------------- #
def _headers(cfg: dict) -> dict:
    return {"x-agent-key": str(cfg.get("agent_key", "") or "")}


def _base(cfg: dict) -> str:
    return str(cfg.get("dashboard_url", "") or "").rstrip("/")


def fetch_manifest(cfg: dict, timeout: float = 6.0) -> tuple[dict | None, str | None]:
    """Panel dosya manifesti: (manifest, None) veya (None, atlama sebebi)."""
    import requests  # geç import: sihirbazdan önce ağ katmanı yüklenmesin

    url = _base(cfg)
    if not url:
        return "skip", "panel URL boş"
    try:
        r = requests.get(f"{url}/api/agent/manifest", headers=_headers(cfg), timeout=timeout)
    except Exception as e:  # noqa: BLE001
        return "skip", f"panele ulaşılamadı ({type(e).__name__})"
    if r.status_code == 401:
        return None, "ajan anahtarı reddedildi (401)"
    if r.status_code == 404:
        return None, "panel eski sürüm (manifest yok)"
    if not r.ok:
        return None, f"HTTP {r.status_code}"
    try:
        return r.json(), None
    except ValueError:
        return None, "manifest JSON değil"


def fetch_exe_manifest(cfg: dict, timeout: float = 10.0):
    """Panelde derlenmiş JARVIS.exe bilgisi: {version, sha256, size, builtAt}."""
    import requests

    url = _base(cfg)
    if not url:
        return None, "panel URL boş"
    try:
        r = requests.get(f"{url}/api/agent/exe-manifest", headers=_headers(cfg), timeout=timeout)
    except Exception as e:  # noqa: BLE001
        return None, f"panele ulaşılamadı ({type(e).__name__})"
    if r.status_code in (401, 404):
        return None, f"HTTP {r.status_code}"
    if not r.ok:
        return None, f"HTTP {r.status_code}"
    try:
        return r.json(), None
    except ValueError:
        return None, "manifest JSON değil"


def _download(cfg: dict, path: str, params: dict | None, timeout: float) -> bytes:
    import requests

    r = requests.get(f"{_base(cfg)}{path}", headers=_headers(cfg), params=params, timeout=timeout)
    r.raise_for_status()
    return r.content


# --------------------------------------------------------------------------- #
# Dosya güncelleme (kaynak mod + frozen modda .py/.mq5/requirements)
# --------------------------------------------------------------------------- #
def plan_file_updates(root: Path, manifest: dict) -> list[dict]:
    """Manifestteki dosyalardan özeti farklı olanları döndürür."""
    out = []
    for f in manifest.get("files", []) or []:
        name = str(f.get("name", ""))
        if not SAFE_FILE.match(name):
            continue
        dst = root / name
        try:
            cur = hashlib.sha256(dst.read_bytes()).hexdigest() if dst.exists() else None
        except OSError:
            cur = None
        if cur != f.get("sha256"):
            out.append(f)
    return out


def download_files(cfg: dict, files: Iterable[dict], logger=print, timeout: float = 60.0):
    """Tüm dosyaları indirir ve özetlerini doğrular. Hata olursa UpdateError."""
    staged = []
    for f in files:
        data = _download(cfg, "/api/agent/file", {"name": f["name"]}, timeout)
        got = hashlib.sha256(data).hexdigest()
        if got != f.get("sha256"):
            raise UpdateError(f"{f['name']} sağlama toplamı uyuşmadı ({got[:8]} != {str(f.get('sha256'))[:8]})")
        if len(data) != int(f.get("size", len(data))):
            raise UpdateError(f"{f['name']} boyutu uyuşmadı")
        staged.append((f, data))
    return staged


def snapshot(root: Path, home: Path, label: str = "", keep: int = 10) -> Path:
    """Ayar + veri yedeği alır: <home>/backups/YYYYMMDD_HHMMSS[_label]/"""
    home = P.ensure_dirs(home)
    dest = P.backup_dir(home) / (time.strftime("%Y%m%d_%H%M%S") + (f"_{label}" if label else ""))
    dest.mkdir(parents=True, exist_ok=True)
    copied: list[str] = []
    cfgp = P.resolve_config(root, home)
    if cfgp.exists():
        shutil.copy2(cfgp, dest / "config.json")
        copied.append("config.json")
    for name in ("kanal_setup_locks.json", "jarvis.db.tgz", "jarvis.db.tgz.bak"):
        src = home / name
        try:
            if src.is_file() and src.stat().st_size < 512 * 1024 * 1024:
                shutil.copy2(src, dest / name)
                copied.append(name)
        except OSError:
            pass
    (dest / "manifest.json").write_text(
        json.dumps(
            {
                "createdAt": time.strftime("%Y-%m-%dT%H:%M:%S"),
                "label": label,
                "agentVersion": current_version(root),
                "frozen": P.is_frozen(),
                "files": copied,
            },
            ensure_ascii=False,
            indent=2,
        ),
        encoding="utf-8",
    )
    prune_backups(home, keep)
    return dest


def prune_backups(home: Path, keep: int = 10) -> None:
    try:
        bdir = P.backup_dir(home)
        if not bdir.is_dir():
            return
        olds = sorted((p for p in bdir.iterdir() if p.is_dir()), key=lambda p: p.name, reverse=True)[keep:]
        for p in olds:
            shutil.rmtree(p, ignore_errors=True)
    except OSError:
        pass


def list_backups(home: Path) -> list[Path]:
    bdir = P.backup_dir(home)
    if not bdir.is_dir():
        return []
    return sorted((p for p in bdir.iterdir() if p.is_dir()), key=lambda p: p.name, reverse=True)


def rollback(root: Path, home: Path, target: Path | str | None = None, logger=print) -> Path | None:
    """En son (veya verilen) yedeği geri yükler: config.json + veri dosyaları."""
    backups = list_backups(home)
    if not backups:
        logger("[geri-al] yedek bulunamadı")
        return None
    if target:
        cand = P.backup_dir(home) / str(target)
        if not cand.is_dir():
            cand = Path(str(target))
        if not cand.is_dir():
            logger(f"[geri-al] yedek yok: {target}")
            return None
    else:
        cand = backups[0]
    done = []
    src_cfg = cand / "config.json"
    if src_cfg.exists():
        shutil.copy2(src_cfg, P.config_path(root))
        done.append("config.json")
    for name in ("kanal_setup_locks.json", "jarvis.db.tgz"):
        s = cand / name
        if s.exists():
            home.mkdir(parents=True, exist_ok=True)
            shutil.copy2(s, home / name)
            done.append(name)
    logger(f"[geri-al] {cand.name} geri yüklendi: " + (", ".join(done) or "boş yedek"))
    return cand


def apply_files(root: Path, staged, backup: Path | None = None) -> list[str]:
    """İndirilmiş dosyaları atomik olarak yerine koyar (önce yedek)."""
    applied = []
    for f, data in staged:
        dst = root / str(f["name"])
        if backup is not None and dst.exists():
            try:
                rel = dst.relative_to(root)
                (backup / rel).parent.mkdir(parents=True, exist_ok=True)
                shutil.copy2(dst, backup / rel)
            except (OSError, ValueError):
                pass
        dst.parent.mkdir(parents=True, exist_ok=True)
        tmp = dst.with_name(dst.name + ".new")
        tmp.write_bytes(data)
        os.replace(tmp, dst)          # atomik
        applied.append(str(f["name"]))
    return applied


def install_requirements(root: Path, changed: Iterable[str], logger=print) -> None:
    """requirements*.txt değiştiyse pip ile kurar (frozen modda atlar)."""
    names = set(changed)
    if not any(n.startswith("requirements") for n in names):
        return
    if P.is_frozen():
        logger("[güncelleme] EXE sürümünde bağımlılıklar paketlidir, pip atlandı")
        return
    for rf in ("requirements.txt", "requirements-voice.txt"):
        if (root / rf).exists():
            logger(f"[güncelleme] bağımlılıklar denetleniyor: {rf}")
            subprocess.run([sys.executable, "-m", "pip", "install", "-q", "-r", str(root / rf)], check=False)


# --------------------------------------------------------------------------- #
# EXE (frozen) kendini güncelleme
# --------------------------------------------------------------------------- #
def exe_target(root: Path | None = None) -> Path:
    """Değiştirilecek çalıştırılabilir dosya."""
    if P.is_frozen():
        return P.exe_path()
    return (root or P.app_dir()) / EXE_NAME


def stage_exe(target: Path, data: bytes, meta: dict, logger=print) -> Path:
    """Yeni EXE'yi <hedef>.new olarak yazar ve doğrular."""
    if not data[:2] == b"MZ":
        raise UpdateError("indirilen dosya Windows çalıştırılabilir dosyası değil (MZ imzası yok)")
    digest = hashlib.sha256(data).hexdigest()
    want = (meta or {}).get("sha256")
    if want and digest != want:
        raise UpdateError(f"EXE sağlama toplamı uyuşmadı ({digest[:12]} != {str(want)[:12]})")
    size = int((meta or {}).get("size") or 0)
    if size and size != len(data):
        raise UpdateError("EXE boyutu uyuşmadı")
    new = target.with_name(target.name + ".new")
    new.write_bytes(data)
    logger(f"[güncelleme] yeni sürüm hazırlandı: {new.name} ({len(data) / 1e6:.1f} MB)")
    return new


def apply_pending_exe(target: Path, logger=print) -> bool:
    """Hazırlanmış <hedef>.new dosyasını çalışan .exe'nin yerine koyar.

    Windows'ta çalışan bir .exe silinemez ama yeniden adlandırılabilir;
    bu yüzden:  JARVIS.exe -> JARVIS.exe.old  ·  JARVIS.exe.new -> JARVIS.exe
    """
    new = target.with_name(target.name + ".new")
    if not new.exists():
        return False
    old = target.with_name(target.name + ".old")
    try:
        if old.exists():
            old.unlink()
    except OSError:
        pass
    if target.exists():
        try:
            os.rename(target, old)           # çalışan dosya: yeniden adlandırma SERBEST
        except OSError as e:
            raise UpdateError(f"çalışan EXE yeniden adlandırılamadı: {e}") from e
    try:
        os.replace(new, target)
    except OSError as e:
        # geri al
        try:
            if old.exists():
                os.replace(old, target)
        except OSError:
            pass
        raise UpdateError(f"yeni EXE yerleştirilemedi: {e}") from e
    logger(f"[güncelleme] {target.name} güncellendi, eski sürüm {old.name} olarak saklandı")
    return True


def cleanup_after_update(target: Path, logger=print) -> None:
    """Başarılı açılıştan sonra .old / .new artıklarını temizler."""
    for suffix in (".old", ".new"):
        p = target.with_name(target.name + suffix)
        try:
            if p.exists():
                p.unlink()
        except OSError:
            pass


def relaunch(target: Path, args: Iterable[str], cwd: Path) -> None:
    """Yeni sürümü ayrı bir süreç olarak başlatır ve bu süreci kapatır."""
    env = dict(os.environ)
    env[RESTART_ENV] = str(int(env.get(RESTART_ENV, "0")) + 1)
    argv = [str(target), *[a for a in args if a not in ("--setup", "--no-update")]]
    kwargs: dict[str, Any] = {"cwd": str(cwd), "env": env, "close_fds": True}
    if os.name == "nt":
        kwargs["creationflags"] = getattr(subprocess, "DETACHED_PROCESS", 0) | getattr(
            subprocess, "CREATE_NEW_PROCESS_GROUP", 0
        )
    subprocess.Popen(argv, **kwargs)   # noqa: S603 - kendi çalıştırılabilir dosyamız


def restart_allowed() -> bool:
    gen = int(os.environ.get(RESTART_ENV, "0"))
    return gen < MAX_RESTART_GEN


# --------------------------------------------------------------------------- #
# Ana akış
# --------------------------------------------------------------------------- #
@dataclass
class UpdateResult:
    files: list[str] = field(default_factory=list)
    exe: bool = False
    exe_version: str = ""
    restarted: bool = False
    pending: bool = False
    skipped: str = ""

    def __bool__(self) -> bool:
        return bool(self.files or self.exe or self.restarted)


def auto_update_enabled(cfg: dict) -> bool:
    """Varsayılan: panel yerel ağdaysa açık, uzaktaysa kapalı."""
    if "auto_update" in cfg:
        return bool(cfg.get("auto_update"))
    host = (str(cfg.get("dashboard_url", "")).split("//")[-1].split(":")[0] or "").lower()
    return host in ("localhost", "127.0.0.1", "::1") or host.startswith(("192.168.", "10."))


def startup_update(
    cfg: dict,
    logger=print,
    can_restart: Callable[[], bool] | None = None,
    args: Iterable[str] | None = None,
    root: Path | None = None,
    home: Path | None = None,
) -> UpdateResult:
    """Açılışta çağrılır: dosyaları ve gerekirse EXE'yi günceller."""
    res = UpdateResult()
    root = Path(root) if root else P.app_dir()
    home = Path(home) if home else P.data_home(root)
    if not auto_update_enabled(cfg) or not restart_allowed():
        res.skipped = "güncelleme kapalı" if not auto_update_enabled(cfg) else "yeniden başlatma sınırı"
        return res

    # --- 1) dosya manifesti (.py / .mq5 / requirements) ----------------------
    manifest, why = fetch_manifest(cfg)
    if manifest is None:
        res.skipped = why or "manifest yok"
    else:
        changed = plan_file_updates(root, manifest)
        if changed:
            logger(
                f"[güncelleme] {len(changed)} dosya (panel sürümü {manifest.get('version')}): "
                + ", ".join(str(f["name"]) for f in changed[:6])
            )
            try:
                staged = download_files(cfg, changed, logger)
                backup = snapshot(root, home, label="oncelleme")
                res.files = apply_files(root, staged, backup)
                install_requirements(root, res.files, logger)
                logger("[güncelleme] dosyalar güncellendi")
            except Exception as e:  # noqa: BLE001
                logger(f"[güncelleme] dosya güncellemesi başarısız, mevcut sürümle devam: {e}")

    # --- 2) EXE güncellemesi (yalnızca frozen) -------------------------------
    if P.is_frozen():
        meta, why2 = fetch_exe_manifest(cfg)
        target = exe_target(root)
        if meta is None:
            if why2 and "404" not in str(why2):
                logger(f"[güncelleme] EXE bilgisi alınamadı: {why2}")
        else:
            new_v, cur_v = str(meta.get("version") or "0.0.0"), current_version(root)
            if cmp_version(new_v, cur_v) > 0:
                logger(f"[güncelleme] yeni JARVIS.exe indiriliyor: {cur_v} -> {new_v}")
                try:
                    data = _download(cfg, "/api/agent/exe", None, 600.0)
                    stage_exe(target, data, meta, logger)
                    backup = snapshot(root, home, label="exe")
                    res.exe = apply_pending_exe(target, logger)
                    res.exe_version = new_v
                    if res.exe:
                        ok = can_restart() if can_restart else True
                        if ok and restart_allowed():
                            logger("[güncelleme] yeni sürüm başlatılıyor…")
                            relaunch(target, list(args if args is not None else sys.argv[1:]), root)
                            res.restarted = True
                        else:
                            res.pending = True
                            logger("[güncelleme] açık işlem var, yeni sürüm yeniden başlatınca devreye girecek")
                except Exception as e:  # noqa: BLE001
                    logger(f"[güncelleme] EXE güncellenemedi, mevcut sürümle devam: {e}")
            else:
                res.skipped = res.skipped or f"EXE güncel ({cur_v})"
    cleanup_after_update(exe_target(root), logger)
    return res


class BackgroundUpdater:
    """Ajan çalışırken periyodik güncelleme kontrolü (varsayılan 30 dk)."""

    def __init__(self, cfg: dict, logger=print, interval: float = DEFAULT_CHECK_INTERVAL,
                 can_restart: Callable[[], bool] | None = None):
        self.cfg, self.logger, self.interval = cfg, logger, float(interval or DEFAULT_CHECK_INTERVAL)
        self.can_restart = can_restart
        self._stop = False

    def stop(self) -> None:
        self._stop = True

    def run(self) -> None:
        import threading

        def loop() -> None:
            time.sleep(min(60.0, self.interval))
            while not self._stop:
                try:
                    r = startup_update(self.cfg, self.logger, self.can_restart)
                    if r:
                        self.logger(f"[güncelleme] arka plan: dosya={len(r.files)} exe={r.exe} yenidenBaşlatma={r.restarted}")
                except Exception as e:  # noqa: BLE001
                    self.logger(f"[güncelleme] arka plan hatası: {e}")
                slept = 0.0
                while slept < self.interval and not self._stop:
                    time.sleep(5.0)
                    slept += 5.0

        threading.Thread(target=loop, name="jarvis-updater", daemon=True).start()
