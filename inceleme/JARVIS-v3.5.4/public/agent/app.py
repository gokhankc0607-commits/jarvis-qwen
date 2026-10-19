"""
app.py — JARVIS ana çalıştırıcı (yerel ajan)
============================================
Tüm modülleri birbirine bağlar ve web komuta merkeziyle canlı konuşur:

  MT5Engine  ──► hesap / pozisyon / sinyal adayları ──► /api/agent/sync ──► Komuta Merkezi (Orb UI)
  Komuta Merkezi ──► onaylı sinyaller, kapatma istekleri, derleme işleri ──► ajan yürütür ──► /api/agent/report
  Sesli döngü: yeni sinyal -> "X paritesinde BUY fırsatı oluştu, işleme gireyim mi?" -> Whisper -> yalnızca "Evet" = onay
  Uyandırma kelimesi: "Jarvis ..." -> yerel LLM ile sohbet, "durum", "derle <ad>"

Kullanım:
  python app.py                      # tam mod
  python app.py --no-voice           # ses kapalı (onaylar panelden)
  python app.py --simulate           # MT5 olmadan test
  python app.py --test-compile Experts\\Jarvis\\X.mq5
"""
from __future__ import annotations

import argparse
import datetime as dt
import json
import logging
import os
import queue
import sys
import threading
import time
import webbrowser
from pathlib import Path
from typing import Any, Optional

import requests

import jarvis_paths as P
from local_ai import JarvisBrain, LLMClient, SpeechToText, TextToSpeech, has_wake_word, is_no, is_yes
from mql5_compiler import MQL5Compiler
from kanal_strategy import KANAL_TFS, KanalParams, kanal_analyze, kanal_confidence, kanal_levels
from mt5_engine import ALGO_HINT, TIMEFRAMES, MT5Engine, SignalCandidate, WatchRule, parse_tf
from crypto_engine import CryptoConfig, CryptoEngine, is_crypto_symbol, norm_crypto

log = logging.getLogger("jarvis")
AGENT_VERSION = "3.5.4"
# PyInstaller ile paketlendiğinde config / modeller .exe'nin yanındaki klasörden okunur
ROOT = Path(sys.executable).parent if getattr(sys, "frozen", False) else Path(__file__).parent
#: Loglar / yedekler / KANAL kilitleri — kurulum klasöründen BAĞIMSIZ ortak veri evi.
HOME = P.data_home(ROOT)


def _epoch_utc(value: Any) -> float:
    """MT5/CCXT DataFrame zamanları naive UTC gelir; yerel saat dilimine göre kaydırılmalarını önle."""
    if hasattr(value, "to_pydatetime"):
        value = value.to_pydatetime()
    if isinstance(value, dt.datetime):
        if value.tzinfo is None:
            value = value.replace(tzinfo=dt.timezone.utc)
        return value.timestamp()
    return float(value)


def rel(p: Optional[str]) -> Optional[str]:
    """Config içindeki göreli yolları uygulama klasörüne göre çözer."""
    if not p:
        return p
    q = Path(p)
    if q.is_absolute():
        return str(q)
    cand = ROOT / q
    return str(cand) if cand.exists() else p  # örn. "small" gibi model adları olduğu gibi kalır


# --------------------------------------------------------------------------- #
class Dashboard:
    def __init__(self, url: str, key: str) -> None:
        self.url = url.rstrip("/")
        self.s = requests.Session()
        self.s.headers.update({"x-agent-key": key, "Content-Type": "application/json"})

    def sync(self, payload: dict) -> dict:
        r = self.s.post(f"{self.url}/api/agent/sync", data=json.dumps(payload, default=str), timeout=15)
        r.raise_for_status()
        return r.json()

    def telegram(self, data: str, callback_query_id: str = "") -> dict:
        """Telegram düğmesi -> panel (onay / ret / sessiz)."""
        r = self.s.post(f"{self.url}/api/agent/telegram",
                        data=json.dumps({"data": data, "callbackQueryId": callback_query_id}), timeout=30)
        r.raise_for_status()
        return r.json()

    def command(self, text: str) -> dict:
        """Sesli komutu paneldeki aynı komut işleyiciye gönderir (emir aç / SL-TP / kapat / durum / sohbet)."""
        r = self.s.post(f"{self.url}/api/agent/command", data=json.dumps({"text": text}), timeout=40)
        r.raise_for_status()
        return r.json()

    def ticks(self, payload: dict) -> None:
        try:
            r = self.s.post(f"{self.url}/api/agent/ticks", data=json.dumps(payload, default=str), timeout=5)
            r.raise_for_status()
        except Exception as e:  # noqa: BLE001
            log.debug("Fiyatlar gönderilemedi: %s", e)

    def market(self, payload: dict) -> None:
        try:
            r = self.s.post(f"{self.url}/api/agent/market", data=json.dumps(payload, default=str), timeout=20)
            r.raise_for_status()
        except Exception as e:  # noqa: BLE001
            log.debug("Piyasa verisi gönderilemedi: %s", e)

    def report(self, payload: dict) -> dict:
        try:
            r = self.s.post(f"{self.url}/api/agent/report", data=json.dumps(payload, default=str), timeout=15)
            r.raise_for_status()
            return r.json()
        except Exception as e:  # noqa: BLE001
            log.error("Rapor gönderilemedi: %s", e)
            return {}


# --------------------------------------------------------------------------- #
class Jarvis:
    def __init__(self, cfg: dict, voice: bool, simulate: bool) -> None:
        self.cfg = cfg
        self.dash = Dashboard(cfg["dashboard_url"], cfg["agent_key"])
        m = cfg.get("mt5", {})
        self.engine = MT5Engine(m.get("terminal_path") or None, m.get("login") or None, m.get("password") or None,
                                m.get("server") or None, magic=m.get("magic", 770077), simulate=simulate)
        self.compiler = MQL5Compiler(cfg["metaeditor_path"], cfg["mql5_dir"], wine=cfg.get("wine", False))
        self.crypto: Optional[CryptoEngine] = None     # kripto vadeli motoru (panel → Kripto Borsası ayarları)
        self.crypto_cfg_sig = ""
        self.crypto_fail_at = 0.0
        self.crypto_signals_seen = 0
        self.local_llm = LLMClient.from_dict(cfg["llm"]) if cfg.get("llm") else None
        self.remote_llm: Optional[LLMClient] = None
        self.brain: Optional[JarvisBrain] = None
        self.rules: list[WatchRule] = []
        self.watch: list[dict] = []  # paneldeki tüm izlenen (parite, zaman dilimi) çiftleri
        self.kanal: dict = {}        # panelden gelen KANAL strateji ayarları
        self._fired: dict[tuple, int] = {}  # (sembol, tf, yön) -> tek sinyal verilen M0 kurulum zamanı
        self.kanal_setup_locks: dict[str, dict] = self._load_kanal_setup_locks()
        for k, lock in self.kanal_setup_locks.items():
            try:
                symbol, tf = k.split("|", 1)
                self._fired[(symbol, tf, lock["side"])] = int(lock["setupTime"])
            except Exception:  # noqa: BLE001
                pass
        self.scan_symbols: list[str] = []   # Piyasa Gözlemi sembolleri (fiyat akışı için)
        self.feed_errors: dict[str, str] = {}  # "SEMBOL TF" -> son hata
        self.known_pos: dict[str, dict] = {}   # açık pozisyonlar (kapanışı yakalamak için)
        self.pos_miss: dict[str, int] = {}
        self.closed_buf: list[dict] = []
        self._algo_warn = 0.0
        self.auto_magic = int(self.engine.magic) + 1   # otomatik işlemler ayrı magic ile açılır (ayırt etmek için)
        self.be_state: dict[str, tuple[int, float]] = {}  # bilet -> (deneme, son deneme zamanı)
        self.pt_state: dict[str, tuple[int, float]] = {}  # yarı kâr: bilet -> (deneme, zaman)
        self.pt_done: set[str] = set()
        self.pt_checked: set[str] = set()
        self._mw_sent = 0.0
        self.tg_offset = 0
        self.tg_errors = 0
        self.tf_map: dict[str, str] = self._load_tf_map()  # pozisyon bileti -> açıldığı zaman dilimi (kalıcı)
        self.last_positions: list = []
        self.outbox: list[dict] = []
        self.asked: set[int] = set()
        self.executed: set[int] = set()
        self.done_cmds: set[int] = set()
        self.compile_q: "queue.Queue[dict]" = queue.Queue()
        self.voice_q: "queue.Queue[dict]" = queue.Queue()
        self.lock = threading.Lock()
        self.level = 0.0
        self.voice_enabled = voice
        self.stt: Optional[SpeechToText] = None
        self.tts: Optional[TextToSpeech] = None
        self.busy_voice = threading.Event()
        self.stop = threading.Event()

    # ------------------------------------------------------------------ piyasa (MT5 / kripto) seçimi
    def engine_for(self, market: Optional[str], symbol: str = "") -> Any:
        """'crypto' -> kripto motoru · 'forex' -> MT5 · boş -> sembolden tahmin (BTCUSDT gibi -> kripto)."""
        m = (market or "").lower()
        if m == "crypto" or (not m and self.crypto and is_crypto_symbol(symbol, self.crypto.known)):
            if not self.crypto:
                raise RuntimeError("Kripto borsası bağlı değil (Panel → Kripto Borsası).")
            return self.crypto
        return self.engine

    def setup_crypto(self, cfg: Optional[dict]) -> None:
        """Panelden gelen kripto ayarlarıyla motoru kur / yenile (ayar değişince yeniden bağlanır)."""
        if not cfg or not cfg.get("enabled"):
            if self.crypto:
                log.info("Kripto borsası kapatıldı")
            self.crypto = None
            self.crypto_cfg_sig = ""
            return
        sig = json.dumps({k: cfg.get(k) for k in ("exchange", "apiKey", "secret", "password", "demo", "leverage", "marginMode", "orderUsdt")}, sort_keys=True)
        if sig == self.crypto_cfg_sig and self.crypto:
            return
        if time.time() - self.crypto_fail_at < 60 and sig == self.crypto_cfg_sig:
            return
        self.crypto_cfg_sig = sig
        eng = CryptoEngine(CryptoConfig.from_dict({
            "exchange": cfg.get("exchange") or "binance", "api_key": cfg.get("apiKey") or "", "secret": cfg.get("secret") or "",
            "password": cfg.get("password") or "", "demo": cfg.get("demo", True), "leverage": cfg.get("leverage") or 5,
            "margin_mode": cfg.get("marginMode") or "isolated", "order_usdt": cfg.get("orderUsdt") or 50,
        }), magic=int(self.engine.magic))
        if eng.connect():
            self.crypto = eng
            self.voice_q.put({"say": f"Kripto borsası bağlandı efendim: {eng.label}."})
        else:
            self.crypto = None
            self.crypto_fail_at = time.time()

    # ------------------------------------------------------------------ zaman dilimi kaydı
    TF_FILE = "tf_map.json"

    def _load_tf_map(self) -> dict:
        try:
            return {str(k): str(v) for k, v in json.loads((ROOT / self.TF_FILE).read_text(encoding="utf-8")).items()}
        except Exception:  # noqa: BLE001
            return {}

    def remember_tf(self, tf: str, *tickets: Any) -> None:
        """Ajanın açtığı her pozisyonun zaman dilimini kalıcı olarak kaydeder (broker yorumu silse bile bilinir)."""
        tf = (tf or "").upper()
        if not tf:
            return
        changed = False
        for t in tickets:
            if t:
                self.tf_map[str(t)] = tf
                changed = True
        if changed:
            if len(self.tf_map) > 2000:  # en eski kayıtları at
                self.tf_map = dict(list(self.tf_map.items())[-1500:])
            try:
                (ROOT / self.TF_FILE).write_text(json.dumps(self.tf_map), encoding="utf-8")
            except Exception as e:  # noqa: BLE001
                log.debug("tf_map yazılamadı: %s", e)

    def tf_of(self, p: Any) -> str:
        tf = self.tf_map.get(str(p.ticket)) or parse_tf(getattr(p, "comment", ""))
        if tf and str(p.ticket) not in self.tf_map:
            self.remember_tf(tf, p.ticket)
        return tf

    # ------------------------------------------------------------------ yardımcı
    @property
    def llm(self) -> Optional[LLMClient]:
        # config.json'daki yerel LLM her zaman önceliklidir; yoksa paneldeki aktif sağlayıcı
        return self.local_llm or self.remote_llm

    def _set_level(self, v: float) -> None:
        self.level = v

    def speak(self, text: str) -> None:
        if self.tts:
            self.tts.say(text)
        else:
            log.info("JARVIS: %s", text)

    def listen(self, **kw: Any) -> str:
        if not self.stt:
            return ""
        return self.stt.listen(**kw)

    # ------------------------------------------------------------------ başlat
    def start(self) -> None:
        if not self.engine.connect():
            log.error("MT5'e bağlanılamadı. Terminal açık ve 'Algo Trading' etkin mi?")
        if self.voice_enabled:
            v = self.cfg.get("voice", {})
            try:
                self.tts = TextToSpeech(rel(v.get("piper_model")) or None, on_level=self._set_level)
                self.stt = SpeechToText(rel(v.get("whisper_model", "small")) or "small", v.get("device", "auto"),
                                        v.get("compute_type", "int8"), on_level=self._set_level)
            except Exception as e:  # noqa: BLE001
                log.error("Ses modülleri başlatılamadı (%s) -> sessiz mod", e)
                self.voice_enabled = False
        threading.Thread(target=self.sync_loop, daemon=True, name="sync").start()
        threading.Thread(target=self.scan_loop, daemon=True, name="scan").start()
        threading.Thread(target=self.market_loop, daemon=True, name="market").start()
        threading.Thread(target=self.quote_loop, daemon=True, name="quotes").start()
        threading.Thread(target=self.telegram_loop, daemon=True, name="telegram").start()
        log.info("JARVIS ajan v%s başlatıldı", AGENT_VERSION)
        threading.Thread(target=self.compile_worker, daemon=True, name="compile").start()
        if self.voice_enabled:
            threading.Thread(target=self.voice_loop, daemon=True, name="voice").start()
        if self.cfg.get("open_browser", True):
            webbrowser.open(self.cfg["dashboard_url"] + "/dashboard")
        self.speak("JARVIS çevrimiçi efendim. Piyasaları izliyorum.")
        try:
            while not self.stop.is_set():
                time.sleep(0.5)
        except KeyboardInterrupt:
            log.info("Kapatılıyor…")
            self.stop.set()
            self.engine.shutdown()

    # ------------------------------------------------------------------ senkronizasyon
    def sync_loop(self) -> None:
        interval = self.cfg.get("sync_interval", 2.0)
        while not self.stop.is_set():
            try:
                acc = self.engine.account()
                pos_objs = self.engine.positions() if acc.connected else []
                for p in pos_objs:
                    p.tf = self.tf_of(p)
                positions = [dict(p.to_dict(), market="forex") for p in pos_objs]
                crypto_acc = None
                if self.crypto:
                    cacc = self.crypto.account()
                    crypto_acc = cacc.to_dict()
                    if cacc.connected:
                        cpos = self.crypto.positions()
                        for p in cpos:
                            p.tf = self.tf_of(p)
                        positions += [dict(p.to_dict(), market="crypto") for p in cpos]
                        for p in cpos:
                            self.known_pos[str(p.ticket)] = dict(p.to_dict(), market="crypto")
                        try:
                            self.manage_profit(cpos, engine=self.crypto)
                        except Exception as e:  # noqa: BLE001
                            log.warning("Kripto kâr yönetimi hatası: %s", e)
                if acc.connected:
                    cur = {str(p.ticket) for p in pos_objs}
                    for tk in list(self.known_pos):  # kapanan pozisyonların gerçek K/Z'sini al
                        if tk in cur:
                            continue
                        ds = self.engine.deal_summary(int(tk))
                        self.pos_miss[tk] = self.pos_miss.get(tk, 0) + 1
                        if ds or self.pos_miss[tk] >= 6:
                            if ds:
                                self.closed_buf.append(ds)
                            self.known_pos.pop(tk, None)
                            self.pos_miss.pop(tk, None)
                    for p in pos_objs:
                        self.known_pos[str(p.ticket)] = dict(p.to_dict(), market="forex")
                    self.last_positions = pos_objs
                    try:
                        self.manage_profit(pos_objs)
                    except Exception as e:  # noqa: BLE001
                        log.warning("Kâr yönetimi hatası: %s", e)
                    if not acc.algo and time.time() - self._algo_warn > 300:
                        self._algo_warn = time.time()
                        log.warning("⚠ %s", ALGO_HINT)
                        self.voice_q.put({"say": "Dikkat efendim, MT5'te Algo Trading kapalı. Onaylasanız bile emir gönderemem."})
                with self.lock:
                    out, self.outbox = self.outbox, []
                payload = {"account": acc.to_dict(), "crypto": crypto_acc, "positions": positions, "closed": list(self.closed_buf), "signals": out,
                           "agent": {"version": AGENT_VERSION, "algo": acc.algo, "tradeAllowed": acc.tradeAllowed, "build": acc.build,
                                     "crypto": bool(self.crypto), "cryptoLabel": self.crypto.label if self.crypto else ""}}
                resp = self.dash.sync(payload)
                self.closed_buf = []
                self.handle_sync(resp)
            except requests.RequestException as e:
                code = getattr(getattr(e, "response", None), "status_code", None)
                if code == 401:
                    log.error("Ajan anahtarı GEÇERSİZ (401). Paneldeki Yerel Ajan sayfasındaki anahtarı kullanın: "
                              "CALISTIR.bat --setup  (ya da config.json → agent_key)")
                    time.sleep(10)
                else:
                    log.warning("Panel erişilemedi: %s", e)
            except Exception as e:  # noqa: BLE001
                log.exception("sync hatası: %s", e)
            time.sleep(interval)

    def handle_sync(self, resp: dict) -> None:
        self.rules = [WatchRule.from_dict(r) for r in resp.get("rules", [])]
        self.watch = resp.get("watchlist", [])
        self.kanal = resp.get("kanal") or {}
        self.telegram_cfg = resp.get("telegram") or {}
        if "crypto" in resp:  # eski panel bu alanı göndermez -> mevcut durumu koru
            try:
                self.setup_crypto(resp.get("crypto"))
            except Exception as e:  # noqa: BLE001
                log.warning("Kripto kurulum hatası: %s", e)
        prov = resp.get("provider")
        if prov:
            self.remote_llm = LLMClient.from_dict(prov)
        if self.llm and not self.brain:
            self.brain = JarvisBrain(self.llm)

        # 1) ONAYLI sinyaller -> emir (KESİN KURAL: yalnızca status=approved)
        for s in resp.get("approvedSignals", []):
            if s["id"] in self.executed or s.get("status") != "approved":
                continue
            self.executed.add(s["id"])
            try:
                eng = self.engine_for(s.get("market"), s["symbol"])
            except Exception as e:  # noqa: BLE001
                self.dash.report({"type": "signal", "id": s["id"], "status": "failed", "note": str(e)[:480]})
                continue
            if s.get("market") == "crypto" and str(s.get("reason", "")).startswith("KANAL"):
                ok, note = self._crypto_kanal_guard(s["symbol"], s["side"], s.get("timeframe") or "")
                if not ok:
                    self.dash.report({"type": "signal", "id": s["id"], "status": "blocked", "note": note[:480]})
                    continue
            r = eng.place_order(s["symbol"], s["side"], s["volume"], s.get("sl"), s.get("tp"),
                                        comment=f"JARVIS {s['side']} {s.get('timeframe') or ''} #{s['id']}".replace("  ", " "), approved=True,
                                        signal_price=s.get("price"))
            if r.ok:
                self.remember_tf(s.get("timeframe") or "", r.position, r.ticket)
                log.info("✓ Emir gerçekleşti: %s %s %s lot — %s", s["symbol"], s["side"], s["volume"], r.message)
                self.dash.report({"type": "signal", "id": s["id"], "status": "executed", "ticket": str(r.position or r.ticket),
                                  "note": f"MT5 bilet #{r.position or r.ticket} @ {r.price} · {r.message}"[:480]})
                self.voice_q.put({"say": f"{s['symbol']} {s['side']} emri gerçekleşti efendim. Bilet {r.ticket}."})
            else:
                log.error("✗ Emir reddedildi: %s %s — %s", s["symbol"], s["side"], r.message)
                self.executed.discard(s["id"])  # panelden "Tekrar dene" ile yeniden gönderilebilsin
                self.dash.report({"type": "signal", "id": s["id"], "status": "failed", "note": r.message[:480]})
                short = "MT5'te Algo Trading kapalı. Üstteki Algo Trading düğmesini açın." if r.retcode == 10027 else r.message[:160]
                self.voice_q.put({"say": f"Dikkat efendim, {s['symbol']} emri gönderilemedi. {short}"})

        # 2a) SL/TP değiştirme ve kapatma komutları (panel / sohbet / sesli)
        for c in resp.get("commands", []):
            if c["id"] in self.done_cmds:
                continue
            self.done_cmds.add(c["id"])
            try:
                eng = self.engine_for(c.get("market"), c.get("symbol", ""))
            except Exception as e:  # noqa: BLE001
                self.dash.report({"type": "command", "id": c["id"], "status": "failed", "note": str(e)[:480]})
                continue
            if c.get("type") == "modify":
                r = eng.modify_position(int(c["ticket"]), c.get("sl"), c.get("tp"))
            elif c.get("type") == "close":
                r = eng.close_position(int(c["ticket"]))
            elif c.get("type") == "partial":
                r = eng.close_partial(int(c["ticket"]), float(c.get("fraction") or 0.5))
                if r.ok:
                    self.pt_done.add(str(c["ticket"]))
            else:
                continue
            (log.info if r.ok else log.error)("%s %s #%s -> %s", "✓" if r.ok else "✗", c.get("type"), c.get("ticket"), r.message)
            self.dash.report({"type": "command", "id": c["id"], "status": "done" if r.ok else "failed",
                              "note": (r.message or "")[:480], "sl": c.get("sl"), "tp": c.get("tp")})

        # 2) Kapatma istekleri (eski panel uyumluluğu)
        for t in resp.get("closeTickets", []):
            r = self.engine.close_position(int(t))
            log.info("Kapatma #%s -> %s %s", t, r.ok, r.message)

        # 3) Derleme işleri
        for job in resp.get("compileJobs", []):
            self.compile_q.put(job)

        # 4) Bekleyen sinyaller -> sesli sor
        for s in resp.get("pendingSignals", []):
            if s.get("source") == "manual":  # elle verilen emirlerin onayı panel / sohbette sorulur
                continue
            if s["id"] not in self.asked:
                self.asked.add(s["id"])
                self.voice_q.put({"ask": s})

    # ------------------------------------------------------------------ tarama
    def scan_loop(self) -> None:
        interval = self.cfg.get("scan_interval", 10.0)
        while not self.stop.is_set():
            k = self.kanal
            if k and k.get("enabled", True):
                try:
                    self.kanal_scan(k)
                except Exception as e:  # noqa: BLE001
                    log.exception("KANAL tarama hatası: %s", e)
            else:  # KANAL kapalıysa eski RSI/CCI kural taraması
                for rule in list(self.rules):
                    try:
                        cand = self.engine.analyze(rule)
                        if cand:
                            log.info("⚡ Sinyal: %s %s (%s) %s", cand.symbol, cand.side, cand.confidence, cand.reason)
                            with self.lock:
                                self.outbox.append(cand.to_dict())
                    except Exception as e:  # noqa: BLE001
                        log.warning("%s analiz hatası: %s", rule.symbol, e)
            time.sleep(interval)

    KANAL_LOCK_FILE = "kanal_setup_locks.json"

    def _kanal_lock_path(self) -> Path:
        """Kilit dosyası ortak veri evinde durur: güncelleme/kurulumda kaybolmaz."""
        return P.kanal_lock_file(HOME)

    def _load_kanal_setup_locks(self) -> dict[str, dict]:
        try:
            raw = json.loads(self._kanal_lock_path().read_text(encoding="utf-8"))
            return {str(k): v for k, v in raw.items() if isinstance(v, dict) and v.get("side") in ("BUY", "SELL")}
        except Exception:  # noqa: BLE001
            return {}

    def _save_kanal_setup_locks(self) -> None:
        try:
            path = self._kanal_lock_path()
            path.parent.mkdir(parents=True, exist_ok=True)
            tmp = path.with_suffix(path.suffix + ".tmp")
            tmp.write_text(json.dumps(self.kanal_setup_locks, ensure_ascii=False), encoding="utf-8")
            os.replace(tmp, path)
        except Exception as e:  # noqa: BLE001
            log.warning("KANAL kurulum hafızası diske yazılamadı: %s", e)

    @staticmethod
    def _kanal_lock_key(symbol: str, tf: str) -> str:
        return f"{symbol}|{tf}"

    def _update_kanal_lock(self, res: dict, engine: Any, df: Any) -> None:
        """Açık kurulum kilidini TP/SL veya daha yeni ters M0 oluşunca kapat; RAM ve disk birlikte güncellenir."""
        symbol, tf = res.get("symbol"), res.get("tf")
        key = self._kanal_lock_key(symbol, tf)
        lock = self.kanal_setup_locks.get(key)
        if not lock:
            return
        side = lock.get("side")
        mark = float(res.get("price") or 0)
        try:
            bid, ask = engine.tick(symbol)
            mark = bid if side == "BUY" else ask
        except Exception:  # noqa: BLE001
            pass
        tp, sl = float(lock.get("tp") or 0), float(lock.get("sl") or 0)
        live_hi = live_lo = mark
        try:
            last_bar = df.iloc[-1]
            bar_open = _epoch_utc(last_bar["time"])
            # Aynı barın geçmiş high/low'u sinyal anından önce oluşmuş olabilir; yalnızca kilitten sonra başlayan barları say.
            if bar_open > float(lock.get("createdAt") or 0):
                live_hi, live_lo = float(last_bar["high"]), float(last_bar["low"])
        except Exception:  # noqa: BLE001
            pass
        touched = ((mark >= tp or live_hi >= tp or mark <= sl or live_lo <= sl) if side == "BUY"
                   else (mark <= tp or live_lo <= tp or mark >= sl or live_hi >= sl))
        opposite = "SELL" if side == "BUY" else "BUY"
        reverse = res.get("setupStates", {}).get(opposite, {})
        reverse_m0 = (reverse.get("brk") and reverse.get("ext")
                      and int(reverse.get("setupTime") or 0) > int(lock.get("setupTime") or 0))
        if touched or reverse_m0:
            self.kanal_setup_locks.pop(key, None)
            self._fired.pop((symbol, tf, side), None)
            self._save_kanal_setup_locks()
            return
        res["fire"] = False
        res["armed"] = False
        res["blockedReason"] = "Kurulum zaten kullanıldı; merkez TP, SL veya ters M0 sıfırlaması bekleniyor"

    def _activate_kanal_lock(self, res: dict, entry: float, sl: float, tp: float) -> None:
        key = self._kanal_lock_key(res["symbol"], res["tf"])
        self.kanal_setup_locks[key] = {
            "side": res["side"], "setupTime": int(res["setupTime"]),
            "entry": float(entry), "sl": float(sl), "tp": float(tp), "createdAt": int(time.time()),
        }
        self._save_kanal_setup_locks()

    def kanal_scan(self, k: dict) -> None:
        """KANAL 5 aşamalı sıralı strateji — Piyasa Gözlemi paritelerinde setup TTL ve R:R ile tarama."""
        params = KanalParams.from_dict(k.get("params"))
        tfs = [t.strip() for t in str(k.get("timeframes", "M15,H1")).split(",") if t.strip() in KANAL_TFS and t.strip() in TIMEFRAMES]
        if not tfs:
            return
        mode = k.get("scanMode") or ("marketwatch" if k.get("scanAll") else "list")
        if mode == "marketwatch":
            symbols = [(x, "forex") for x in self.engine.market_watch_symbols()]
            if self.crypto:
                symbols += [(x, "crypto") for x in self.crypto.market_watch_symbols(limit=30)]
        else:  # takip listem (boşsa izleme kurallarındaki pariteler)
            raw = [str(x) for x in (k.get("symbols") or [])] or sorted({r.symbol for r in self.rules})
            symbols = [(x, "crypto" if (self.crypto and is_crypto_symbol(x, self.crypto.known)) else "forex") for x in raw]
            symbols += [(norm_crypto(x), "crypto") for x in (k.get("cryptoSymbols") or []) if self.crypto]
        lot = float(k.get("lot", 0.1))
        self.scan_symbols = [x for x, _ in symbols]
        items: list[dict] = []
        market_quality: dict[str, dict] = {}
        for sym, market in symbols:
            eng = self.crypto if market == "crypto" else self.engine
            if eng is None:
                continue
            q = None
            if market == "crypto":
                try:
                    q = eng.kanal_market_quality(sym)
                    market_quality[sym] = q
                    # Düşük hacimli veya borsanın minimum emri konfigüre edilmiş emir tutarını aşan semboller radardan gizlenir.
                    if float(q.get("quoteVolume24h") or 0) < params.cryptoMinVolume24h or float(q.get("orderNotional") or 0) < float(q.get("minNotional") or 0):
                        for lock_tf in tfs:
                            self._update_kanal_lock({"symbol": sym, "tf": lock_tf, "price": 0}, eng, None)
                        continue
                except Exception as e:  # noqa: BLE001
                    market_quality[sym] = {"error": str(e)[:140]}
                    log.debug("Kripto kalite verisi %s: %s", sym, e)
            else:
                q = None
            for tf in tfs:
                try:
                    df = eng.rates(sym, tf, 320)
                    res = kanal_analyze(sym, tf, df, params)
                except Exception as e:  # noqa: BLE001
                    self.feed_errors[f"{sym} {tf}"] = str(e)[:140]
                    log.debug("%s %s taranamadı: %s", sym, tf, e)
                    continue
                self.feed_errors.pop(f"{sym} {tf}", None)
                if res is None:
                    continue
                res["market"] = market
                if market == "crypto":
                    res["spreadPct"] = q.get("spreadPct") if q else None
                    res["fundingRate"] = q.get("fundingRate") if q else None
                    if res.get("fire"):
                        quality = None
                        seconds = {"M3": 180, "M5": 300, "M15": 900, "H1": 3600}.get(tf, 900)
                        if not q or q.get("error"):
                            quality = "Kripto piyasa kalitesi doğrulanamadı — sinyal askıya alındı"
                        elif not q.get("bookOk") or q.get("spreadPct") is None:
                            quality = "Order-book spread verisi yok — sinyal askıya alındı"
                        elif float(q["spreadPct"]) > params.cryptoSpreadMaxPct:
                            quality = f"Order-book spread %{q['spreadPct']:.3f} > %{params.cryptoSpreadMaxPct:g}"
                        elif q.get("quoteAgeSeconds") is None or float(q["quoteAgeSeconds"]) > 30:
                            quality = "Bayat kripto ticker — sinyal askıya alındı"
                        else:
                            closed_at = df["time"].iloc[-2]
                            if time.time() - (_epoch_utc(closed_at) + seconds) > seconds * 2:
                                quality = "Gecikmiş kripto mum verisi — sinyal askıya alındı"
                        if quality:
                            res["fire"] = False
                            res["armed"] = False
                            res["blockedReason"] = quality
                            res["reason"] = (res.get("reason", "") + " · " + quality).strip(" ·")
                if res.get("fire") and market == "forex" and not getattr(eng, "simulate", False):
                    # MT5 canlı kalite kapısı: güncel spread <= 2.5× son 20 kapanmış mum ortalaması,
                    # mum/tick bayatsa sinyali askıya al. Spread dizisi MT5 point cinsindedir.
                    quality = None
                    seconds = {"M3": 180, "M5": 300, "M15": 900, "H1": 3600}.get(tf, 900)
                    try:
                        quote = (eng.quotes([sym]) or [None])[0]
                        if quote is None or time.time() - float(quote.get("t", 0)) > max(30, seconds * 2):
                            quality = "Bayat MT5 fiyatı — sinyal askıya alındı"
                        elif len(df) < 22 or "spread" not in df.columns:
                            quality = "20 mum spread verisi yok — sinyal askıya alındı"
                        else:
                            real_symbol = eng.resolve_symbol(sym)
                            point = float((eng._spec(real_symbol) or {}).get("point", 0))
                            avg_points = float(df["spread"].iloc[-21:-1].mean())
                            bid_now, ask_now = eng.tick(sym)
                            if point <= 0 or avg_points <= 0:
                                quality = "Geçerli spread ölçümü yok — sinyal askıya alındı"
                            elif ask_now - bid_now > 2.5 * avg_points * point:
                                quality = "Güncel MT5 spread'i 20 mum ortalamasının 2.5 katını aşıyor"
                        closed_at = df["time"].iloc[-2]
                        closed_epoch = _epoch_utc(closed_at)
                        if quality is None and time.time() - (closed_epoch + seconds) > seconds * 2:
                            quality = "Gecikmiş mum verisi — sinyal askıya alındı"
                    except Exception as e:  # noqa: BLE001
                        quality = f"Spread/fiyat kalitesi doğrulanamadı: {str(e)[:100]}"
                    if quality:
                        res["fire"] = False
                        res["armed"] = False
                        res["blockedReason"] = quality
                        res["reason"] = (res.get("reason", "") + " · " + quality).strip(" ·")
                self._update_kanal_lock(res, eng, df)
                items.append(res)
        tf_rank = {"M3": 3, "M5": 5, "M15": 15, "H1": 60}
        # Tüm TF'ler tarandıktan sonra çatışmayı denetle: alt TF sinyali üst TF'nin tersine emir açamaz.
        for res in items:
            if not res.get("fire") or not res.get("side"):
                continue
            sym, tf, market = res["symbol"], res["tf"], res.get("market", "forex")
            eng = self.crypto if market == "crypto" else self.engine
            if eng is None:
                continue
            setup_id = res.get("setupTime")
            key = (sym, tf, res["side"])
            if setup_id is None or self._fired.get(key) == setup_id:
                continue  # aynı M0 kurulumu içinden ikinci sinyal/emir yok
            self._fired[key] = setup_id
            other_tfs = [x for x in items if x["symbol"] == sym and x["tf"] != tf and x.get("side") and x.get("armed")]
            higher = [x for x in other_tfs if tf_rank.get(x["tf"], 0) > tf_rank.get(tf, 0)]
            conflict = any(x["side"] != res["side"] for x in other_tfs)
            aligned_bonus = 10 if any(x["side"] == res["side"] for x in higher) else 0
            try:  # sinyal TF'sinin merkez çizgisi + kurulum ekstremi + güncel fiyat
                bid, ask = eng.tick(sym)
                entry = ask if res["side"] == "BUY" else bid
                sl, tp = kanal_levels(res["side"], entry, res["extreme"], res["center"], res["atr"], params)
                tp = res["center"]
                conf = kanal_confidence(res["side"], res["depth"], res["rsiPeak"], res["cci"], res["cciMa"], entry, sl, tp, params)["score"]
            except Exception:  # noqa: BLE001
                entry, sl, tp, conf = res["entry"], res["sl"], res["tp"], res.get("confidence", 0)
            conf = min(99, int(conf) + aligned_bonus)
            btc_note = None
            if market == "crypto" and sym not in {"BTCUSDT", "BTC/USDT"}:
                try:
                    btc_df = eng.rates("BTCUSDT", "M15", 320)
                    btc = kanal_analyze("BTCUSDT", "M15", btc_df, params)
                    if btc and btc.get("rsi") is not None and btc.get("center") is not None:
                        btc_favorable = (btc["rsi"] > 50 or btc["price"] > btc["center"]) if res["side"] == "BUY" else (btc["rsi"] < 50 or btc["price"] < btc["center"])
                        conf = min(99, conf + 10) if btc_favorable else int(conf * 0.75)
                        btc_note = "uyumlu +10" if btc_favorable else "ters trend -%25"
                        res["btcTrend"] = btc_note
                        res["confidence"] = conf
                except Exception as e:  # noqa: BLE001
                    log.debug("BTC M15 trend filtresi alınamadı: %s", e)
            if market == "crypto":
                funding = market_quality.get(sym, {}).get("fundingRate")
                threshold = float(params.fundingPenaltyThresholdPct) / 100.0
                funding_adverse = funding is not None and ((res["side"] == "BUY" and float(funding) >= threshold)
                                                            or (res["side"] == "SELL" and float(funding) <= -threshold))
                if funding_adverse:
                    conf = int(conf * 0.85)
                    res["fundingPenalty"] = 15
                    res["confidence"] = conf
            if (abs(entry - sl) <= 0 or abs(tp - entry) / abs(entry - sl) < 1.0
                    or (res["side"] == "BUY" and (sl >= entry or tp <= entry))
                    or (res["side"] == "SELL" and (sl <= entry or tp >= entry))):
                log.info("⛔ KANAL R:R < 1:1 — sinyal bloke: %s %s", sym, tf)
                continue
            if not conflict and res.get("setupTime") is not None:
                self._activate_kanal_lock(res, entry, sl, tp)
            digits = 2 if entry > 1000 else 3 if entry > 50 else 5 if entry > 0.5 else 6
            cand = SignalCandidate(
                symbol=sym, side=res["side"], timeframe=tf, price=round(entry, digits), sl=round(sl, digits),
                tp=round(tp, digits), volume=lot, reason="KANAL: " + res["reason"], confidence=int(conf),
                indicators={"RSI": round(res["rsi"] or 0, 1), "CCI": round(res["cci"] or 0, 1),
                            "CCI_MA": round(res["cciMa"] or 0, 1), ("RSI dip" if res["side"] == "BUY" else "RSI tepe"): round(res["rsiPeak"] or 0, 1),
                            "bant dışı (ATR)": round(res["depth"], 2), "R:R": round(abs(tp-entry)/abs(entry-sl), 2),
                            "üst TF uyumu": aligned_bonus, **({"BTC M15 trend": btc_note} if btc_note else {}),
                            **({"Funding cezası (%)": 15} if res.get("fundingPenalty") else {})},
            )
            d = cand.to_dict()
            d["market"] = market
            auto = k.get("auto") or {}
            if conflict:
                d.update(auto=True, status="blocked", note="Üst zaman diliminde ters yönlü KANAL sinyali var; emir kilitlendi.")
                log.info("🔒 TF çakışması, emir kilitli: %s %s %s", sym, tf, res["side"])
            elif auto.get("enabled") and conf >= int(auto.get("minConf", 80)):
                status, note = self.auto_execute(cand, auto, market=market)
                d.update(auto=True, status=status, note=note)
                log.info("🤖 OTOMATİK %s: %s %s %s güven %%%s — %s", status, sym, tf, res["side"], conf, note)
                side_tr = "alış" if res["side"] == "BUY" else "satış"
                mk = "kripto" if market == "crypto" else "forex"
                if status == "executed":
                    self.voice_q.put({"say": f"Efendim, {mk} {sym} {tf} {side_tr} işlemine otomatik girdim. Güven yüzde {conf}."})
                elif status == "failed":
                    self.voice_q.put({"say": f"Dikkat efendim, {sym} otomatik {side_tr} emri gönderilemedi. {note[:120]}"})
            else:
                log.info("⚡ KANAL sinyal: %s %s %s güven %%%s — %s", sym, tf, res["side"], conf, res["reason"])
            with self.lock:
                self.outbox.append(d)
        self.dash.market({"scan": items, "watch": [x for x, _ in symbols]})

    # ------------------------------------------------------------------ otomatik işlem
    def _crypto_kanal_guard(self, symbol: str, side: str, tf: str) -> tuple[bool, str]:
        if not self.crypto:
            return False, "Kripto bağlantısı yok; KANAL emri gönderilmedi."
        params = KanalParams.from_dict((self.kanal or {}).get("params"))
        try:
            q = self.crypto.kanal_market_quality(symbol, cache_seconds=0)
            if float(q.get("quoteVolume24h") or 0) < params.cryptoMinVolume24h:
                return False, f"24s hacim {q.get('quoteVolume24h', 0):,.0f} USDT, taban {params.cryptoMinVolume24h:,.0f} altında."
            if float(q.get("orderNotional") or 0) < float(q.get("minNotional") or 0):
                return False, "Emir notional'ı borsanın minimum sembol limitinin altında."
            if not q.get("bookOk") or q.get("spreadPct") is None or float(q["spreadPct"]) > params.cryptoSpreadMaxPct:
                return False, f"Order-book spread limiti aşıldı/yok (%{q.get('spreadPct')})."
            if q.get("quoteAgeSeconds") is None or float(q["quoteAgeSeconds"]) > 30:
                return False, "Ticker bayat; emir askıya alındı."
            secs = {"M3": 180, "M5": 300, "M15": 900, "H1": 3600}.get(tf, 900)
            bars = self.crypto.rates(symbol, tf, 3)
            closed_at = bars["time"].iloc[-2]
            if time.time() - (_epoch_utc(closed_at) + secs) > secs * 2:
                return False, "Kapanmış mum verisi gecikmiş; emir askıya alındı."
            funding = q.get("fundingRate")
            threshold = params.fundingPenaltyThresholdPct / 100.0
            if funding is not None and ((side == "BUY" and float(funding) >= threshold) or (side == "SELL" and float(funding) <= -threshold)):
                return True, f"Uyarı: funding %{float(funding)*100:.3f}; güven puanına %15 ceza uygulanmış olmalı."
            return True, ""
        except Exception as e:  # noqa: BLE001
            return False, f"Kripto kalite doğrulaması başarısız: {str(e)[:160]}"

    def auto_execute(self, cand: SignalCandidate, auto: dict, market: str = "forex") -> tuple[str, str]:
        """Kullanıcının panelde AÇTIĞI otomatik işlem modu: onay sormadan emir gönderir.
        Güvenlik: aynı sembolde açık pozisyon varsa atlar · en fazla `maxPositions` otomatik pozisyon."""
        if market == "crypto" and str(cand.reason).startswith("KANAL"):
            ok, note = self._crypto_kanal_guard(cand.symbol, cand.side, cand.timeframe)
            if not ok:
                return "skipped", note
        try:
            eng = self.engine_for(market, cand.symbol)
            positions = eng.positions()
        except Exception as e:  # noqa: BLE001
            return "failed", f"Pozisyonlar okunamadı: {e}"
        real = eng.resolve_symbol(cand.symbol) if hasattr(eng, "resolve_symbol") else cand.symbol
        if any(p.symbol == real or p.symbol == cand.symbol for p in positions):
            return "skipped", f"Atlandı: {cand.symbol} üzerinde zaten açık pozisyon var"
        n_auto = sum(1 for p in positions if p.magic == self.auto_magic)
        mx = int(auto.get("maxPositions", 3))
        if n_auto >= mx:
            return "skipped", f"Atlandı: otomatik pozisyon limiti dolu ({n_auto}/{mx})"
        r = eng.place_order(cand.symbol, cand.side, cand.volume, cand.sl, cand.tp,
                            comment=f"JARVIS AUTO {cand.timeframe}", approved=True,  # onay = kullanıcının açtığı oto-mod
                            signal_price=cand.price, magic=self.auto_magic)
        if r.ok:
            self.remember_tf(cand.timeframe, r.position, r.ticket)
            return "executed", f"OTOMATİK · MT5 bilet #{r.position or r.ticket} @ {r.price} · {r.message}"[:480]
        return "failed", (r.message or "Emir reddedildi")[:480]

    def manage_profit(self, positions: list, engine: Any = None) -> None:
        """Kâr yönetimi (TP yoluna göre):
           • %beAtPct (varsayılan 30) kâra geçince SL'yi giriş fiyatına çeker
           • %partialAtPct (varsayılan 50) kâra geçince pozisyonun %partialPct'ini (varsayılan yarısını) kapatır
           JARVIS'in açtığı işlemlere (sinyal onayı, hızlı emir, otomatik) her zaman; "tüm işlemlerime uygula" açıksa hepsine."""
        auto = (self.kanal or {}).get("auto") or {}
        be_pct = float(auto.get("beAtPct", 30))
        pt_pct = float(auto.get("partialAtPct", 50))
        pt_frac = float(auto.get("partialPct", 50)) / 100.0
        if be_pct <= 0 and pt_pct <= 0:
            return
        eng = engine or self.engine
        mine = {int(self.engine.magic), int(self.auto_magic)}
        now = time.time()
        live = {str(p.ticket) for p in positions}
        for st in (self.be_state, self.pt_state):
            for tk in list(st):
                if tk not in live:
                    st.pop(tk, None)
        for p in positions:
            tk = str(p.ticket)
            if not auto.get("beAll") and p.magic not in mine:
                continue
            if not p.tp or p.tp <= 0:
                continue
            buy = p.side == "BUY"
            dist = (p.tp - p.openPrice) if buy else (p.openPrice - p.tp)
            if dist <= 0:
                continue
            prog = ((p.currentPrice - p.openPrice) if buy else (p.openPrice - p.currentPrice)) / dist * 100

            # --- 1) SL girişe
            at_be = p.sl > 0 and ((p.sl >= p.openPrice) if buy else (p.sl <= p.openPrice))
            if be_pct > 0 and prog >= be_pct and not at_be:
                tries, last = self.be_state.get(tk, (0, 0.0))
                if tries < 5 and now - last >= 20:
                    r = eng.modify_position(int(p.ticket), sl=p.openPrice)
                    self.be_state[tk] = (tries + 1, now)
                    if r.ok:
                        msg = f"{p.symbol} #{p.ticket}: fiyat TP yolunun %{prog:.0f}'ine ulaştı, SL girişe ({p.openPrice}) çekildi."
                        log.info("🛡 %s", msg)
                        self.dash.report({"type": "message", "role": "assistant", "content": "🛡 " + msg})
                        self.voice_q.put({"say": f"{p.symbol} işleminde stop girişe çekildi efendim."})
                        self.be_state[tk] = (99, now)
                    else:
                        log.warning("SL girişe çekilemedi %s #%s: %s", p.symbol, p.ticket, r.message)

            # --- 2) Yarı kâr al
            if pt_pct > 0 and prog >= pt_pct and tk not in self.pt_done:
                if tk not in self.pt_checked:  # yeniden başlatma: daha önce kısmi kapandı mı?
                    self.pt_checked.add(tk)
                    if eng.partial_done(int(p.ticket)):
                        self.pt_done.add(tk)
                        continue
                tries, last = self.pt_state.get(tk, (0, 0.0))
                if tries >= 3 or now - last < 20:
                    continue
                r = eng.close_partial(int(p.ticket), pt_frac)
                self.pt_state[tk] = (tries + 1, now)
                if r.ok:
                    self.pt_done.add(tk)
                    msg = f"{p.symbol} #{p.ticket}: fiyat TP yolunun %{prog:.0f}'ine ulaştı, yarı kâr alındı — {r.message}."
                    log.info("💰 %s", msg)
                    self.dash.report({"type": "message", "role": "assistant", "content": "💰 " + msg})
                    self.voice_q.put({"say": f"{p.symbol} işleminde yarı kâr alındı efendim."})
                elif r.retcode == 10014:  # lot bölünemiyor -> tekrar deneme
                    self.pt_done.add(tk)
                    log.info("Yarı kâr atlandı %s #%s: %s", p.symbol, p.ticket, r.message)
                else:
                    log.warning("Yarı kâr alınamadı %s #%s: %s", p.symbol, p.ticket, r.message)

    # geriye dönük uyumluluk
    manage_breakeven = manage_profit

    # ------------------------------------------------------------------ telegram
    def telegram_loop(self) -> None:
        """Paneldeki Telegram ayarı açıksa botun düğmelerini dinler (✅ Evet / ❌ Hayır / 🔕 sessiz).
        Düğme tıklamalarını panele iletir; işlem kuralları panelde uygulanır (onay = kullanıcının onayı)."""
        while not self.stop.is_set():
            try:
                cfg = self.telegram_cfg or {}
                if not cfg.get("enabled") or not cfg.get("botToken") or not cfg.get("chatId"):
                    self.tg_offset = 0
                    time.sleep(3)
                    continue
                res = requests.post(
                    f"https://api.telegram.org/bot{cfg['botToken']}/getUpdates",
                    json={"offset": self.tg_offset, "timeout": 25, "allowed_updates": ["callback_query", "message"]},
                    timeout=40,
                ).json()
                if not res.get("ok"):
                    self.tg_errors += 1
                    time.sleep(min(30, 5 * self.tg_errors))
                    continue
                self.tg_errors = 0
                for up in res.get("result", []):
                    self.tg_offset = up["update_id"] + 1
                    cq = up.get("callback_query")
                    if not cq:
                        continue
                    data = cq.get("data") or ""
                    # yalnızca bildirimi giden chat'ten gelen düğmelere yanıt ver
                    if str(cq.get("message", {}).get("chat", {}).get("id")) != str(cfg.get("chatId")):
                        continue
                    try:
                        out = self.dash.telegram(data, cq.get("id"))
                        log.info("✈ Telegram: %s -> %s", data, out.get("note", out.get("error", "")))
                    except Exception as e:  # noqa: BLE001
                        log.warning("Telegram eylemi başarısız (%s): %s", data, e)
            except requests.RequestException:
                time.sleep(10)
            except Exception as e:  # noqa: BLE001
                self.tg_errors += 1
                log.warning("Telegram dinleyici hatası (%d): %s", self.tg_errors, e)
                time.sleep(min(60, 10 * self.tg_errors))

    # ------------------------------------------------------------------ piyasa verisi (panel grafiği, RSI/CCI radarı)
    def market_loop(self) -> None:
        interval = self.cfg.get("market_interval", 6.0)
        last_log = 0.0
        while not self.stop.is_set():
            series: list[dict] = []
            for w in list(self.watch):
                key = f"{w.get('symbol')} {w.get('timeframe')}"
                try:
                    eng = self.engine_for(w.get("market"), w["symbol"])
                    series.append(eng.market_snapshot(w["symbol"], w["timeframe"], 320))
                    self.feed_errors.pop(key, None)
                except Exception as e:  # noqa: BLE001
                    self.feed_errors[key] = str(e)[:140]
                    log.debug("%s verisi alınamadı: %s", key, e)
            mw = None
            if time.time() - self._mw_sent > 60:
                try:
                    mw = self.engine.market_watch_symbols(limit=500)
                    self._mw_sent = time.time()
                except Exception:  # noqa: BLE001
                    mw = None
            if series or self.feed_errors or mw:
                try:
                    ping = self.engine.account().ping
                except Exception:  # noqa: BLE001
                    ping = 0.0
                payload = {"series": series, "ping": ping, "feed": {"errors": list(self.feed_errors.items())[:20], "ok": len(series)}}
                if mw:
                    payload["mw"] = mw
                if self.crypto and time.time() - getattr(self, "_cmw_sent", 0.0) > 120:
                    try:
                        payload["cryptoMw"] = self.crypto.market_watch_symbols(limit=60)
                        self._cmw_sent = time.time()
                    except Exception:  # noqa: BLE001
                        pass
                self.dash.market(payload)
            if time.time() - last_log > 60:
                last_log = time.time()
                log.info("Veri akışı: %d seri gönderildi, %d hata%s", len(series), len(self.feed_errors),
                         (" → " + "; ".join(f"{k}: {v}" for k, v in list(self.feed_errors.items())[:3])) if self.feed_errors else "")
            time.sleep(interval)

    def quote_symbols(self) -> tuple[list[str], list[str]]:
        """(forex sembolleri, kripto sembolleri) — izleme listesi + açık pozisyonlar + taranan pariteler."""
        fx: set[str] = set()
        cr: set[str] = set()
        for w in self.watch:
            (cr if w.get("market") == "crypto" else fx).add(w["symbol"])
        for p in self.known_pos.values():
            (cr if p.get("market") == "crypto" else fx).add(p["symbol"])
        for x in self.scan_symbols[:40]:
            (cr if (self.crypto and is_crypto_symbol(x, self.crypto.known) and x not in fx) else fx).add(x)
        k = self.kanal or {}
        for x in (k.get("cryptoSymbols") or []):
            cr.add(norm_crypto(str(x)))
        if not self.crypto:
            cr = set()
        return sorted(fx)[:80], sorted(cr)[:60]

    def quote_loop(self) -> None:
        """Canlı fiyat akışı: her saniye bid/ask (grafik ve fiyat listesi bununla akar)."""
        interval = self.cfg.get("quote_interval", 1.0)
        while not self.stop.is_set():
            try:
                fnames, cnames = self.quote_symbols()
                q = self.engine.quotes(fnames) if fnames else []
                if cnames and self.crypto:
                    q += self.crypto.quotes(cnames)
                if q:
                    self.dash.ticks({"ticks": q})
            except Exception as e:  # noqa: BLE001
                log.debug("quote hatası: %s", e)
            time.sleep(interval)

    # ------------------------------------------------------------------ derleme
    def compile_worker(self) -> None:
        while not self.stop.is_set():
            job = self.compile_q.get()
            path = job["filePath"]
            lines: list[str] = []
            try:
                self.compiler.write(path, job["code"])
                rep = self.compiler.auto_fix(
                    path, self.llm if job.get("autoFix", True) else None,
                    max_attempts=job.get("maxAttempts", 5), on_progress=lambda s: lines.append(s),
                )
                self.dash.report({
                    "type": "compile", "jobId": job["jobId"], "status": "success" if rep.success else "failed",
                    "errors": len(rep.final.errors), "warnings": len(rep.final.warnings), "attempt": rep.attempts,
                    "log": rep.log + ("\n\n--- MetaEditor ---\n" + rep.final.log[-3000:] if rep.final.log else ""),
                    "code": rep.code,
                })
                msg = (f"{job['name']} başarıyla derlendi efendim." if rep.success
                       else f"{job['name']} derlemesi {rep.attempts} denemeye rağmen başarısız. Logları inceleyin.")
                self.voice_q.put({"say": msg})
            except Exception as e:  # noqa: BLE001
                log.exception("Derleme hatası")
                self.dash.report({"type": "compile", "jobId": job["jobId"], "status": "failed", "errors": 1,
                                  "log": "\n".join(lines) + f"\nAjan hatası: {e}"})

    # ------------------------------------------------------------------ ses
    def ask_signal(self, s: dict) -> None:
        sym = s["symbol"]
        side = "alış" if s["side"] == "BUY" else "satış"
        q = (f"Efendim, {sym} paritesinde {s['side']} yani {side} fırsatı oluştu. {s.get('reason', '')}. "
             f"Güven yüzde {s.get('confidence', 0)}. İşleme gireyim mi?")
        for attempt in range(2):
            self.speak(q if attempt == 0 else "Anlayamadım efendim. Evet mi, hayır mı?")
            ans = self.listen(max_seconds=5, start_timeout=7)
            if ans:
                self.dash.report({"type": "message", "role": "user", "content": f"🎙 {ans}"})
            if is_yes(ans):
                self.dash.report({"type": "decision", "signalId": s["id"], "approve": True})
                self.speak("Onay alındı. Emri gönderiyorum.")
                return
            if is_no(ans):
                self.dash.report({"type": "decision", "signalId": s["id"], "approve": False})
                self.speak("Anlaşıldı, fırsatı pas geçiyorum.")
                return
        # Belirsiz -> işlem AÇILMAZ, panelde beklemeye devam eder
        self.speak("Onay alamadım. Sinyal panelde onayınızı bekliyor.")

    def voice_loop(self) -> None:
        """Ses döngüsü: hata olursa ÇÖKMEZ — kaydeder, bekler, devam eder. Üst üste 5 hatada dinlemeyi kapatır
        (onaylar panelden verilir, sesli yanıtlar sürer). Ajanın geri kalanı (MT5, emirler) her durumda çalışır."""
        wake = self.cfg.get("voice", {}).get("wake_word", "jarvis")
        fails = 0
        while not self.stop.is_set():
            try:
                try:
                    task = self.voice_q.get(timeout=0.2)
                    if "ask" in task:
                        self.ask_signal(task["ask"])
                    elif "say" in task:
                        self.speak(task["say"])
                    fails = 0
                    continue
                except queue.Empty:
                    pass
                if not self.stt:
                    time.sleep(0.3)
                    continue
                # Uyandırma kelimesi dinleme
                heard = self.listen(max_seconds=6, start_timeout=3, silence_sec=0.7)
                fails = 0
                if not heard or not has_wake_word(heard, wake):
                    continue
                cmd = heard.lower().split(wake, 1)[-1].strip(" ,.")
                if not cmd:
                    self.speak("Buyurun efendim.")
                    cmd = self.listen(max_seconds=10)
                if cmd:
                    self.handle_command(cmd)
            except Exception as e:  # noqa: BLE001
                fails += 1
                log.error("Ses döngüsü hatası (%d/5): %s", fails, e)
                if fails >= 5 and self.stt is not None:
                    self.stt = None
                    log.error("Mikrofon / ses tanıma devre dışı bırakıldı. Onayları panelden verin; sesli yanıtlar devam eder. "
                              "(Sessiz başlatmak için: CALISTIR.bat --no-voice)")
                    try:
                        self.speak("Ses tanımada sorun var efendim. Onayları panelden verebilirsiniz.")
                    except Exception:  # noqa: BLE001
                        pass
                time.sleep(min(10, 2 * fails))

    def handle_command(self, cmd: str) -> None:
        """Sesli komut -> paneldeki komut işleyici. Emir/kapatma onayı gerekiyorsa sesli 'Evet' beklenir."""
        try:
            out = self.dash.command(cmd)
        except Exception as e:  # noqa: BLE001
            log.warning("Panel komutu işleyemedi (%s) — yerel yanıt", e)
            if self.brain:
                self.speak(self.brain.ask(cmd))
            else:
                self.speak("Panele ulaşamıyorum efendim.")
            return
        self.speak(out.get("reply", ""))
        if out.get("action") in ("order_pending", "confirm_close_all"):
            ans = self.listen(max_seconds=5, start_timeout=7)
            if is_yes(ans):
                self.speak(self.dash.command("evet").get("reply", ""))
            elif is_no(ans):
                self.speak(self.dash.command("hayır").get("reply", ""))
            else:
                self.speak("Onay alamadım efendim. Emir gönderilmedi; panelden onaylayabilirsiniz.")


# --------------------------------------------------------------------------- #
def load_config(path: Path) -> dict:
    if not path.exists():
        ex = ROOT / "config.example.json"
        log.error("config.json bulunamadı. '%s' dosyasını kopyalayıp düzenleyin.", ex)
        sys.exit(1)
    return json.loads(path.read_text(encoding="utf-8"))


def main(argv: Optional[list[str]] = None) -> None:
    ap = argparse.ArgumentParser(description="JARVIS yerel ajan")
    ap.add_argument("--config", default=str(ROOT / "config.json"))
    ap.add_argument("--no-voice", action="store_true")
    ap.add_argument("--simulate", action="store_true", help="MT5 olmadan simülasyon")
    ap.add_argument("--test-compile", metavar="MQ5")
    ap.add_argument("--no-update", action="store_true", help="uygulama içi güncellemeyi atla")
    ap.add_argument("-v", "--verbose", action="store_true")
    a = ap.parse_args(argv)
    logs = P.logs_dir(P.ensure_dirs(HOME))
    handlers: list[logging.Handler] = [
        logging.FileHandler(logs / f"ajan_{time.strftime('%Y%m%d')}.log", encoding="utf-8")
    ]
    logging.basicConfig(level=logging.DEBUG if a.verbose else logging.INFO,
                        format="%(asctime)s │ %(name)-12s │ %(levelname)-7s │ %(message)s",
                        datefmt="%H:%M:%S", handlers=handlers)
    cfg = load_config(Path(a.config))

    if a.test_compile:
        comp = MQL5Compiler(cfg["metaeditor_path"], cfg["mql5_dir"], wine=cfg.get("wine", False))
        llm = LLMClient.from_dict(cfg["llm"]) if cfg.get("llm") else None
        rep = comp.auto_fix(a.test_compile, llm)
        print(rep.log)
        sys.exit(0 if rep.success else 1)

    Jarvis(cfg, voice=not a.no_voice and cfg.get("voice", {}).get("enabled", True), simulate=a.simulate).start()


if __name__ == "__main__":
    main()
