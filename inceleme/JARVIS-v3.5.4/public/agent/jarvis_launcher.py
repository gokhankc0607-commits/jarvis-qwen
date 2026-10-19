"""
jarvis_launcher.py — JARVIS.exe giriş noktası
=============================================
* İlk çalıştırmada (veya --setup ile) koyu temalı kurulum sihirbazını açar.
* MT5 terminal64.exe / metaeditor64.exe / MQL5 klasörlerini otomatik bulur.
* Panel bağlantısını, ajan anahtarını ve yerel LLM'i (Ollama / LM Studio) test eder.
* config.json'u .exe'nin yanına kaydeder ve ajanı (app.main) başlatır.
* Loglar: logs/jarvis_YYYYMMDD.log
"""
from __future__ import annotations

import glob
import json
import logging
import hashlib
import os
import re
import subprocess
import sys
import time
import traceback
from pathlib import Path

import jarvis_paths as P   # merkezi yol çözümleme (ayarlar / veriler / yedekler)
import updater             # uygulama içi güncelleyici

ROOT = P.app_dir()         # JARVIS.exe'nin yanı — config.json burada durur
HOME = P.data_home(ROOT)   # loglar, yedekler, KANAL kilitleri (kurulumdan bağımsız)
CONFIG = P.config_path(ROOT)

DEFAULT = {
    "dashboard_url": "http://localhost:3000",
    "agent_key": "",
    "open_browser": True,
    "sync_interval": 2.0,
    "scan_interval": 10.0,
    "mt5": {"terminal_path": "", "login": 0, "password": "", "server": "", "magic": 770077},
    "metaeditor_path": "",
    "mql5_dir": "",
    "wine": False,
    "llm": {"kind": "ollama", "baseUrl": "http://localhost:11434", "model": "qwen2.5-coder:14b", "apiKey": ""},
    "voice": {
        "enabled": True, "wake_word": "jarvis", "whisper_model": "small", "device": "auto",
        "compute_type": "int8", "piper_model": "voices/tr_TR-dfki-medium.onnx",
    },
}


# --------------------------------------------------------------------------- #
# Otomatik keşif
# --------------------------------------------------------------------------- #
def detect_terminals() -> list[str]:
    roots = [os.environ.get("ProgramFiles", r"C:\Program Files"), os.environ.get("ProgramFiles(x86)", r"C:\Program Files (x86)")]
    found: list[str] = []
    for r in roots:
        found += glob.glob(os.path.join(r, "*", "terminal64.exe"))
        found += glob.glob(os.path.join(r, "*", "*", "terminal64.exe"))
    return sorted(set(found))


def detect_mql5_dirs() -> list[str]:
    appdata = os.environ.get("APPDATA", "")
    out = glob.glob(os.path.join(appdata, "MetaQuotes", "Terminal", "*", "MQL5"))
    # portable kurulumlar
    for t in detect_terminals():
        p = os.path.join(os.path.dirname(t), "MQL5")
        if os.path.isdir(p):
            out.append(p)
    return sorted(set(out), key=lambda p: os.path.getmtime(p) if os.path.exists(p) else 0, reverse=True)


def deep_merge(base: dict, over: dict) -> dict:
    out = json.loads(json.dumps(base))
    for k, v in over.items():
        if isinstance(v, dict) and isinstance(out.get(k), dict):
            out[k] = deep_merge(out[k], v)
        else:
            out[k] = v
    return out


def load_cfg() -> dict:
    if CONFIG.exists():
        try:
            return deep_merge(DEFAULT, json.loads(CONFIG.read_text(encoding="utf-8")))
        except Exception:  # noqa: BLE001
            pass
    return json.loads(json.dumps(DEFAULT))


KEY_RE = re.compile(r"^jrv_[a-f0-9]{48}$")


def valid_key(k: str) -> bool:
    return bool(KEY_RE.match((k or "").strip()))


def cfg_complete(c: dict) -> bool:
    return bool(
        c.get("dashboard_url")
        and valid_key(c.get("agent_key", ""))
        and os.path.isfile(c.get("metaeditor_path") or "")
        and os.path.isdir(c.get("mql5_dir") or "")
    )


def autofill(c: dict) -> dict:
    # var olmayan (örnek/yer tutucu) yolları temizle
    if not os.path.isfile(c["mt5"].get("terminal_path") or ""):
        c["mt5"]["terminal_path"] = ""
    if not os.path.isfile(c.get("metaeditor_path") or ""):
        c["metaeditor_path"] = ""
    if not os.path.isdir(c.get("mql5_dir") or ""):
        c["mql5_dir"] = ""
    terms = detect_terminals()
    if not c["mt5"].get("terminal_path") and terms:
        c["mt5"]["terminal_path"] = terms[0]
    if not c.get("metaeditor_path") and c["mt5"].get("terminal_path"):
        me = os.path.join(os.path.dirname(c["mt5"]["terminal_path"]), "metaeditor64.exe")
        if os.path.exists(me):
            c["metaeditor_path"] = me
    if not c.get("mql5_dir"):
        d = detect_mql5_dirs()
        if d:
            c["mql5_dir"] = d[0]
    return c


# --------------------------------------------------------------------------- #
# Kurulum sihirbazı (tkinter — Python ile birlikte gelir)
# --------------------------------------------------------------------------- #
def run_wizard(cfg: dict) -> bool:
    import tkinter as tk
    from tkinter import filedialog, messagebox, ttk

    import requests

    BG, PANEL, FG, ACC, MUTED = "#02040b", "#0a1530", "#dbeafe", "#22d3ee", "#64748b"
    root = tk.Tk()
    root.title("JARVIS · Kurulum")
    root.configure(bg=BG)
    root.geometry("760x720")
    root.minsize(700, 640)
    ico = ROOT / "jarvis.ico"
    if ico.exists():
        try:
            root.iconbitmap(str(ico))
        except Exception:  # noqa: BLE001
            pass

    st = ttk.Style(root)
    st.theme_use("clam")
    st.configure(".", background=BG, foreground=FG, fieldbackground=PANEL, bordercolor="#1e3a5f", font=("Segoe UI", 10))
    st.configure("TLabel", background=BG, foreground=FG)
    st.configure("H.TLabel", font=("Segoe UI Semibold", 20), foreground=ACC)
    st.configure("S.TLabel", foreground=MUTED)
    st.configure("Sec.TLabel", font=("Segoe UI Semibold", 10), foreground=ACC)
    st.configure("TEntry", fieldbackground=PANEL, foreground=FG, insertcolor=ACC)
    st.configure("TCombobox", fieldbackground=PANEL, foreground=FG, background=PANEL, arrowcolor=ACC)
    st.map("TCombobox", fieldbackground=[("readonly", PANEL)], foreground=[("readonly", FG)])
    st.configure("TCheckbutton", background=BG, foreground=FG)
    st.configure("TButton", background=PANEL, foreground=ACC, padding=8, bordercolor=ACC)
    st.map("TButton", background=[("active", "#11284d")])
    st.configure("Go.TButton", background="#0e7490", foreground="white", font=("Segoe UI Semibold", 11))

    canvas = tk.Canvas(root, bg=BG, highlightthickness=0)
    sb = ttk.Scrollbar(root, orient="vertical", command=canvas.yview)
    frm = ttk.Frame(canvas, padding=22)
    st.configure("TFrame", background=BG)
    frm.bind("<Configure>", lambda e: canvas.configure(scrollregion=canvas.bbox("all")))
    canvas.create_window((0, 0), window=frm, anchor="nw")
    canvas.configure(yscrollcommand=sb.set)
    canvas.pack(side="left", fill="both", expand=True)
    sb.pack(side="right", fill="y")
    canvas.bind_all("<MouseWheel>", lambda e: canvas.yview_scroll(int(-e.delta / 120), "units"))
    frm.columnconfigure(1, weight=1)

    ttk.Label(frm, text="J A R V I S", style="H.TLabel").grid(row=0, column=0, columnspan=3, sticky="w")
    ttk.Label(frm, text="MT5 · MQL5 · Yerel AI ajanı — ilk kurulum", style="S.TLabel").grid(row=1, column=0, columnspan=3, sticky="w", pady=(0, 14))

    vars_: dict[str, tk.Variable] = {}
    row = [2]

    def section(t: str) -> None:
        ttk.Label(frm, text=t.upper(), style="Sec.TLabel").grid(row=row[0], column=0, columnspan=3, sticky="w", pady=(14, 4))
        row[0] += 1

    def field(key: str, label: str, value: str, browse: str | None = None, show: str = "", choices: list[str] | None = None) -> None:
        ttk.Label(frm, text=label).grid(row=row[0], column=0, sticky="w", padx=(0, 10), pady=3)
        v = tk.StringVar(value=str(value or ""))
        vars_[key] = v
        if choices is not None:
            w = ttk.Combobox(frm, textvariable=v, values=choices)
        else:
            w = ttk.Entry(frm, textvariable=v, show=show)
        w.grid(row=row[0], column=1, sticky="ew", pady=3)
        if browse:
            def pick() -> None:
                p = filedialog.askdirectory() if browse == "dir" else filedialog.askopenfilename(filetypes=[("Program", "*.exe"), ("Tümü", "*.*")])
                if p:
                    v.set(os.path.normpath(p))
            ttk.Button(frm, text="…", width=3, command=pick).grid(row=row[0], column=2, padx=(6, 0))
        row[0] += 1

    section("Komuta Merkezi")
    field("dashboard_url", "Panel URL", cfg["dashboard_url"])
    field("agent_key", "Ajan anahtarı", cfg["agent_key"], show="•")

    section("MetaTrader 5")
    field("terminal_path", "terminal64.exe", cfg["mt5"]["terminal_path"], "file", choices=detect_terminals())
    field("metaeditor_path", "metaeditor64.exe", cfg["metaeditor_path"], "file")
    field("mql5_dir", "MQL5 klasörü", cfg["mql5_dir"], "dir", choices=detect_mql5_dirs())
    field("login", "Hesap no (ops.)", cfg["mt5"]["login"] or "")
    field("password", "Şifre (ops.)", cfg["mt5"]["password"], show="•")
    field("server", "Sunucu (ops.)", cfg["mt5"]["server"])
    ttk.Label(frm, text="Hesap bilgileri boşsa terminalde açık olan hesap kullanılır.", style="S.TLabel").grid(row=row[0], column=1, sticky="w")
    row[0] += 1

    section("Yerel Yapay Zekâ")
    field("llm_kind", "API tipi", cfg["llm"]["kind"], choices=["ollama", "openai_compat", "anthropic", "gemini"])
    field("llm_url", "Base URL", cfg["llm"]["baseUrl"])
    field("llm_model", "Model", cfg["llm"]["model"])
    field("llm_key", "API anahtarı (bulut)", cfg["llm"].get("apiKey", ""), show="•")

    section("Ses")
    voice_on = tk.BooleanVar(value=cfg["voice"]["enabled"])
    ttk.Checkbutton(frm, text="Sesli asistan (faster-whisper + Piper)", variable=voice_on).grid(row=row[0], column=1, sticky="w")
    row[0] += 1
    field("whisper_model", "Whisper modeli", cfg["voice"]["whisper_model"], choices=["tiny", "base", "small", "medium", "large-v3", "models/whisper-small"])
    field("device", "Cihaz", cfg["voice"]["device"], choices=["auto", "cpu", "cuda"])
    field("piper_model", "Piper ses dosyası", cfg["voice"]["piper_model"], "file")

    status = tk.StringVar(value="")
    ttk.Label(frm, textvariable=status, style="S.TLabel", wraplength=640, justify="left").grid(row=row[0] + 1, column=0, columnspan=3, sticky="w", pady=(10, 0))

    def collect() -> dict:
        g = lambda k: vars_[k].get().strip()  # noqa: E731
        c = json.loads(json.dumps(cfg))
        c["dashboard_url"] = g("dashboard_url").rstrip("/")
        c["agent_key"] = g("agent_key")
        c["mt5"].update(terminal_path=g("terminal_path"), login=int(g("login") or 0), password=g("password"), server=g("server"))
        c["metaeditor_path"] = g("metaeditor_path")
        c["mql5_dir"] = g("mql5_dir")
        c["llm"] = {"kind": g("llm_kind"), "baseUrl": g("llm_url"), "model": g("llm_model"), "apiKey": g("llm_key")}
        c["voice"].update(enabled=bool(voice_on.get()), whisper_model=g("whisper_model"), device=g("device"), piper_model=g("piper_model"))
        return c

    def test() -> None:
        c = collect()
        lines: list[str] = []
        status.set("Test ediliyor…")
        root.update_idletasks()
        try:
            r = requests.post(f"{c['dashboard_url']}/api/agent/sync", headers={"x-agent-key": c["agent_key"]},
                              json={"account": {"connected": False}}, timeout=10)
            lines.append("✓ Panel bağlantısı ve anahtar geçerli" if r.ok else f"✗ Panel: HTTP {r.status_code} {r.text[:80]}")
        except Exception as e:  # noqa: BLE001
            lines.append(f"✗ Panel erişilemedi: {e}")
        lines.append(("✓" if os.path.exists(c["metaeditor_path"]) else "✗") + " metaeditor64.exe")
        lines.append(("✓" if os.path.isdir(c["mql5_dir"]) else "✗") + " MQL5 klasörü")
        try:
            base = c["llm"]["baseUrl"].rstrip("/")
            url = f"{base}/api/tags" if c["llm"]["kind"] == "ollama" else f"{base}/models"
            h = {"Authorization": f"Bearer {c['llm']['apiKey']}"} if c["llm"]["apiKey"] else {}
            r = requests.get(url, headers=h, timeout=5)
            if r.ok and c["llm"]["kind"] == "ollama":
                models = [m["name"] for m in r.json().get("models", [])]
                ok = any(m.startswith(c["llm"]["model"].split(":")[0]) for m in models)
                lines.append(f"{'✓' if ok else '!'} Ollama çalışıyor · modeller: {', '.join(models[:5]) or 'yok'}"
                             + ("" if ok else f"  → 'ollama pull {c['llm']['model']}'"))
            else:
                lines.append("✓ LLM sunucusu yanıt verdi" if r.ok else f"✗ LLM: HTTP {r.status_code}")
        except Exception as e:  # noqa: BLE001
            lines.append(f"✗ LLM erişilemedi ({type(e).__name__}) — Ollama/LM Studio açık mı?")
        pm = c["voice"]["piper_model"]
        if c["voice"]["enabled"]:
            ok = os.path.exists(pm if os.path.isabs(pm) else ROOT / pm)
            lines.append(("✓ Piper sesi bulundu" if ok else "! Piper sesi yok → pyttsx3 (Windows SAPI) kullanılacak"))
        status.set("\n".join(lines))

    result = {"ok": False}

    def save_start() -> None:
        c = collect()
        c["agent_key"] = c["agent_key"].strip()
        if not valid_key(c["agent_key"]):
            messagebox.showerror("JARVIS", "Geçerli bir ajan anahtarı girin (paneldeki Yerel Ajan sayfası).")
            return
        CONFIG.write_text(json.dumps(c, indent=2, ensure_ascii=False), encoding="utf-8")
        result["ok"] = True
        root.destroy()

    bar = ttk.Frame(frm)
    bar.grid(row=row[0], column=0, columnspan=3, sticky="e", pady=(18, 0))
    ttk.Button(bar, text="Bağlantıları Test Et", command=test).pack(side="left", padx=6)
    ttk.Button(bar, text="Kaydet ve Başlat ▶", style="Go.TButton", command=save_start).pack(side="left")
    root.mainloop()
    return result["ok"]


# --------------------------------------------------------------------------- #
def _is_local(url: str) -> bool:
    from urllib.parse import urlparse

    h = (urlparse(url).hostname or "").lower()
    return h in ("localhost", "127.0.0.1", "::1") or h.startswith(("192.168.", "10.")) or bool(re.match(r"172\.(1[6-9]|2\d|3[01])\.", h))


SAFE_FILE = re.compile(r"^(?:[\w-]+\.py|mql5/[\w.-]+\.mq5|requirements(?:-voice)?\.txt|config\.example\.json|README\.md)$")


def check_panel(cfg: dict) -> tuple[str, str]:
    """Panel ve ajan anahtarı ön kontrolü: ok | badkey | down | old | error."""
    import requests

    url = str(cfg.get("dashboard_url", "")).rstrip("/")
    if not url:
        return "error", "Panel URL boş"
    try:
        r = requests.get(f"{url}/api/agent/manifest", headers={"x-agent-key": cfg.get("agent_key", "")}, timeout=6)
    except Exception as e:  # noqa: BLE001
        return "down", type(e).__name__
    if r.status_code == 401:
        return "badkey", ""
    if r.status_code == 404:
        return "old", ""
    if not r.ok:
        return "error", f"HTTP {r.status_code}"
    return "ok", ""


def box(lines: list[str]) -> None:
    w = max(len(x) for x in lines) + 4
    print("\n " + "=" * w)
    for x in lines:
        print("   " + x)
    print(" " + "=" * w + "\n")


def self_update(cfg: dict) -> "updater.UpdateResult":
    """Uygulama içi güncelleme: .py/.mq5 dosyaları ve (EXE ise) JARVIS.exe'nin kendisi.

    * Ayarlar (config.json), loglar, yedekler, ses/whisper modelleri ASLA dokunulmaz.
    * İndirilen her dosyanın SHA-256'sı doğrulanır; uyuşmazsa hiçbir şey yazılmaz.
    * EXE değişiminden önce yedek alınır; gerektiğinde `JARVIS.exe --rollback`.
    """
    return updater.startup_update(
        cfg,
        logger=print,
        args=[a for a in sys.argv[1:] if a != "--setup"],
        root=ROOT,
        home=HOME,
    )


def selftest() -> int:
    """--selftest: kurulumun açılıp açılamayacağını hızlıca doğrular (ağ/MT5 beklemez)."""
    import importlib.util
    import platform

    rows: list[tuple[str, bool, str]] = []

    def add(name: str, ok_: bool, detail: str = "", critical: bool = True) -> None:
        rows.append((name, bool(ok_), detail, critical))

    ver = updater.current_version(ROOT)
    add("Sürüm", bool(re.match(r"^\d+\.\d+\.\d+", ver)), ver)
    add("Python", sys.version_info[:2] >= (3, 10), platform.python_version())
    add("Çalışma biçimi", True, "EXE (tek dosya)" if P.is_frozen() else "kaynak kodu")

    # yollar
    info = P.describe()
    add("Ayar dosyası", True, info["config"] + (" (var)" if Path(info["config"]).exists() else " (ilk kurulum bekliyor)"), critical=False)
    try:
        home = P.ensure_dirs(HOME)
        probe = home / ".selftest.tmp"
        probe.write_text("ok", encoding="utf-8")
        probe.unlink()
        add("Veri klasörü yazılabilir", True, str(home))
    except Exception as e:  # noqa: BLE001
        add("Veri klasörü yazılabilir", False, f"{HOME}: {e}")
    try:
        b = updater.snapshot(ROOT, HOME, label="selftest", keep=3)
        add("Yedekleme", True, b.name)
        updater.prune_backups(HOME, keep=3)
    except Exception as e:  # noqa: BLE001
        add("Yedekleme", False, str(e))

    # çekirdek dosyalar / modüller
    missing = [f for f in ("app.py", "mt5_engine.py", "kanal_strategy.py", "crypto_engine.py",
                           "local_ai.py", "mql5_compiler.py", "updater.py", "jarvis_paths.py")
               if not (ROOT / f).exists()]
    add("Çekirdek dosyalar", not missing, ", ".join(missing) or "tamam")
    for mod in ("requests", "numpy", "pandas"):
        add(f"Modül {mod}", importlib.util.find_spec(mod) is not None, "", critical=False)
    try:
        import MetaTrader5  # noqa: F401
        add("Modül MetaTrader5", True, "")
    except Exception:  # noqa: BLE001
        add("Modül MetaTrader5", False, "yalnızca Windows + MT5 kurulu terminalde gerekir (--simulate ile gerekmez)", critical=False)

    # ayarlar
    try:
        cfg = autofill(load_cfg())
        add("Ayarlar okunabilir", True, "eksik: " + (", ".join(k for k in ("agent_key", "metaeditor_path", "mql5_dir")
                                                              if not cfg.get(k)) or "yok") if not cfg_complete(cfg) else "tam")
    except Exception as e:  # noqa: BLE001
        add("Ayarlar okunabilir", False, str(e))

    st, detail = check_panel(load_cfg())
    add("Panel bağlantısı", st in ("ok", "badkey"),
        {"ok": "bağlı", "badkey": "anahtar geçersiz", "down": f"kapalı ({detail})",
         "old": "panel eski sürüm", "error": detail}.get(st, st), critical=False)

    w = max(len(r[0]) for r in rows) + 2
    print("\n  JARVIS — kendi kendini test\n" + "  " + "-" * (w + 40))
    failures = 0
    for name, ok_, detail, critical in rows:
        mark = "\033[92m✓\033[0m" if ok_ else ("\033[91m✗\033[0m" if critical else "\033[93m!\033[0m")
        print(f"  {mark} {name.ljust(w)}{detail}")
        if not ok_ and critical:
            failures += 1
    print("  " + "-" * (w + 40))
    print(f"  {'TÜM TESTLER GEÇTİ' if not failures else str(failures) + ' KRİTİK SORUN'}\n")
    return 1 if failures else 0


def setup_logging() -> None:
    logs = P.logs_dir(P.ensure_dirs(HOME))
    fh = logging.FileHandler(logs / f"jarvis_{time.strftime('%Y%m%d')}.log", encoding="utf-8")
    fh.setFormatter(logging.Formatter("%(asctime)s │ %(name)-12s │ %(levelname)-7s │ %(message)s"))
    logging.getLogger().addHandler(fh)


def banner() -> None:
    try:
        os.system("")  # Windows konsolunda ANSI renkleri etkinleştir
        print("\033[96m" + r"""
      ██╗ █████╗ ██████╗ ██╗   ██╗██╗███████╗
      ██║██╔══██╗██╔══██╗██║   ██║██║██╔════╝
      ██║███████║██████╔╝██║   ██║██║███████╗
 ██   ██║██╔══██║██╔══██╗╚██╗ ██╔╝██║╚════██║
 ╚█████╔╝██║  ██║██║  ██║ ╚████╔╝ ██║███████║
  ╚════╝ ╚═╝  ╚═╝╚═╝  ╚═╝  ╚═══╝  ╚═╝╚══════╝
        MT5 · MQL5 · LOCAL AI  —  yerel ajan
""" + "\033[0m")
    except Exception:  # noqa: BLE001
        pass


def main() -> None:
    args = sys.argv[1:]

    # --- hızlı komutlar (sihirbaz / ağ / MT5 beklemeden) ----------------------
    if "--version" in args or "-v" in args:
        print(f"JARVIS {updater.current_version(ROOT)}"
              + ("  (EXE)" if P.is_frozen() else "  (kaynak)"))
        return
    if "--paths" in args:
        for k, v in P.describe().items():
            print(f"  {k:10s} {v}")
        return
    if "--backups" in args:
        ups = updater.list_backups(HOME)
        print("\n".join(f"  {b.name}" for b in ups) or "  yedek yok")
        return
    if "--rollback" in args:
        sys.exit(0 if updater.rollback(ROOT, HOME, logger=print) else 1)
    if "--selftest" in args:
        sys.exit(selftest())

    banner()
    cfg = autofill(load_cfg())
    force = "--setup" in args
    args = [a for a in args if a != "--setup"]
    if force or not cfg_complete(cfg):
        if not run_wizard(cfg):
            print("Kurulum iptal edildi.")
            return
        cfg = autofill(load_cfg())

    # Ön kontrol: panel açık mı, anahtar geçerli mi?
    st, detail = check_panel(cfg)
    if st == "badkey":
        box([
            "AJAN ANAHTARI GEÇERSİZ — panel bu anahtarı tanımıyor (401).",
            "Neden: panel yeni bir klasöre kurulduysa veritabanı (ve anahtar) yenilenir.",
            "Çözüm: Panel > Yerel Ajan sayfasındaki 'Ajan Anahtarı'nı kopyalayın.",
            "Kurulum penceresi şimdi açılıyor — anahtarı yapıştırıp 'Kaydet ve Başlat'.",
        ])
        if not run_wizard(cfg):
            print("Kurulum iptal edildi.")
            return
        cfg = autofill(load_cfg())
    elif st == "down":
        box([
            f"PANELE ULAŞILAMADI: {cfg.get('dashboard_url')}  ({detail})",
            "Panel penceresi (PANEL_BASLAT.bat) açık mı? Ajan bağlanmayı denemeye devam edecek.",
        ])
    elif st == "old":
        print("[uyarı] Panel eski sürüm görünüyor — paneli de güncelleyin (PANEL_BASLAT.bat yeniden derler).")
    # --- uygulama içi güncelleme --------------------------------------------
    if "--no-update" in args or os.environ.get("JARVIS_NO_UPDATE") == "1":
        args = [a for a in args if a != "--no-update"]
        print("[güncelleme] atlandı (--no-update)")
    else:
        res = self_update(cfg)
        if res.restarted:                      # yeni EXE ayrı süreçte açıldı
            return
        if res.files and not P.is_frozen():    # kaynak modda yeni .py'ler için yeniden başlat
            gen = int(os.environ.get(updater.RESTART_ENV, "0")) + 1
            if gen < updater.MAX_RESTART_GEN:
                env = {**os.environ, updater.RESTART_ENV: str(gen)}
                sys.exit(subprocess.call([sys.executable, str(Path(__file__).resolve()), *args], env=env))
    updater.cleanup_after_update(P.exe_path(), print)
    setup_logging()
    import app  # noqa: WPS433 (ağır bağımlılıklar sihirbazdan sonra yüklenir)

    app.main(args)


if __name__ == "__main__":
    try:
        main()
    except SystemExit:
        raise
    except Exception:  # noqa: BLE001
        traceback.print_exc()
        logs = P.logs_dir(P.ensure_dirs(HOME))
        (logs / "crash.log").write_text(traceback.format_exc(), encoding="utf-8")
        if getattr(sys, "frozen", False):
            input(f"\nBeklenmeyen hata. {logs / 'crash.log'} dosyasına bakın. Çıkmak için Enter…")
