"""
crypto_engine.py — JARVIS kripto borsa motoru (ccxt)
====================================================
* Binance USDⓈ-M VADELİ (futures) — varsayılan **Demo Trading** (test ağı): demo-fapi.binance.com
  (ccxt >= 4.5: `enable_demo_trading(True)`; eski `set_sandbox_mode` vadeli için artık çalışmıyor.)
* Aynı arayüz MT5Engine ile: account() · positions() · tick() · rates() · quotes() · place_order() ·
  modify_position() · close_position() · close_partial() · market_watch_symbols()
* SL/TP vadelide ayrı emirlerdir: STOP_MARKET / TAKE_PROFIT_MARKET (closePosition=true, reduceOnly) olarak
  pozisyonla birlikte gönderilir; değiştirmek = eskilerini iptal edip yenilerini koymak.
* Lot yerine **USDT tutarı** (işlem büyüklüğü) kullanılır; miktar = tutar × kaldıraç / fiyat, borsanın adımına yuvarlanır.
* Diğer ccxt borsaları (bybit, okx, mexc, kucoin…) aynı sınıfla çalışır (exchange_id ile); demo yalnız Binance'te.

GÜVENLİK: API anahtarı sadece "Futures işlem" izniyle oluşturulmalı; para çekme izni KAPALI.
"""
from __future__ import annotations

import logging
import math
import threading
import time
from dataclasses import dataclass
from typing import Any, Optional

import pandas as pd

try:
    import ccxt  # type: ignore
except Exception:  # pragma: no cover
    ccxt = None

from mt5_engine import AccountSnapshot, OrderResult, Position

log = logging.getLogger("jarvis.crypto")

CCXT_TF = {"M1": "1m", "M3": "3m", "M5": "5m", "M15": "15m", "M30": "30m", "H1": "1h", "H4": "4h", "D1": "1d"}
QUOTES = ("USDT", "USDC", "BUSD", "FDUSD", "BTC", "ETH", "TRY", "EUR", "USD")


def norm_crypto(sym: str) -> str:
    """'btcusdt' / 'BTC-USDT' / 'BTC/USDT:USDT' / 'btc' -> 'BTCUSDT' (panel adı)."""
    raw = str(sym).upper().strip()
    if ":" in raw:  # ccxt vadeli: "ETH/USDT:USDT" -> "ETH/USDT"
        raw = raw.split(":")[0]
    s = "".join(ch for ch in raw if ch.isalnum())
    if s.endswith("USDTP") or s.endswith("PERP"):
        s = s[:-5] if s.endswith("USDTP") else s[:-4]
    if not any(s.endswith(q) and len(s) > len(q) for q in QUOTES):
        s = s + "USDT"          # "BTC" -> BTCUSDT
    elif s.endswith("USD") and not s.endswith("USDT"):
        s = s + "T"             # "BTCUSD" (borsa adı) -> BTCUSDT
    return s


def to_ccxt(sym: str, settle: str = "USDT") -> str:
    """'BTCUSDT' -> 'BTC/USDT:USDT' (ccxt vadeli sembolü)."""
    sym = str(sym).upper().strip()
    if "/" in sym:
        return sym if ":" in sym else f"{sym}:{settle}"
    s = norm_crypto(sym)
    for q in QUOTES:
        if s.endswith(q) and len(s) > len(q):
            return f"{s[:-len(q)]}/{q}:{q if q in ('USDT', 'USDC', 'BUSD', 'FDUSD') else settle}"
    return f"{s}/USDT:USDT"


_FIAT = ("EUR", "GBP", "JPY", "CHF", "AUD", "NZD", "CAD", "TRY", "SEK", "NOK", "DKK", "ZAR", "MXN", "PLN", "HKD", "SGD", "CNH", "HUF", "CZK", "USD")


def is_crypto_symbol(sym: str, known: Optional[set] = None) -> bool:
    """Sembol kripto mu? Açık USDT/USDC eki -> evet; döviz çifti (GBPUSD, EURUSD) -> hayır;
    MT5 tarzı BTCUSD gibi adlar yalnızca 'known' (borsa listesi) içinde karşılığı varsa kriptodur."""
    raw = "".join(ch for ch in str(sym).upper() if ch.isalnum())
    if any(raw.endswith(q) and len(raw) > len(q) for q in ("USDT", "USDC", "BUSD", "FDUSD")):
        return True
    if len(raw) == 6 and raw[:3] in _FIAT and raw[3:] in _FIAT:
        return False  # döviz çifti
    if known and norm_crypto(raw) in known and not (raw[:3] in _FIAT and raw.endswith("USD")):
        return True
    return False


@dataclass
class CryptoConfig:
    exchange: str = "binance"      # ccxt id: binance | bybit | okx | mexc | kucoinfutures ...
    api_key: str = ""
    secret: str = ""
    password: str = ""             # okx / kucoin passphrase
    demo: bool = True              # Binance Demo Trading (test ağı)
    leverage: int = 5
    margin_mode: str = "isolated"  # isolated | cross
    order_usdt: float = 50.0       # işlem başına teminat tutarı (USDT)
    max_symbols: int = 60

    @classmethod
    def from_dict(cls, d: Optional[dict]) -> "CryptoConfig":
        d = d or {}
        c = cls()
        for k in ("exchange", "api_key", "secret", "password", "margin_mode"):
            if d.get(k) is not None:
                setattr(c, k, str(d[k]))
        if d.get("demo") is not None:
            c.demo = bool(d["demo"])
        if d.get("leverage"):
            c.leverage = max(1, min(125, int(d["leverage"])))
        if d.get("order_usdt"):
            c.order_usdt = max(5.0, float(d["order_usdt"]))
        if d.get("max_symbols"):
            c.max_symbols = int(d["max_symbols"])
        return c


class CryptoEngine:
    """ccxt tabanlı vadeli motor. Tüm çağrılar tek kilitle sıralanır (ccxt senkron istemcisi)."""

    def __init__(self, cfg: CryptoConfig, magic: int = 770077) -> None:
        self.cfg = cfg
        self.magic = magic
        self.connected = False
        self.ex: Any = None
        self._lock = threading.RLock()
        self._lev_set: set[str] = set()
        self._rates_cache: dict[tuple[str, str], tuple[float, pd.DataFrame]] = {}
        self._last_px: dict[str, tuple[float, float]] = {}
        self._kanal_quality_cache: dict[str, tuple[float, dict]] = {}
        self.markets: dict[str, Any] = {}
        self.known: set[str] = set()
        self.label = f"{cfg.exchange.upper()} {'DEMO' if cfg.demo else 'CANLI'} vadeli"

    # ------------------------------------------------------------------ bağlantı
    def connect(self) -> bool:
        with self._lock:
            if ccxt is None:
                log.error("ccxt kurulu değil: pip install ccxt")
                return False
            try:
                klass = getattr(ccxt, self.cfg.exchange)
                opts: dict[str, Any] = {
                    "apiKey": self.cfg.api_key, "secret": self.cfg.secret, "enableRateLimit": True,
                    "options": {"defaultType": "swap", "adjustForTimeDifference": True, "recvWindow": 10000},
                }
                if self.cfg.password:
                    opts["password"] = self.cfg.password
                ex = klass(opts)
                if self.cfg.demo:
                    if hasattr(ex, "enable_demo_trading"):
                        ex.enable_demo_trading(True)           # Binance Demo Trading (demo-fapi.binance.com)
                    else:
                        ex.set_sandbox_mode(True)              # diğer borsaların test ağı
                self.ex = ex
                self.markets = ex.load_markets()
                self.known = {norm_crypto(m["id"]) for m in self.markets.values() if m.get("swap") and m.get("active", True)}
                self.connected = True
                log.info("Kripto bağlandı: %s · %d vadeli sembol", self.label, len(self.known))
                return True
            except Exception as e:  # noqa: BLE001
                log.error("Kripto bağlantı hatası (%s): %s", self.label, e)
                self.connected = False
                return False

    def ensure_connected(self) -> bool:
        return self.connected or self.connect()

    def shutdown(self) -> None:
        self.connected = False

    # ------------------------------------------------------------------ yardımcı
    def resolve(self, name: str) -> str:
        """Panel adı -> ccxt sembolü; borsada yoksa hata."""
        s = norm_crypto(name)
        for m in self.markets.values():
            if m.get("swap") and norm_crypto(m["id"]) == s:
                return m["symbol"]
        cx = to_ccxt(name)
        if cx in self.markets:
            return cx
        raise RuntimeError(f"{name} {self.cfg.exchange} vadelide bulunamadı")

    def _market(self, name: str) -> Any:
        return self.markets[self.resolve(name)]

    def _ensure_leverage(self, cx: str) -> None:
        if cx in self._lev_set:
            return
        try:
            try:
                self.ex.set_margin_mode(self.cfg.margin_mode, cx)
            except Exception as e:  # noqa: BLE001
                if "No need to change" not in str(e) and "-4046" not in str(e):
                    log.debug("margin mode %s: %s", cx, e)
            self.ex.set_leverage(self.cfg.leverage, cx)
        except Exception as e:  # noqa: BLE001
            log.warning("Kaldıraç ayarlanamadı %s: %s", cx, e)
        self._lev_set.add(cx)

    def _amount(self, cx: str, price: float, usdt: Optional[float] = None) -> float:
        m = self.markets[cx]
        notional = (usdt or self.cfg.order_usdt) * self.cfg.leverage
        amt = notional / price
        amt = float(self.ex.amount_to_precision(cx, amt))
        mn = ((m.get("limits") or {}).get("amount") or {}).get("min") or 0
        mn_cost = ((m.get("limits") or {}).get("cost") or {}).get("min") or 0
        if mn and amt < mn:
            amt = float(mn)
        if mn_cost and amt * price < mn_cost:
            amt = float(self.ex.amount_to_precision(cx, (mn_cost * 1.02) / price))
        return amt

    # ------------------------------------------------------------------ hesap
    def account(self) -> AccountSnapshot:
        with self._lock:
            if not self.ensure_connected():
                return AccountSnapshot(False, server=self.label)
            try:
                b = self.ex.fetch_balance()
                tot = b.get("total", {}) or {}
                free = b.get("free", {}) or {}
                used = b.get("used", {}) or {}
                cur = "USDT" if "USDT" in tot else next(iter(tot), "USDT")
                bal = float(tot.get(cur, 0) or 0)
                pos = self.positions()
                upnl = sum(p.pnl for p in pos)
                info = b.get("info") or {}
                wallet = float(info.get("totalWalletBalance") or bal) if isinstance(info, dict) else bal
                equity = float(info.get("totalMarginBalance") or (wallet + upnl)) if isinstance(info, dict) else wallet + upnl
                return AccountSnapshot(True, self.label, (self.cfg.api_key or "")[:6] + "…", round(wallet, 2), round(equity, 2),
                                       round(float(used.get(cur, 0) or 0), 2), round(float(free.get(cur, 0) or 0), 2), cur,
                                       self.cfg.leverage, algo=True, tradeAllowed=True)
            except Exception as e:  # noqa: BLE001
                log.warning("Kripto hesap okunamadı: %s", e)
                self.connected = False
                return AccountSnapshot(False, server=self.label)

    def positions(self) -> list[Position]:
        with self._lock:
            if not self.ensure_connected():
                return []
            out: list[Position] = []
            try:
                for p in self.ex.fetch_positions():
                    amt = float(p.get("contracts") or 0)
                    if amt <= 0:
                        continue
                    cx = p["symbol"]
                    name = norm_crypto(self.markets.get(cx, {}).get("id") or cx.split(":")[0])
                    side = "BUY" if (p.get("side") or "").lower() == "long" else "SELL"
                    sl, tp = self._sltp_from_orders(cx)
                    out.append(Position(
                        ticket=int(abs(hash(cx)) % 10**9), symbol=name, side=side, volume=amt,
                        openPrice=float(p.get("entryPrice") or 0), currentPrice=float(p.get("markPrice") or p.get("entryPrice") or 0),
                        sl=sl, tp=tp, pnl=round(float(p.get("unrealizedPnl") or 0), 2), comment="CRYPTO", magic=self.magic,
                    ))
            except Exception as e:  # noqa: BLE001
                log.warning("Kripto pozisyonlar okunamadı: %s", e)
            return out

    def _sltp_from_orders(self, cx: str) -> tuple[float, float]:
        sl = tp = 0.0
        try:
            for o in self.ex.fetch_open_orders(cx):
                t = str(o.get("type") or "").lower()
                px = o.get("stopPrice") or o.get("triggerPrice") or (o.get("info") or {}).get("stopPrice")
                if not px:
                    continue
                if "stop" in t and "take" not in t:
                    sl = float(px)
                elif "take" in t:
                    tp = float(px)
        except Exception:  # noqa: BLE001
            pass
        return sl, tp

    # ------------------------------------------------------------------ veri
    def tick(self, symbol: str) -> tuple[float, float]:
        with self._lock:
            cx = self.resolve(symbol)
            t = self.ex.fetch_ticker(cx)
            bid = float(t.get("bid") or t.get("last") or 0)
            ask = float(t.get("ask") or t.get("last") or 0)
            return bid, ask

    def kanal_market_quality(self, symbol: str, cache_seconds: float = 20.0) -> dict:
        """KANAL kalite verisi: order-book spread, 24h quote volume, min notional, funding ve ticker yaşı."""
        with self._lock:
            now = time.time()
            key = norm_crypto(symbol)
            cached = self._kanal_quality_cache.get(key)
            if cached and now - cached[0] < cache_seconds:
                return dict(cached[1])
            if not self.ensure_connected():
                raise RuntimeError("Kripto borsası bağlı değil")
            cx = self.resolve(symbol)
            ticker = self.ex.fetch_ticker(cx)
            last = float(ticker.get("last") or ticker.get("close") or 0)
            bid = float(ticker.get("bid") or 0)
            ask = float(ticker.get("ask") or 0)
            book_ok = False
            try:
                book = self.ex.fetch_order_book(cx, limit=5)
                bids = book.get("bids") or []
                asks = book.get("asks") or []
                if bids and asks and float(bids[0][0]) > 0 and float(asks[0][0]) > 0:
                    bid, ask = float(bids[0][0]), float(asks[0][0])
                    book_ok = True
            except Exception as e:  # noqa: BLE001
                log.debug("KANAL order-book %s: %s", cx, e)
            mid = (bid + ask) / 2 if bid > 0 and ask > 0 else 0
            spread_pct = (ask - bid) / mid * 100 if mid > 0 and ask >= bid else None
            quote_volume = float(ticker.get("quoteVolume") or 0)
            if quote_volume <= 0 and ticker.get("baseVolume") and last > 0:
                quote_volume = float(ticker["baseVolume"]) * last
            market = self.markets.get(cx) or {}
            limits = market.get("limits") or {}
            min_amount = float((limits.get("amount") or {}).get("min") or 0)
            min_cost = float((limits.get("cost") or {}).get("min") or 0)
            min_notional = max(min_cost, min_amount * last)
            order_notional = float(self.cfg.order_usdt) * float(self.cfg.leverage)
            stamp = ticker.get("timestamp")
            quote_age = max(0.0, now - float(stamp) / 1000) if stamp else None
            funding = None
            try:
                if getattr(self.ex, "has", {}).get("fetchFundingRate"):
                    fr = self.ex.fetch_funding_rate(cx)
                    raw_rate = fr.get("fundingRate")
                    funding = float(raw_rate) if raw_rate is not None else None
            except Exception as e:  # noqa: BLE001
                log.debug("KANAL funding %s: %s", cx, e)
            result = {
                "symbol": key, "bid": bid, "ask": ask, "mid": mid, "last": last,
                "spreadPct": spread_pct, "bookOk": book_ok, "quoteVolume24h": quote_volume,
                "minNotional": min_notional, "orderNotional": order_notional,
                "quoteAgeSeconds": quote_age, "fundingRate": funding,
            }
            self._kanal_quality_cache[key] = (now, result)
            return dict(result)

    def quotes(self, names: list[str]) -> list[dict]:
        with self._lock:
            if not self.ensure_connected() or not names:
                return []
            out: list[dict] = []
            now = time.time()
            try:
                cxs = []
                for n in names:
                    try:
                        cxs.append(self.resolve(n))
                    except Exception:  # noqa: BLE001
                        pass
                tks = self.ex.fetch_tickers(cxs) if cxs else {}
            except Exception as e:  # noqa: BLE001
                log.debug("fetch_tickers: %s", e)
                return []
            for cx, t in tks.items():
                m = self.markets.get(cx, {})
                name = norm_crypto(m.get("id") or cx.split(":")[0])
                bid = float(t.get("bid") or t.get("last") or 0)
                ask = float(t.get("ask") or t.get("last") or 0)
                if bid <= 0:
                    continue
                prev = self._last_px.get(name)
                if prev is None or prev[0] != bid:
                    self._last_px[name] = (bid, now)
                    stale = 0.0
                else:
                    stale = now - prev[1]
                prec = (m.get("precision") or {}).get("price")
                digits = int(round(-math.log10(prec))) if prec and prec < 1 else (int(prec) if prec else 2)
                out.append({"s": name, "real": cx, "bid": bid, "ask": ask, "t": int((t.get("timestamp") or now * 1000) / 1000),
                            "stale": round(stale, 1), "digits": digits, "point": 10 ** (-digits), "stops": 0, "src": "crypto"})
            return out

    def rates(self, symbol: str, timeframe: str = "H1", count: int = 320, ttl: float = 5.0) -> pd.DataFrame:
        with self._lock:
            if not self.ensure_connected():
                raise RuntimeError("borsaya bağlı değil")
            key = (norm_crypto(symbol), timeframe)
            hit = self._rates_cache.get(key)
            if hit and time.time() - hit[0] < ttl and len(hit[1]) >= count:
                return hit[1].tail(count).reset_index(drop=True)
            cx = self.resolve(symbol)
            tf = CCXT_TF.get(timeframe)
            if not tf:
                raise RuntimeError(f"zaman dilimi desteklenmiyor: {timeframe}")
            raw = self.ex.fetch_ohlcv(cx, tf, limit=min(1000, count))
            if not raw:
                raise RuntimeError(f"{symbol} {timeframe} verisi alınamadı")
            df = pd.DataFrame(raw, columns=["time", "open", "high", "low", "close", "tick_volume"])
            df["time"] = pd.to_datetime(df["time"], unit="ms")
            self._rates_cache[key] = (time.time(), df)
            return df

    def market_watch_symbols(self, limit: int = 60) -> list[str]:
        """Borsadaki vadeli USDT çiftleri (hacme göre ilk N)."""
        with self._lock:
            if not self.ensure_connected():
                return []
            try:
                tks = self.ex.fetch_tickers()
                rows = []
                for cx, t in tks.items():
                    m = self.markets.get(cx)
                    if not m or not m.get("swap") or m.get("quote") != "USDT":
                        continue
                    rows.append((float(t.get("quoteVolume") or 0), norm_crypto(m["id"])))
                rows.sort(reverse=True)
                return [n for _, n in rows[:limit]]
            except Exception as e:  # noqa: BLE001
                log.debug("market_watch_symbols: %s", e)
                return sorted(self.known)[:limit]

    def market_snapshot(self, symbol: str, timeframe: str, count: int = 300) -> dict:
        df = self.rates(symbol, timeframe, count)
        bid, ask = self.tick(symbol)
        candles = [[int(t.timestamp()), float(o), float(h), float(l), float(c), int(v)]
                   for t, o, h, l, c, v in zip(df["time"], df["open"], df["high"], df["low"], df["close"], df["tick_volume"])]
        return {"symbol": norm_crypto(symbol), "timeframe": timeframe, "bid": bid, "ask": ask, "candles": candles, "src": "crypto"}

    # ------------------------------------------------------------------ emir
    def _place_sltp(self, cx: str, side: str, sl: float | None, tp: float | None) -> list[str]:
        """Pozisyon için SL / TP koruma emirleri (closePosition: tüm pozisyonu kapatır, reduceOnly)."""
        close_side = "sell" if side == "BUY" else "buy"
        notes = []
        for kind, px in (("sl", sl), ("tp", tp)):
            if not px:
                continue
            otype = "STOP_MARKET" if kind == "sl" else "TAKE_PROFIT_MARKET"
            try:
                self.ex.create_order(cx, otype, close_side, None, None,
                                     {"stopPrice": float(self.ex.price_to_precision(cx, px)), "closePosition": True,
                                      "workingType": "MARK_PRICE", "timeInForce": "GTE_GTC"})
                notes.append(f"{kind.upper()} {px}")
            except Exception as e:  # noqa: BLE001
                notes.append(f"{kind.upper()} konulamadı: {str(e)[:80]}")
        return notes

    def _cancel_sltp(self, cx: str) -> None:
        try:
            for o in self.ex.fetch_open_orders(cx):
                t = str(o.get("type") or "").lower()
                if "stop" in t or "take" in t:
                    self.ex.cancel_order(o["id"], cx)
        except Exception as e:  # noqa: BLE001
            log.debug("cancel sltp %s: %s", cx, e)

    def place_order(self, symbol: str, side: str, volume: float, sl: float | None = None, tp: float | None = None,
                    comment: str = "JARVIS", approved: bool = False, signal_price: float | None = None,
                    max_dev_pct: float = 1.5, magic: int | None = None, usdt: float | None = None) -> OrderResult:
        """Piyasa emri (vadeli). `volume` MT5 uyumluluğu için alınır; miktar USDT tutarından hesaplanır."""
        if not approved:
            return OrderResult(False, message="KESİN KURAL: Kullanıcı onayı olmadan emir gönderilemez.")
        with self._lock:
            if not self.ensure_connected():
                return OrderResult(False, retcode=10031, message=f"{self.label} bağlantısı yok.")
            try:
                cx = self.resolve(symbol)
            except Exception as e:  # noqa: BLE001
                return OrderResult(False, message=str(e))
            side = side.upper()
            try:
                self._ensure_leverage(cx)
                bid, ask = self.tick(symbol)
                px = ask if side == "BUY" else bid
                if signal_price:
                    dev = abs(px - signal_price) / px * 100
                    if dev > max_dev_pct:
                        return OrderResult(False, retcode=10015, message=f"Sinyal fiyatı güncel değil: {signal_price} / {px} (%{dev:.2f}).")
                if sl and ((side == "BUY" and sl >= px) or (side == "SELL" and sl <= px)):
                    return OrderResult(False, retcode=10016, message=f"SL yanlış tarafta: {sl} (güncel {px}).")
                if tp and ((side == "BUY" and tp <= px) or (side == "SELL" and tp >= px)):
                    return OrderResult(False, retcode=10016, message=f"TP yanlış tarafta: {tp} (güncel {px}).")
                amt = self._amount(cx, px, usdt)
                o = self.ex.create_order(cx, "market", side.lower(), amt, None, {"newClientOrderId": f"jrv{int(time.time())}"[:32]})
                fill = float(o.get("average") or o.get("price") or px)
                notes = self._place_sltp(cx, side, sl, tp)
                oid = str(o.get("id"))
                return OrderResult(True, int(abs(hash(cx)) % 10**9), fill, 10009,
                                   f"{self.label}: {amt} {cx.split('/')[0]} @ {fill}" + (" · " + " | ".join(notes) if notes else ""),
                                   position=int(abs(hash(cx)) % 10**9))
            except Exception as e:  # noqa: BLE001
                return OrderResult(False, message=f"{self.label} emir hatası: {str(e)[:200]}")

    def modify_position(self, ticket: int, sl: float | None = None, tp: float | None = None) -> OrderResult:
        with self._lock:
            p = next((x for x in self.positions() if x.ticket == int(ticket)), None)
            if not p:
                return OrderResult(False, message="Pozisyon bulunamadı.")
            cx = self.resolve(p.symbol)
            new_sl = p.sl if sl is None else float(sl)
            new_tp = p.tp if tp is None else float(tp)
            buy = p.side == "BUY"
            ref = p.currentPrice
            if new_sl and ((buy and new_sl >= ref) or ((not buy) and new_sl <= ref)):
                return OrderResult(False, retcode=10016, message=f"SL {new_sl} geçersiz (güncel {ref}).")
            if new_tp and ((buy and new_tp <= ref) or ((not buy) and new_tp >= ref)):
                return OrderResult(False, retcode=10016, message=f"TP {new_tp} geçersiz (güncel {ref}).")
            self._cancel_sltp(cx)
            notes = self._place_sltp(cx, p.side, new_sl or None, new_tp or None)
            return OrderResult(True, p.ticket, ref, 10009, " · ".join(notes) or "SL/TP kaldırıldı")

    def close_position(self, ticket: int) -> OrderResult:
        with self._lock:
            p = next((x for x in self.positions() if x.ticket == int(ticket)), None)
            if not p:
                return OrderResult(False, message="Pozisyon bulunamadı (kapanmış olabilir).")
            cx = self.resolve(p.symbol)
            try:
                self.ex.create_order(cx, "market", "sell" if p.side == "BUY" else "buy", p.volume, None, {"reduceOnly": True})
                self._cancel_sltp(cx)
                return OrderResult(True, p.ticket, p.currentPrice, 10009, "Pozisyon kapatıldı")
            except Exception as e:  # noqa: BLE001
                return OrderResult(False, message=f"Kapatılamadı: {str(e)[:160]}")

    def close_partial(self, ticket: int, fraction: float = 0.5) -> OrderResult:
        with self._lock:
            p = next((x for x in self.positions() if x.ticket == int(ticket)), None)
            if not p:
                return OrderResult(False, message="Pozisyon bulunamadı.")
            cx = self.resolve(p.symbol)
            part = float(self.ex.amount_to_precision(cx, p.volume * min(0.9, max(0.1, fraction))))
            mn = ((self.markets[cx].get("limits") or {}).get("amount") or {}).get("min") or 0
            if part <= 0 or (mn and (part < mn or p.volume - part < mn)):
                return OrderResult(False, retcode=10014, message=f"{p.volume} bölünemeyecek kadar küçük (min {mn}).")
            try:
                self.ex.create_order(cx, "market", "sell" if p.side == "BUY" else "buy", part, None, {"reduceOnly": True})
                return OrderResult(True, p.ticket, p.currentPrice, 10009, f"{part} kapatıldı (kalan {round(p.volume - part, 6)})")
            except Exception as e:  # noqa: BLE001
                return OrderResult(False, message=f"Kısmi kapatma hatası: {str(e)[:160]}")

    def partial_done(self, ticket: int) -> bool:
        return False  # borsa geçmişinden kısmi kapanışı ayırt etmek güvenilir değil; ajan kendi kaydını tutar

    def deal_summary(self, ticket: int) -> Optional[dict]:
        return None
