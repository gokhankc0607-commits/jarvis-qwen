"""
mt5_engine.py — JARVIS MetaTrader 5 motoru
==========================================
* MT5 terminaline bağlanır (resmi `MetaTrader5` Python paketi, Windows).
* Canlı fiyat / mum verisi çeker.
* RSI (Wilder), CCI, Stochastic, ATR hesaplar; fiyat–RSI uyumsuzluklarını tespit eder.
* İzleme kurallarına göre sinyal adayı üretir.
* KESİN KURAL: `place_order` yalnızca kullanıcı tarafından onaylanmış bir sinyal ile çağrılmalıdır.
  Motor kendi kendine asla emir açmaz; app.py onay akışını yönetir.

MT5 olmayan ortamlarda (Linux/Mac test) `simulate=True` ile rastgele yürüyüş verisi üretir.
"""
from __future__ import annotations

import difflib
import functools
import re
import logging
import math
import random
import threading
import time
from dataclasses import dataclass, field, asdict
from typing import Any, Optional

import numpy as np
import pandas as pd

try:  # Windows'ta MT5 terminali ile birlikte çalışır
    import MetaTrader5 as mt5  # type: ignore
except Exception:  # pragma: no cover
    mt5 = None

log = logging.getLogger("jarvis.mt5")

TIMEFRAMES = {
    "M1": 1, "M3": 3, "M5": 5, "M15": 15, "M30": 30, "H1": 60, "H4": 240, "D1": 1440,
}


def _locked(fn):
    """MetaTrader5 Python paketi iş parçacığı güvenli değildir: tüm MT5 çağrıları tek kilitle sıralanır."""
    @functools.wraps(fn)
    def wrapper(self, *a, **k):
        with self._lock:
            return fn(self, *a, **k)
    return wrapper


ALGO_HINT = ("MT5'te Algo Trading KAPALI. Üst araç çubuğundaki 'Algo Trading' düğmesini yeşil yapın ve "
             "Araçlar > Seçenekler > Uzman Danışmanlar > 'Algoritmik ticarete izin ver' kutusunu işaretleyin.")

RETCODES = {
    10004: "Requote (fiyat değişti)", 10006: "Emir broker tarafından reddedildi", 10007: "Emir iptal edildi",
    10013: "Geçersiz istek", 10014: "Geçersiz lot miktarı", 10015: "Geçersiz fiyat",
    10016: "Geçersiz SL/TP (fiyata çok yakın ya da yanlış tarafta)", 10017: "Bu sembolde işlem kapalı",
    10018: "Piyasa kapalı", 10019: "Yetersiz teminat", 10020: "Fiyat değişti", 10021: "Fiyat akışı yok",
    10024: "Çok sık istek gönderildi", 10027: ALGO_HINT, 10028: "Sunucu tarafında algoritmik işlem kapalı",
    10025: "Değişiklik yok (SL/TP zaten bu değerde)", 10030: "Doldurma modu desteklenmiyor", 10031: "Sunucuya bağlantı yok", 10033: "Bekleyen emir limiti doldu",
    10034: "Lot limiti doldu", 10040: "Açık pozisyon sayısı limiti doldu",
}


# Brokerlar aynı enstrümana farklı ad verir (US100 = NAS100 = USTEC ...). İlk ad paneldeki standart addır.
SYMBOL_GROUPS: list[list[str]] = [
    ["US100", "NAS100", "USTEC", "NDX100", "NQ100", "NASDAQ100", "NASDAQ", "USTECH", "US100CASH", "NAS100CASH", "NDX"],
    ["US30", "DJ30", "DOW30", "WS30", "DJI30", "DOWJONES", "US30CASH", "DJ30CASH", "DJI", "DOW"],
    ["US500", "SPX500", "SP500", "US500CASH", "SPX"],
    ["GER40", "DE40", "DAX40", "GER30", "DE30", "DAX", "GERMANY40", "GER40CASH"],
    ["UK100", "FTSE100", "UK100CASH", "FTSE"],
    ["JP225", "JPN225", "NIKKEI225", "NIK225", "JAPAN225"],
    ["FRA40", "CAC40", "FRANCE40"],
    ["EU50", "EUSTX50", "STOXX50", "ESTX50"],
    ["AUS200", "ASX200", "AU200"],
    ["HK50", "HSI50", "HONGKONG50"],
    ["XAUUSD", "GOLD", "GOLDUSD"],
    ["XAGUSD", "SILVER"],
    ["USOIL", "WTI", "XTIUSD", "USOUSD", "OILUSD", "CRUDEOIL"],
    ["UKOIL", "BRENT", "XBRUSD", "UKOUSD"],
    ["BTCUSD", "BITCOIN", "BTCUSDT", "XBTUSD"],
    ["ETHUSD", "ETHEREUM", "ETHUSDT"],
]


def _norm(s: str) -> str:
    return re.sub(r"[^A-Z0-9]", "", s.upper())


def symbol_aliases(name: str) -> list[str]:
    """name ile aynı enstrümanın bilinen tüm adları (kendisi ilk sırada)."""
    n = _norm(name)
    for g in SYMBOL_GROUPS:
        if any(n == _norm(a) for a in g):
            return [name] + [a for a in g if _norm(a) != n]
    return [name]


_TF_PARSE = re.compile(r"(?<![A-Z0-9])(?:PERIOD_)?(M1|M3|M5|M15|M30|H1|H4|D1|MAN)(?![A-Z0-9])")


def parse_tf(comment: str) -> str:
    """Emir yorumundan zaman dilimi: 'JARVIS AUTO M15', 'JARVIS BUY M5 #12', 'KANAL BUY PERIOD_M15' -> M15."""
    m = _TF_PARSE.search((comment or "").upper())
    return m.group(1) if m else ""


def describe_retcode(code: int | None, comment: str = "") -> str:
    base = RETCODES.get(code or 0, "Emir reddedildi")
    return base if code == 10027 else f"{base} (kod {code}: {comment})".strip()


# --------------------------------------------------------------------------- #
# Veri modelleri
# --------------------------------------------------------------------------- #
@dataclass
class AccountSnapshot:
    connected: bool
    server: str = ""
    login: str = ""
    balance: float = 0.0
    equity: float = 0.0
    margin: float = 0.0
    freeMargin: float = 0.0
    currency: str = "USD"
    leverage: int = 100
    ping: float = 0.0  # ms (terminal -> broker)
    algo: bool = True          # terminalde Algo Trading düğmesi açık mı
    tradeAllowed: bool = True  # hesapta işlem izni var mı
    build: int = 0

    def to_dict(self) -> dict:
        return asdict(self)


@dataclass
class Position:
    ticket: int
    symbol: str
    side: str
    volume: float
    openPrice: float
    currentPrice: float
    sl: float
    tp: float
    pnl: float
    comment: str = ""
    magic: int = 0
    tf: str = ""  # işlemin açıldığı zaman dilimi (ajan kaydı / yorum)

    def to_dict(self) -> dict:
        return asdict(self)


@dataclass
class WatchRule:
    symbol: str
    timeframe: str = "H1"
    rsiPeriod: int = 14
    rsiOverbought: float = 70
    rsiOversold: float = 30
    cciPeriod: int = 20
    cciLevel: float = 100
    stochEnabled: bool = True
    useDivergence: bool = True
    lotSize: float = 0.1
    slPips: float = 30
    tpPips: float = 60
    enabled: bool = True

    @classmethod
    def from_dict(cls, d: dict) -> "WatchRule":
        keys = cls.__dataclass_fields__.keys()
        return cls(**{k: d[k] for k in keys if k in d})


@dataclass
class SignalCandidate:
    symbol: str
    side: str
    timeframe: str
    price: float
    sl: float
    tp: float
    volume: float
    reason: str
    confidence: int
    indicators: dict = field(default_factory=dict)

    def to_dict(self) -> dict:
        return asdict(self)


@dataclass
class OrderResult:
    ok: bool
    ticket: Optional[int] = None
    price: Optional[float] = None
    retcode: Optional[int] = None
    message: str = ""
    position: Optional[int] = None  # açılan pozisyonun bileti (MT5 position ticket)


# --------------------------------------------------------------------------- #
# İndikatörler (saf pandas / numpy — TA-Lib gerektirmez)
# --------------------------------------------------------------------------- #
def rsi(close: pd.Series, period: int = 14) -> pd.Series:
    delta = close.diff()
    gain = delta.clip(lower=0.0)
    loss = -delta.clip(upper=0.0)
    avg_gain = gain.ewm(alpha=1 / period, min_periods=period, adjust=False).mean()
    avg_loss = loss.ewm(alpha=1 / period, min_periods=period, adjust=False).mean()
    rs = avg_gain / avg_loss.replace(0, np.nan)
    return (100 - 100 / (1 + rs)).fillna(50)


def cci(df: pd.DataFrame, period: int = 20) -> pd.Series:
    tp = (df["high"] + df["low"] + df["close"]) / 3
    sma = tp.rolling(period).mean()
    mad = tp.rolling(period).apply(lambda x: np.mean(np.abs(x - x.mean())), raw=True)
    return ((tp - sma) / (0.015 * mad.replace(0, np.nan))).fillna(0)


def stochastic(df: pd.DataFrame, k: int = 14, d: int = 3, smooth: int = 3) -> tuple[pd.Series, pd.Series]:
    low_min = df["low"].rolling(k).min()
    high_max = df["high"].rolling(k).max()
    raw = 100 * (df["close"] - low_min) / (high_max - low_min).replace(0, np.nan)
    k_line = raw.rolling(smooth).mean()
    d_line = k_line.rolling(d).mean()
    return k_line.fillna(50), d_line.fillna(50)


def atr(df: pd.DataFrame, period: int = 14) -> pd.Series:
    prev = df["close"].shift(1)
    tr = pd.concat([df["high"] - df["low"], (df["high"] - prev).abs(), (df["low"] - prev).abs()], axis=1).max(axis=1)
    return tr.ewm(alpha=1 / period, adjust=False).mean()


def _pivots(series: pd.Series, left: int = 3, right: int = 3, kind: str = "low") -> list[int]:
    vals = series.values
    idx: list[int] = []
    for i in range(left, len(vals) - right):
        window = vals[i - left: i + right + 1]
        if kind == "low" and vals[i] == window.min():
            idx.append(i)
        if kind == "high" and vals[i] == window.max():
            idx.append(i)
    return idx


def detect_divergence(df: pd.DataFrame, osc: pd.Series, lookback: int = 60) -> Optional[str]:
    """Klasik uyumsuzluk: son iki pivot karşılaştırması.
    bullish: fiyat daha düşük dip, osilatör daha yüksek dip
    bearish: fiyat daha yüksek tepe, osilatör daha düşük tepe
    """
    sub = df.tail(lookback).reset_index(drop=True)
    o = osc.tail(lookback).reset_index(drop=True)
    lows = _pivots(sub["low"], kind="low")
    highs = _pivots(sub["high"], kind="high")
    if len(lows) >= 2:
        a, b = lows[-2], lows[-1]
        if len(sub) - b <= 6 and sub["low"][b] < sub["low"][a] and o[b] > o[a] and o[b] < 45:
            return "bullish"
    if len(highs) >= 2:
        a, b = highs[-2], highs[-1]
        if len(sub) - b <= 6 and sub["high"][b] > sub["high"][a] and o[b] < o[a] and o[b] > 55:
            return "bearish"
    return None


def pip_size(symbol: str, point: float | None = None, digits: int | None = None) -> float:
    s = symbol.upper()
    if "JPY" in s:
        return 0.01
    if s.startswith("XAU"):
        return 0.1
    if s.startswith(("US30", "US100", "US500", "USTEC", "NAS", "NDX", "SPX", "SP500", "DJ", "DOW", "WS30", "GER", "DE40",
                     "DE30", "DAX", "UK100", "FTSE", "JP225", "JPN225", "NIK", "FRA40", "EU50", "AUS200", "HK50")):
        return 1.0
    if s.startswith("GOLD"):
        return 0.1
    if point and digits in (3, 5):
        return point * 10
    return 0.0001


# --------------------------------------------------------------------------- #
# Motor
# --------------------------------------------------------------------------- #
class MT5Engine:
    def __init__(
        self,
        terminal_path: str | None = None,
        login: int | None = None,
        password: str | None = None,
        server: str | None = None,
        magic: int = 770077,
        deviation: int = 20,
        simulate: bool = False,
    ) -> None:
        self.terminal_path = terminal_path
        self.login = login
        self.password = password
        self.server = server
        self.magic = magic
        self.deviation = deviation
        self.simulate = simulate or mt5 is None
        self.connected = False
        self._last_bar: dict[str, Any] = {}
        self._sim_prices: dict[str, float] = {}
        self._sim_positions: list[Position] = []
        self._sim_balance = 10000.0
        self._lock = threading.RLock()
        self._sym_cache: dict[str, tuple[str, float]] = {}
        self._spec_cache: dict[str, tuple[float, dict]] = {}
        self._rates_cache: dict[tuple[str, str], tuple[float, Any]] = {}
        self._last_px: dict[str, tuple[float, float]] = {}
        self._sim_partial: set[int] = set()
        if mt5 is None and not simulate:
            log.warning("MetaTrader5 paketi bulunamadı -> SİMÜLASYON modunda çalışılıyor (pip install MetaTrader5, yalnız Windows).")

    # ------------------------------------------------------------------ bağlantı
    @_locked
    def connect(self) -> bool:
        if self.simulate:
            self.connected = True
            return True
        kwargs: dict[str, Any] = {}
        if self.terminal_path:
            kwargs["path"] = self.terminal_path
        if self.login:
            kwargs.update(login=int(self.login), password=self.password or "", server=self.server or "")
        ok = mt5.initialize(**kwargs)
        if not ok:
            log.error("MT5 initialize başarısız: %s", mt5.last_error())
            self.connected = False
            return False
        info = mt5.account_info()
        self.connected = info is not None
        if self.connected:
            log.info("MT5 bağlandı: %s @ %s", info.login, info.server)
        return self.connected

    @_locked
    def ensure_connected(self) -> bool:
        if self.simulate:
            return True
        if self.connected and mt5.terminal_info() is not None and mt5.account_info() is not None:
            return True
        log.warning("MT5 bağlantısı yok, yeniden bağlanılıyor…")
        try:
            mt5.shutdown()
        except Exception:
            pass
        return self.connect()

    def shutdown(self) -> None:
        if not self.simulate and mt5 is not None:
            mt5.shutdown()
        self.connected = False

    # ------------------------------------------------------------------ hesap
    @_locked
    def account(self) -> AccountSnapshot:
        if self.simulate:
            fl = sum(p.pnl for p in self.positions())
            margin = sum(p.volume * 1000 for p in self._sim_positions)
            eq = self._sim_balance + fl
            return AccountSnapshot(True, "SIMULATION", "0", self._sim_balance, eq, margin, eq - margin, "USD", 100, ping=round(random.uniform(8, 18), 1))
        if not self.ensure_connected():
            return AccountSnapshot(False)
        a = mt5.account_info()
        ti = mt5.terminal_info()
        ping = round(ti.ping_last / 1000.0, 1) if ti is not None and getattr(ti, "ping_last", 0) else 0.0
        return AccountSnapshot(
            connected=True, server=a.server, login=str(a.login), balance=a.balance, equity=a.equity,
            margin=a.margin, freeMargin=a.margin_free, currency=a.currency, leverage=a.leverage, ping=ping,
            algo=bool(ti.trade_allowed) if ti is not None else False,
            tradeAllowed=bool(a.trade_allowed) and bool(getattr(a, "trade_expert", True)),
            build=int(getattr(ti, "build", 0) or 0),
        )

    @_locked
    def positions(self) -> list[Position]:
        if self.simulate:
            for p in self._sim_positions:
                p.currentPrice = self._sim_tick(p.symbol)
                diff = (p.currentPrice - p.openPrice) if p.side == "BUY" else (p.openPrice - p.currentPrice)
                p.pnl = round(diff * p.volume * self._contract(p.symbol), 2)
            return list(self._sim_positions)
        if not self.ensure_connected():
            return []
        out: list[Position] = []
        for p in mt5.positions_get() or []:
            out.append(Position(
                ticket=p.ticket, symbol=p.symbol, side="BUY" if p.type == mt5.POSITION_TYPE_BUY else "SELL",
                volume=p.volume, openPrice=p.price_open, currentPrice=p.price_current, sl=p.sl, tp=p.tp,
                pnl=round(p.profit + p.swap, 2), comment=p.comment, magic=int(getattr(p, "magic", 0) or 0),
            ))
        return out

    # ------------------------------------------------------------------ sembol / veri
    @_locked
    def resolve_symbol(self, name: str) -> str:
        """Panel adı -> brokerdaki gerçek ad. Ekler (EURUSD.m, EURUSDm, NAS100.cash) ve takma adlar
        (US100 -> NAS100/USTEC, US30 -> DJ30/WS30, XAUUSD -> GOLD ...) otomatik denenir."""
        if self.simulate or mt5 is None:
            return name
        key = name.upper()
        hit = self._sym_cache.get(key)
        if hit and (hit[0] != name or time.time() - hit[1] < 60):
            return hit[0]
        res = name if mt5.symbol_info(name) is not None else None
        if res is None:
            all_syms = mt5.symbols_get() or []
            by_norm: dict[str, list] = {}
            for sy in all_syms:
                by_norm.setdefault(_norm(sy.name), []).append(sy)

            def pick(cands: list) -> str:
                cands.sort(key=lambda x: (not getattr(x, "select", False), len(x.name), x.name))  # Piyasa Gözlemi'ndekiler önce
                return cands[0].name

            for alias in symbol_aliases(name):
                na = _norm(alias)
                if na in by_norm:  # birebir (noktalama hariç)
                    res = pick(list(by_norm[na]))
                    break
                if len(na) >= 4:  # ek: NAS100 -> NAS100.cash / NAS100m
                    c = [sy for k, lst in by_norm.items() if k.startswith(na) and len(k) - len(na) <= 5 for sy in lst]
                    if c:
                        res = pick(c)
                        break
        res = res or name
        self._sym_cache[key] = (res, time.time())
        if res != name:
            log.info("Sembol eşlendi: %s -> %s", name, res)
        return res

    @_locked
    def suggest_symbols(self, name: str, n: int = 3) -> list[str]:
        if self.simulate or mt5 is None:
            return []
        names = [sy.name for sy in (mt5.symbols_get() or [])]
        normed = {_norm(x): x for x in names}
        hits = difflib.get_close_matches(_norm(name), list(normed), n=n, cutoff=0.5)
        return [normed[h] for h in hits]

    def _spec(self, sym: str) -> dict:
        hit = self._spec_cache.get(sym)
        if hit and time.time() - hit[0] < 300:
            return hit[1]
        info = mt5.symbol_info(sym)
        if info is None:
            return {}
        spec = {"digits": int(info.digits), "point": float(info.point),
                "stops": int(max(info.trade_stops_level, info.trade_freeze_level)),
                "minLot": float(info.volume_min), "lotStep": float(info.volume_step)}
        self._spec_cache[sym] = (time.time(), spec)
        return spec

    @_locked
    def terminal_status(self) -> dict:
        if self.simulate or mt5 is None:
            return {"algo": True, "tradeAllowed": True, "build": 0}
        ti, ai = mt5.terminal_info(), mt5.account_info()
        return {"algo": bool(ti.trade_allowed) if ti else False,
                "tradeAllowed": bool(ai.trade_allowed) if ai else False, "build": int(getattr(ti, "build", 0) or 0)}

    @_locked
    def tick(self, symbol: str) -> tuple[float, float]:
        if self.simulate:
            p = self._sim_tick(symbol)
            spr = pip_size(symbol) * 1.2
            return p - spr / 2, p + spr / 2
        sym = self.resolve_symbol(symbol)
        mt5.symbol_select(sym, True)
        t = mt5.symbol_info_tick(sym)
        if t is None:
            raise RuntimeError(f"{symbol} fiyatı alınamadı: {mt5.last_error()}")
        return t.bid, t.ask

    @_locked
    def quotes(self, names: list[str]) -> list[dict]:
        """Hızlı fiyat akışı: bid/ask + tick zamanı + fiyatın kaç sn'dir değişmediği (piyasa kapalı tespiti)."""
        out: list[dict] = []
        now = time.time()
        for name in names:
            try:
                if self.simulate:
                    p = self._sim_tick(name)
                    spr = pip_size(name) * 1.2
                    bid, ask, ts, spec = p - spr / 2, p + spr / 2, int(now), {"digits": 5, "stops": 0}
                else:
                    sym = self.resolve_symbol(name)
                    t = mt5.symbol_info_tick(sym)
                    if t is None or (t.bid <= 0 and t.ask <= 0):
                        mt5.symbol_select(sym, True)
                        t = mt5.symbol_info_tick(sym)
                    if t is None:
                        continue
                    bid, ask, ts, spec = float(t.bid), float(t.ask), int(t.time), self._spec(sym)
                prev = self._last_px.get(name)
                if prev is None or prev[0] != bid:
                    self._last_px[name] = (bid, now)
                    stale = 0.0
                else:
                    stale = now - prev[1]
                real = name if self.simulate else self.resolve_symbol(name)
                out.append({"s": name, "real": real, "bid": bid, "ask": ask, "t": ts, "stale": round(stale, 1), **spec})
            except Exception as e:  # noqa: BLE001
                log.debug("quote %s: %s", name, e)
        return out

    @_locked
    def rates(self, symbol: str, timeframe: str = "H1", count: int = 300, ttl: float = 2.5) -> pd.DataFrame:
        if self.simulate:
            return self._sim_rates(symbol, timeframe, count)
        if not self.ensure_connected():
            raise RuntimeError("MT5 bağlı değil")
        key = (symbol.upper(), timeframe)
        hit = self._rates_cache.get(key)
        if hit and time.time() - hit[0] < ttl and len(hit[1]) >= count:
            return hit[1].tail(count).reset_index(drop=True)
        sym = self.resolve_symbol(symbol)
        mt5.symbol_select(sym, True)
        tf = getattr(mt5, f"TIMEFRAME_{timeframe}")
        data = mt5.copy_rates_from_pos(sym, tf, 0, count)
        if data is None or len(data) == 0:  # ilk seçimde geçmiş yüklenmemiş olabilir
            time.sleep(0.4)
            data = mt5.copy_rates_from_pos(sym, tf, 0, count)
        if data is None or len(data) == 0:
            if mt5.symbol_info(sym) is None:
                sug = self.suggest_symbols(symbol)
                raise RuntimeError(f"{symbol} brokerda bulunamadı" + (f" — benzer: {', '.join(sug)}" if sug else " — Piyasa Gözlemi'nde var mı?"))
            raise RuntimeError(f"{symbol}{'' if sym == symbol else ' (' + sym + ')'} {timeframe} verisi alınamadı: {mt5.last_error()}")
        df = pd.DataFrame(data)
        df["time"] = pd.to_datetime(df["time"], unit="s")
        cols = ["time", "open", "high", "low", "close", "tick_volume"]
        if "spread" in df.columns:
            cols.append("spread")  # MT5 spread in points; used by the KANAL live safety gate
        df = df[cols]
        self._rates_cache[key] = (time.time(), df)
        return df

    @_locked
    def market_watch_symbols(self, limit: int = 80) -> list[str]:
        """MT5 Piyasa Gözlemi'nde (Market Watch) AÇIK olan tüm semboller."""
        if self.simulate:
            return ["EURUSD", "GBPUSD", "USDJPY", "XAUUSD", "GBPJPY", "US30"]
        if not self.ensure_connected():
            return []
        syms = mt5.symbols_get() or []
        return [x.name for x in syms if x.select][:limit]

    def market_snapshot(self, symbol: str, timeframe: str, count: int = 300) -> dict:
        """Panel grafiği / RSI-CCI radarı için mum verisi: [[epoch, o, h, l, c, hacim], ...]"""
        df = self.rates(symbol, timeframe, count)
        bid, ask = self.tick(symbol)
        candles = [
            [int(t.timestamp()), float(o), float(h), float(l), float(c), int(v)]
            for t, o, h, l, c, v in zip(df["time"], df["open"], df["high"], df["low"], df["close"], df["tick_volume"])
        ]
        return {"symbol": symbol, "timeframe": timeframe, "bid": bid, "ask": ask, "candles": candles}

    @_locked
    def deal_summary(self, ticket: int) -> Optional[dict]:
        """Kapanan pozisyonun gerçekleşen K/Z'si (komisyon + swap dahil)."""
        if self.simulate or mt5 is None:
            return None
        deals = mt5.history_deals_get(position=int(ticket))
        if not deals:
            return None
        profit = sum(d.profit + d.commission + d.swap + getattr(d, "fee", 0.0) for d in deals)
        outs = [d for d in deals if d.entry in (mt5.DEAL_ENTRY_OUT, getattr(mt5, "DEAL_ENTRY_OUT_BY", -1))]
        last = outs[-1] if outs else deals[-1]
        return {"ticket": str(ticket), "profit": round(profit, 2), "price": float(last.price), "time": int(last.time)}

    # ------------------------------------------------------------------ analiz
    def indicators(self, df: pd.DataFrame, rule: WatchRule) -> pd.DataFrame:
        out = df.copy()
        out["rsi"] = rsi(out["close"], rule.rsiPeriod)
        out["cci"] = cci(out, rule.cciPeriod)
        out["stoch_k"], out["stoch_d"] = stochastic(out)
        out["atr"] = atr(out)
        return out

    def analyze(self, rule: WatchRule, only_new_bar: bool = True) -> Optional[SignalCandidate]:
        """Kapanmış son mum üzerinden kural değerlendirmesi. Şartlar olgunsa SignalCandidate döner."""
        df = self.rates(rule.symbol, rule.timeframe, 300)
        key = f"{rule.symbol}:{rule.timeframe}"
        last_closed_time = df["time"].iloc[-2]
        if only_new_bar and self._last_bar.get(key) == last_closed_time:
            return None
        self._last_bar[key] = last_closed_time

        ind = self.indicators(df, rule)
        c, p = ind.iloc[-2], ind.iloc[-3]  # son kapanan ve bir önceki mum
        div = detect_divergence(ind.iloc[:-1], ind["rsi"].iloc[:-1]) if rule.useDivergence else None

        score_buy, score_sell = 0, 0
        reasons_buy: list[str] = []
        reasons_sell: list[str] = []

        # RSI aşırı bölge ve dönüş
        if c.rsi < rule.rsiOversold or (p.rsi < rule.rsiOversold <= c.rsi):
            score_buy += 35; reasons_buy.append(f"RSI {c.rsi:.1f} aşırı satım")
        if c.rsi > rule.rsiOverbought or (p.rsi > rule.rsiOverbought >= c.rsi):
            score_sell += 35; reasons_sell.append(f"RSI {c.rsi:.1f} aşırı alım")
        # CCI
        if c.cci < -rule.cciLevel:
            score_buy += 25; reasons_buy.append(f"CCI {c.cci:.0f}")
        if c.cci > rule.cciLevel:
            score_sell += 25; reasons_sell.append(f"CCI {c.cci:.0f}")
        # Stochastic kesişim
        if rule.stochEnabled:
            if c.stoch_k < 20 and c.stoch_k > c.stoch_d and p.stoch_k <= p.stoch_d:
                score_buy += 15; reasons_buy.append("Stoch boğa kesişimi")
            if c.stoch_k > 80 and c.stoch_k < c.stoch_d and p.stoch_k >= p.stoch_d:
                score_sell += 15; reasons_sell.append("Stoch ayı kesişimi")
        # Uyumsuzluk
        if div == "bullish":
            score_buy += 25; reasons_buy.append("boğa uyumsuzluğu")
        if div == "bearish":
            score_sell += 25; reasons_sell.append("ayı uyumsuzluğu")

        side = None
        if score_buy >= 60 and score_buy > score_sell:
            side, score, reasons = "BUY", score_buy, reasons_buy
        elif score_sell >= 60 and score_sell > score_buy:
            side, score, reasons = "SELL", score_sell, reasons_sell
        if not side:
            return None

        bid, ask = self.tick(rule.symbol)
        price = ask if side == "BUY" else bid
        pip = pip_size(rule.symbol)
        sl = price - rule.slPips * pip if side == "BUY" else price + rule.slPips * pip
        tp = price + rule.tpPips * pip if side == "BUY" else price - rule.tpPips * pip
        digits = 2 if price > 1000 else 3 if price > 50 else 5
        return SignalCandidate(
            symbol=rule.symbol, side=side, timeframe=rule.timeframe, price=round(price, digits),
            sl=round(sl, digits), tp=round(tp, digits), volume=rule.lotSize,
            reason=" + ".join(reasons), confidence=int(min(99, score)),
            indicators={
                "RSI": round(float(c.rsi), 1), "CCI": round(float(c.cci), 1),
                "Stoch": round(float(c.stoch_k), 1), "ATR": round(float(c.atr), 5),
                **({"divergence": div} if div else {}),
            },
        )

    # ------------------------------------------------------------------ emir
    @_locked
    def place_order(self, symbol: str, side: str, volume: float, sl: float | None = None,
                    tp: float | None = None, comment: str = "JARVIS", approved: bool = False,
                    signal_price: float | None = None, max_dev_pct: float = 1.5, magic: int | None = None) -> OrderResult:
        """Piyasa emri. `approved=True` zorunludur — kullanıcı onayı olmadan emir gönderilmez.

        Gönderimden ÖNCE: Algo Trading / hesap izni, sembol işlem modu, güncel fiyat, sinyal fiyatının bayatlığı,
        SL/TP yönü ve minimum stop mesafesi (stops/freeze level + spread), teminat kontrol edilir.
        Çok yakın SL/TP otomatik uzatılır; yanlış tarafta ise emir reddedilir. Doldurma modları (IOC/FOK/RETURN)
        sırayla denenir; requote ve geçersiz-stop durumlarında taze fiyatla yeniden denenir.
        """
        if not approved:
            return OrderResult(False, message="KESİN KURAL: Kullanıcı onayı olmadan emir gönderilemez.")
        side = side.upper()
        is_buy = side == "BUY"
        if self.simulate:
            bid, ask = self.tick(symbol)
            price = ask if is_buy else bid
            t = random.randint(10_000_000, 99_999_999)
            self._sim_positions.append(Position(t, symbol, side, volume, price, price, sl or 0, tp or 0, 0.0, comment, magic or self.magic))
            return OrderResult(True, t, price, 10009, "SIM DONE", position=t)
        if not self.ensure_connected():
            return OrderResult(False, retcode=10031, message="MT5 terminaline bağlı değil.")
        use_magic = int(magic or self.magic)

        ti, ai = mt5.terminal_info(), mt5.account_info()
        if ti is not None and not ti.trade_allowed:
            return OrderResult(False, retcode=10027, message=ALGO_HINT)
        if ai is not None and not ai.trade_allowed:
            return OrderResult(False, retcode=10017, message="Bu hesapta işlem izni yok (salt-okunur / yatırımcı şifresiyle girilmiş olabilir).")
        if ai is not None and not getattr(ai, "trade_expert", True):
            return OrderResult(False, retcode=10028, message="Broker bu hesapta Uzman Danışman / algoritmik işleme izin vermiyor.")

        sym = self.resolve_symbol(symbol)
        info = mt5.symbol_info(sym)
        if info is None:
            return OrderResult(False, message=f"Sembol MT5'te bulunamadı: {symbol}. Piyasa Gözlemi'nde var mı?")
        if not info.visible:
            mt5.symbol_select(sym, True)
            info = mt5.symbol_info(sym) or info
        tm = info.trade_mode
        if tm == getattr(mt5, "SYMBOL_TRADE_MODE_DISABLED", -9) or tm == getattr(mt5, "SYMBOL_TRADE_MODE_CLOSEONLY", -9):
            return OrderResult(False, retcode=10017, message=f"{sym} üzerinde yeni işlem açılamıyor (işlem modu kapalı / yalnız kapatma).")
        if is_buy and tm == getattr(mt5, "SYMBOL_TRADE_MODE_SHORTONLY", -9):
            return OrderResult(False, retcode=10017, message=f"{sym} yalnızca SATIŞ'a açık.")
        if (not is_buy) and tm == getattr(mt5, "SYMBOL_TRADE_MODE_LONGONLY", -9):
            return OrderResult(False, retcode=10017, message=f"{sym} yalnızca ALIŞ'a açık.")

        point = info.point or 10 ** (-info.digits)
        digits = int(info.digits)
        step = info.volume_step or 0.01
        vol = math.floor(volume / step + 1e-9) * step
        vol = max(info.volume_min, min(info.volume_max, vol))
        vol = round(vol, max(0, int(round(-math.log10(step)))) if step < 1 else 0)
        otype = mt5.ORDER_TYPE_BUY if is_buy else mt5.ORDER_TYPE_SELL

        notes: list[str] = []
        last = OrderResult(False, message="Emir gönderilemedi.")
        for attempt in range(4):
            tick = mt5.symbol_info_tick(sym)
            if tick is None or tick.bid <= 0 or tick.ask <= 0:
                return OrderResult(False, retcode=10021, message=f"{sym} için fiyat yok (piyasa kapalı olabilir).")
            bid, ask = tick.bid, tick.ask
            open_px = ask if is_buy else bid
            if signal_price and attempt == 0:
                dev = abs(open_px - signal_price) / open_px * 100
                if dev > max_dev_pct:
                    return OrderResult(False, retcode=10015, message=(
                        f"Sinyal fiyatı güncel değil: sinyal {signal_price} / güncel {open_px:.{digits}f} (%{dev:.2f} fark). "
                        "Eski/demo sinyal olabilir — yeni sinyal bekleyin."))
            ref = bid if is_buy else ask  # pozisyonun kapanış tarafı: stop mesafesi buna göre ölçülür
            min_dist = (max(info.trade_stops_level, info.trade_freeze_level) * point + (ask - bid) + 2 * point) * (1 + 0.6 * attempt)

            def fix(v: float | None, kind: str) -> float:
                if not v:
                    return 0.0
                below = (kind == "sl") == is_buy  # BUY: SL aşağıda, TP yukarıda · SELL: tersi
                if (below and v >= ref) or ((not below) and v <= ref):
                    raise ValueError(f"{kind.upper()} yanlış tarafta: {v} (güncel {ref:.{digits}f}). Sinyal seviyeleri bayat/hatalı.")
                if abs(v - ref) < min_dist:
                    nv = ref - min_dist if below else ref + min_dist
                    notes.append(f"{kind.upper()} minimum mesafeye uzatıldı ({min_dist / point:.0f} puan): {v:.{digits}f}→{nv:.{digits}f}")
                    v = nv
                return round(v, digits)

            try:
                sl_f, tp_f = fix(sl, "sl"), fix(tp, "tp")
            except ValueError as e:
                return OrderResult(False, retcode=10016, message=str(e))

            marg = mt5.order_calc_margin(otype, sym, vol, open_px)
            if marg is not None and ai is not None and marg > ai.margin_free:
                return OrderResult(False, retcode=10019, message=f"Yetersiz teminat: gerekli {marg:.2f}, serbest {ai.margin_free:.2f}.")

            fm = info.filling_mode
            fills = ([mt5.ORDER_FILLING_IOC] if fm & 2 else []) + ([mt5.ORDER_FILLING_FOK] if fm & 1 else []) + [mt5.ORDER_FILLING_RETURN]
            dev_pts = int(max(self.deviation, ((ask - bid) / point) * 3, 30))
            retry = False
            for fill in fills:
                req = {
                    "action": mt5.TRADE_ACTION_DEAL, "symbol": sym, "volume": float(vol), "type": otype, "price": open_px,
                    "sl": sl_f, "tp": tp_f, "deviation": dev_pts, "magic": use_magic, "comment": comment[:31],
                    "type_time": mt5.ORDER_TIME_GTC, "type_filling": fill,
                }
                chk = mt5.order_check(req)
                if chk is None:
                    last = OrderResult(False, message=f"order_check başarısız: {mt5.last_error()}")
                    continue
                if chk.retcode == 10030:
                    continue
                if chk.retcode == 10016:
                    last = OrderResult(False, retcode=10016, message=describe_retcode(10016, chk.comment))
                    retry = True
                    break
                if chk.retcode not in (0, 10009):
                    return OrderResult(False, retcode=chk.retcode, message=describe_retcode(chk.retcode, chk.comment))
                res = mt5.order_send(req)
                if res is None:
                    last = OrderResult(False, message=f"order_send None: {mt5.last_error()}")
                    continue
                if res.retcode in (10009, 10008, 10010):
                    msg = "Emir gerçekleşti" + (f" · SL {sl_f} TP {tp_f}" if (sl_f or tp_f) else "") + (" · " + " | ".join(notes) if notes else "")
                    pos_id = None
                    try:  # açılan pozisyonun gerçek bileti (genelde emir biletiyle aynıdır)
                        if res.deal:
                            for _ in range(3):
                                dd = mt5.history_deals_get(ticket=res.deal)
                                if dd:
                                    pos_id = int(dd[0].position_id)
                                    break
                                time.sleep(0.1)
                    except Exception:  # noqa: BLE001
                        pos_id = None
                    return OrderResult(True, res.order or res.deal, res.price, res.retcode, msg, position=pos_id or res.order or None)
                if res.retcode == 10030:
                    continue
                if res.retcode in (10004, 10020, 10021, 10016):
                    last = OrderResult(False, retcode=res.retcode, message=describe_retcode(res.retcode, res.comment))
                    retry = True
                    break
                return OrderResult(False, retcode=res.retcode, message=describe_retcode(res.retcode, res.comment))
            if not retry:
                break
            time.sleep(0.25)
        return last

    @_locked
    def modify_position(self, ticket: int, sl: float | None = None, tp: float | None = None) -> OrderResult:
        """Açık pozisyonun SL/TP'sini değiştirir (TRADE_ACTION_SLTP). None = değiştirme, 0 = kaldır.
        Yön ve minimum stop mesafesi (stops/freeze level) kontrol edilir; anlaşılır hata döner."""
        if self.simulate:
            for p in self._sim_positions:
                if p.ticket == int(ticket):
                    if sl is not None:
                        p.sl = float(sl)
                    if tp is not None:
                        p.tp = float(tp)
                    return OrderResult(True, p.ticket, p.currentPrice, 10009, f"SL {p.sl} TP {p.tp}")
            return OrderResult(False, message="pozisyon yok")
        if not self.ensure_connected():
            return OrderResult(False, retcode=10031, message="MT5 terminaline bağlı değil.")
        ti = mt5.terminal_info()
        if ti is not None and not ti.trade_allowed:
            return OrderResult(False, retcode=10027, message=ALGO_HINT)
        pos = mt5.positions_get(ticket=int(ticket))
        if not pos:
            return OrderResult(False, message="Pozisyon bulunamadı (kapanmış olabilir).")
        p = pos[0]
        info = mt5.symbol_info(p.symbol)
        tick = mt5.symbol_info_tick(p.symbol)
        if info is None or tick is None:
            return OrderResult(False, retcode=10021, message=f"{p.symbol} için fiyat yok (piyasa kapalı olabilir).")
        is_buy = p.type == mt5.POSITION_TYPE_BUY
        digits = int(info.digits)
        point = info.point or 10 ** (-digits)
        ref = tick.bid if is_buy else tick.ask  # pozisyonun kapanış fiyatı
        min_dist = max(info.trade_stops_level, info.trade_freeze_level) * point
        new_sl = p.sl if sl is None else round(float(sl), digits)
        new_tp = p.tp if tp is None else round(float(tp), digits)
        side_tr = "ALIŞ" if is_buy else "SATIŞ"
        if new_sl:
            if (is_buy and new_sl >= ref) or ((not is_buy) and new_sl <= ref):
                extra = " Fiyat henüz girişin ötesine geçmedi; SL girişe çekilemez." if abs(new_sl - p.price_open) < point * 2 else ""
                return OrderResult(False, retcode=10016, message=(
                    f"SL {new_sl} geçersiz: {side_tr} pozisyonunda SL güncel fiyatın ({ref:.{digits}f}) "
                    f"{'altında' if is_buy else 'üstünde'} olmalı.{extra}"))
            if abs(ref - new_sl) < min_dist:
                return OrderResult(False, retcode=10016, message=(
                    f"SL fiyata çok yakın: broker en az {min_dist / point:.0f} puan mesafe istiyor (güncel {ref:.{digits}f})."))
        if new_tp:
            if (is_buy and new_tp <= ref) or ((not is_buy) and new_tp >= ref):
                return OrderResult(False, retcode=10016, message=(
                    f"TP {new_tp} geçersiz: {side_tr} pozisyonunda TP güncel fiyatın ({ref:.{digits}f}) "
                    f"{'üstünde' if is_buy else 'altında'} olmalı."))
            if abs(new_tp - ref) < min_dist:
                return OrderResult(False, retcode=10016, message=f"TP fiyata çok yakın: en az {min_dist / point:.0f} puan gerekli.")
        if abs((new_sl or 0) - (p.sl or 0)) < point / 2 and abs((new_tp or 0) - (p.tp or 0)) < point / 2:
            return OrderResult(True, p.ticket, ref, 10025, f"Değişiklik yok (SL {p.sl} TP {p.tp})")
        req = {"action": mt5.TRADE_ACTION_SLTP, "position": p.ticket, "symbol": p.symbol,
               "sl": float(new_sl or 0.0), "tp": float(new_tp or 0.0), "magic": p.magic}
        res = mt5.order_send(req)
        if res is None:
            return OrderResult(False, message=f"order_send None: {mt5.last_error()}")
        if res.retcode in (10009, 10008, 10025):
            return OrderResult(True, p.ticket, ref, res.retcode, f"SL {new_sl or 'yok'} · TP {new_tp or 'yok'}")
        return OrderResult(False, retcode=res.retcode, message=describe_retcode(res.retcode, res.comment))

    @_locked
    def close_partial(self, ticket: int, fraction: float = 0.5) -> OrderResult:
        """Pozisyonun bir kısmını kapatır (fraction 0.5 = yarısı). Lot adımına aşağı yuvarlar; kalan en az minimum lot olmalı."""
        fraction = min(0.9, max(0.1, float(fraction)))
        if self.simulate:
            for p in self._sim_positions:
                if p.ticket == int(ticket):
                    part = math.floor(p.volume * fraction / 0.01 + 1e-9) * 0.01
                    if part < 0.01 or p.volume - part < 0.01 - 1e-9:
                        return OrderResult(False, retcode=10014, message=f"{p.volume} lot bölünemeyecek kadar küçük (min 0.01)")
                    self._sim_balance += p.pnl * part / p.volume
                    p.volume = round(p.volume - part, 2)
                    self._sim_partial.add(p.ticket)
                    return OrderResult(True, p.ticket, p.currentPrice, 10009, f"{part:.2f} lot kapatıldı (kalan {p.volume:.2f})")
            return OrderResult(False, message="pozisyon yok")
        ti = mt5.terminal_info()
        if ti is not None and not ti.trade_allowed:
            return OrderResult(False, retcode=10027, message=ALGO_HINT)
        pos = mt5.positions_get(ticket=int(ticket))
        if not pos:
            return OrderResult(False, message="Pozisyon bulunamadı (kapanmış olabilir).")
        p = pos[0]
        info = mt5.symbol_info(p.symbol)
        step = (info.volume_step if info else 0.01) or 0.01
        vmin = (info.volume_min if info else 0.01) or 0.01
        part = math.floor(p.volume * fraction / step + 1e-9) * step
        part = round(part, max(0, int(round(-math.log10(step)))) if step < 1 else 0)
        if part < vmin - 1e-9 or p.volume - part < vmin - 1e-9:
            return OrderResult(False, retcode=10014, message=f"{p.volume} lot bölünemeyecek kadar küçük (minimum lot {vmin}).")
        is_buy = p.type == mt5.POSITION_TYPE_BUY
        fm = info.filling_mode if info is not None else 0
        fills = ([mt5.ORDER_FILLING_IOC] if fm & 2 else []) + ([mt5.ORDER_FILLING_FOK] if fm & 1 else []) + [mt5.ORDER_FILLING_RETURN]
        last = OrderResult(False, message="Kısmi kapatma gönderilemedi")
        for fill in fills:
            tick = mt5.symbol_info_tick(p.symbol)
            if tick is None:
                return OrderResult(False, retcode=10021, message=f"{p.symbol} için fiyat yok")
            req = {
                "action": mt5.TRADE_ACTION_DEAL, "symbol": p.symbol, "volume": float(part), "position": p.ticket,
                "type": mt5.ORDER_TYPE_SELL if is_buy else mt5.ORDER_TYPE_BUY,
                "price": tick.bid if is_buy else tick.ask, "deviation": max(self.deviation, 30), "magic": p.magic,
                "comment": "JARVIS yari kar", "type_time": mt5.ORDER_TIME_GTC, "type_filling": fill,
            }
            res = mt5.order_send(req)
            if res is not None and res.retcode in (10009, 10008, 10010):
                return OrderResult(True, p.ticket, res.price, res.retcode, f"{part} lot kapatıldı (kalan {round(p.volume - part, 2)})")
            if res is not None and res.retcode != 10030:
                return OrderResult(False, retcode=res.retcode, message=describe_retcode(res.retcode, res.comment))
            last = OrderResult(False, retcode=getattr(res, "retcode", None), message="Doldurma modu reddedildi")
        return last

    @_locked
    def partial_done(self, ticket: int) -> bool:
        """Bu pozisyonda daha önce kısmi kapanış yapılmış mı? (MT5 geçmişinde çıkış işlemi var mı) — yeniden başlatmaya dayanıklı."""
        if self.simulate or mt5 is None:
            return int(ticket) in self._sim_partial
        deals = mt5.history_deals_get(position=int(ticket)) or []
        outs = {mt5.DEAL_ENTRY_OUT, getattr(mt5, "DEAL_ENTRY_OUT_BY", -1)}
        return any(d.entry in outs for d in deals)

    @_locked
    def close_position(self, ticket: int) -> OrderResult:
        if self.simulate:
            for p in list(self._sim_positions):
                if p.ticket == int(ticket):
                    self._sim_balance += p.pnl
                    self._sim_positions.remove(p)
                    return OrderResult(True, p.ticket, p.currentPrice, 10009, "SIM CLOSED")
            return OrderResult(False, message="pozisyon yok")
        ti = mt5.terminal_info()
        if ti is not None and not ti.trade_allowed:
            return OrderResult(False, retcode=10027, message=ALGO_HINT)
        pos = mt5.positions_get(ticket=int(ticket))
        if not pos:
            return OrderResult(False, message="pozisyon bulunamadı (zaten kapanmış olabilir)")
        p = pos[0]
        info = mt5.symbol_info(p.symbol)
        is_buy = p.type == mt5.POSITION_TYPE_BUY
        fm = info.filling_mode if info is not None else 0
        fills = ([mt5.ORDER_FILLING_IOC] if fm & 2 else []) + ([mt5.ORDER_FILLING_FOK] if fm & 1 else []) + [mt5.ORDER_FILLING_RETURN]
        last = OrderResult(False, message="Kapatma emri gönderilemedi")
        for fill in fills:
            tick = mt5.symbol_info_tick(p.symbol)
            if tick is None:
                return OrderResult(False, retcode=10021, message=f"{p.symbol} için fiyat yok")
            req = {
                "action": mt5.TRADE_ACTION_DEAL, "symbol": p.symbol, "volume": p.volume, "position": p.ticket,
                "type": mt5.ORDER_TYPE_SELL if is_buy else mt5.ORDER_TYPE_BUY,
                "price": tick.bid if is_buy else tick.ask, "deviation": max(self.deviation, 30), "magic": self.magic,
                "comment": "JARVIS close", "type_time": mt5.ORDER_TIME_GTC, "type_filling": fill,
            }
            res = mt5.order_send(req)
            if res is not None and res.retcode in (10009, 10008, 10010):
                return OrderResult(True, p.ticket, res.price, res.retcode, "Pozisyon kapatıldı")
            if res is not None and res.retcode != 10030:
                return OrderResult(False, retcode=res.retcode, message=describe_retcode(res.retcode, res.comment))
            last = OrderResult(False, retcode=getattr(res, "retcode", None), message="Doldurma modu reddedildi")
        return last

    @staticmethod
    def _filling(info: Any) -> int:
        # Sembolün desteklediği doldurma modunu seç (broker'a göre değişir)
        fm = getattr(info, "filling_mode", 0)
        if fm & 1:
            return mt5.ORDER_FILLING_FOK
        if fm & 2:
            return mt5.ORDER_FILLING_IOC
        return mt5.ORDER_FILLING_RETURN

    # ------------------------------------------------------------------ simülasyon
    def _contract(self, symbol: str) -> float:
        s = symbol.upper()
        if s.startswith("XAU"):
            return 100
        if s.startswith(("US30", "NAS", "SPX", "GER")):
            return 1
        return 100_000

    def _sim_tick(self, symbol: str) -> float:
        base = {"EURUSD": 1.085, "GBPUSD": 1.27, "USDJPY": 157.0, "GBPJPY": 197.5, "XAUUSD": 2380.0, "US30": 39200.0}
        p = self._sim_prices.get(symbol, base.get(symbol.upper(), 1.0))
        p *= 1 + random.gauss(0, 0.00025)
        self._sim_prices[symbol] = p
        return p

    def _sim_rates(self, symbol: str, timeframe: str, count: int) -> pd.DataFrame:
        minutes = TIMEFRAMES.get(timeframe, 60)
        end = pd.Timestamp.now("UTC").floor(f"{minutes}min").tz_localize(None)
        times = pd.date_range(end=end, periods=count, freq=f"{minutes}min")
        rng = np.random.default_rng(abs(hash((symbol, timeframe, int(time.time() // 30)))) % (2**32))
        last = self._sim_tick(symbol)
        steps = rng.normal(0, 0.0012, count)[::-1].cumsum()[::-1]
        close = last * np.exp(-steps + steps[-1])
        # rastgele bir aşırı bölge enjekte et (test için sinyal üretimi)
        if rng.random() < 0.35:
            close[-12:-1] *= np.linspace(1, 1 + rng.choice([-1, 1]) * 0.012, 11)
        open_ = np.r_[close[0], close[:-1]]
        spread = np.abs(rng.normal(0, 0.0006, count)) * close
        return pd.DataFrame({
            "time": times, "open": open_, "high": np.maximum(open_, close) + spread,
            "low": np.minimum(open_, close) - spread, "close": close, "tick_volume": rng.integers(100, 2000, count),
        })


# --------------------------------------------------------------------------- #
if __name__ == "__main__":  # Hızlı test: python mt5_engine.py
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
    eng = MT5Engine()
    eng.connect()
    print("Hesap:", eng.account())
    for sym in ["EURUSD", "XAUUSD"]:
        rule = WatchRule(symbol=sym, timeframe="H1")
        df = eng.indicators(eng.rates(sym, "H1"), rule)
        print(sym, df[["close", "rsi", "cci", "stoch_k"]].tail(3).round(3).to_string())
        print("Sinyal:", eng.analyze(rule, only_new_bar=False))
