"""
kanal_strategy.py — KANAL stratejisi v2 (KANAL3BAND + RSI + CCI/MA)
==================================================================
Panel (src/lib/kanal.ts) ve MQL5 EA (KANAL_Strateji.mq5) ile AYNI mantık.

ALIŞ : 1) Mum TÜM alt bantların (en dış bant = merkez − 4.2×ATR) DIŞINDA KAPANIR (fitil yetmez)
       2) RSI 30'un altında kapanmıştır
       3) Fiyat GERİ DÖNER: son kapanan mum tekrar en dış bandın İÇİNDE kapanır (bant dışı kapanış daha önce)
       4) RSI 30'u YUKARI keser (bant dışı kapanış bu kesişimden önce / aynı mumda)
       5) CCI mor çizgiyi (CCI MA) YUKARI keser
SATIŞ: tersi — TÜM üst bantların dışında kapanış, RSI 70 üstü, bant içine dönüş, RSI 70'i AŞAĞI keser, CCI mor çizgiyi AŞAĞI keser.

SL : ALIŞ → RSI 30'u yukarı kesmeden önceki EN DÜŞÜK fiyat · SATIŞ → RSI 70'i aşağı kesmeden önceki EN YÜKSEK fiyat
TP : bandın MERKEZ çizgisi (ilk hedef)
Zaman dilimleri: M3, M5, M15, H1 (panelden seçilir). Sinyal kapanmış mumda, ilk kez tamamlandığında bir kez oluşur.
"""
from __future__ import annotations

import math
from dataclasses import dataclass, fields
from typing import Any, Optional

import numpy as np
import pandas as pd

KANAL_TFS = ("M3", "M5", "M15", "H1")


@dataclass
class KanalParams:
    halfLength: int = 60
    atrPeriod: int = 100
    atrMult1: float = 4.2
    atrMult2: float = 3.5
    atrMult3: float = 2.8
    setupLookback: int = 10      # bant dışı kapanış en fazla kaç mum önce
    crossMaxAge: int = 10        # RSI + CCI kesişimi en fazla kaç mum önce (ve şu an hâlâ onaylı)
    minBreakAtr: float = 0.0     # "kesin kapanış" payı (ATR×)
    rsiPeriod: int = 14
    rsiOb: float = 70.0
    rsiOs: float = 30.0
    cciPeriod: int = 34
    cciMaPeriod: int = 21
    slPadAtr: float = 0.0        # eski ayar uyumluluğu; yeni akışta kullanılmaz
    tpMode: str = "center"       # eski ayar uyumluluğu; TP daima merkez çizgisi
    cryptoSpreadMaxPct: float = 0.15
    cryptoMinVolume24h: float = 5_000_000.0
    fundingPenaltyThresholdPct: float = 0.10

    @classmethod
    def from_dict(cls, d: Optional[dict]) -> "KanalParams":
        d = d or {}
        out = cls()
        for f in fields(cls):
            if f.name in d and d[f.name] is not None and d[f.name] != "":
                try:
                    v = d[f.name]
                    cur = getattr(out, f.name)
                    if isinstance(cur, bool):
                        v = bool(v)
                    elif isinstance(cur, int):
                        v = int(round(float(v)))
                    elif isinstance(cur, float):
                        v = float(v)
                    else:
                        v = str(v)
                    setattr(out, f.name, v)
                except (TypeError, ValueError):
                    pass
        cl = lambda v, lo, hi: min(hi, max(lo, v))  # noqa: E731
        out.halfLength = cl(out.halfLength, 5, 200)
        out.atrPeriod = cl(out.atrPeriod, 10, 300)
        out.atrMult1, out.atrMult2, out.atrMult3 = (cl(out.atrMult1, 0.5, 10), cl(out.atrMult2, 0.5, 10), cl(out.atrMult3, 0.5, 10))
        out.setupLookback = cl(out.setupLookback, 2, 30)
        out.crossMaxAge = min(out.setupLookback, cl(out.crossMaxAge, 1, 30))
        out.minBreakAtr = cl(out.minBreakAtr, 0.0, 2.0)
        out.rsiPeriod = cl(out.rsiPeriod, 2, 50)
        out.rsiOb = cl(out.rsiOb, 50.0, 95.0)
        out.rsiOs = cl(out.rsiOs, 5.0, 50.0)
        out.cciPeriod = cl(out.cciPeriod, 5, 100)
        out.cciMaPeriod = cl(out.cciMaPeriod, 2, 100)
        out.slPadAtr = cl(out.slPadAtr, 0.0, 3.0)
        out.tpMode = "band" if out.tpMode == "band" else "center"
        out.cryptoSpreadMaxPct = cl(out.cryptoSpreadMaxPct, 0.01, 5.0)
        out.cryptoMinVolume24h = cl(out.cryptoMinVolume24h, 0.0, 100_000_000_000.0)
        out.fundingPenaltyThresholdPct = cl(out.fundingPenaltyThresholdPct, 0.001, 5.0)
        return out


# --------------------------------------------------------------------------- #
def center_at(pr: np.ndarray, i: int, H: int, n_eff: Optional[int] = None) -> Optional[float]:
    if i - H < 0:
        return None
    n = len(pr) if n_eff is None else n_eff
    w = np.arange(H, 0, -1, dtype=float)
    s = (H + 1) * pr[i] + float(np.dot(w, pr[i - H:i][::-1]))
    sw = (H + 1) + float(w.sum())
    m = min(H, n - 1 - i)
    if m > 0:
        s += float(np.dot(w[:m], pr[i + 1:i + 1 + m]))
        sw += float(w[:m].sum())
    return s / sw


def atr_at(h: np.ndarray, l: np.ndarray, c: np.ndarray, i: int, P: int) -> Optional[float]:
    if i < P + 10:
        return None
    q = np.arange(i - 10 - P + 1, i - 10 + 1)
    return float((np.maximum(h[q], c[q - 1]) - np.minimum(l[q], c[q - 1])).sum() / P)


def rsi_wilder(close: np.ndarray, period: int) -> np.ndarray:
    n = len(close)
    out = np.full(n, np.nan)
    if n <= period:
        return out
    d = np.diff(close)
    up = np.where(d > 0, d, 0.0)
    dn = np.where(d < 0, -d, 0.0)
    au, ad = up[:period].mean(), dn[:period].mean()

    def val(u: float, dd: float) -> float:
        if dd == 0:
            return 100.0
        if u == 0:
            return 0.0
        return 100.0 - 100.0 / (1.0 + u / dd)

    out[period] = val(au, ad)
    for i in range(period + 1, n):
        au = (au * (period - 1) + up[i - 1]) / period
        ad = (ad * (period - 1) + dn[i - 1]) / period
        out[i] = val(au, ad)
    return out


def cci_series(h: np.ndarray, l: np.ndarray, c: np.ndarray, period: int) -> np.ndarray:
    tp = (h + l + c) / 3.0
    n = len(tp)
    out = np.full(n, np.nan)
    if n < period:
        return out
    win = np.lib.stride_tricks.sliding_window_view(tp, period)
    sma = win.mean(axis=1)
    md = np.abs(win - sma[:, None]).mean(axis=1)
    with np.errstate(divide="ignore", invalid="ignore"):
        out[period - 1:] = np.where(md == 0, 0.0, (tp[period - 1:] - sma) / (0.015 * md))
    return out


def sma_series(src: np.ndarray, period: int) -> np.ndarray:
    n = len(src)
    out = np.full(n, np.nan)
    valid = np.where(~np.isnan(src))[0]
    if len(valid) == 0:
        return out
    for i in range(int(valid[0]) + period - 1, n):
        out[i] = src[i - period + 1:i + 1].mean()
    return out


def kanal_levels(side: str, entry: float, extreme: float, center: float, atr: float,
                 p: Optional[KanalParams] = None) -> tuple[float, float]:
    """SL = dönüş öncesi RSI ekstremi, TP = KANAL3BAND merkez çizgisi."""
    return float(extreme), float(center)


def kanal_confidence(side: str, depth: float, rsi_peak: Optional[float], cci: Optional[float], cci_ma: Optional[float],
                     entry: float, sl: Optional[float], tp: Optional[float], p: Optional[KanalParams] = None) -> dict:
    """60 + derinlik min(10, ATR×20) + RSI aşırılığı min(15, |seviye−tepe|) + CCI–MA min(5, fark/20) + R:R (≥2→10, ≥1.5→7, ≥1→4)"""
    p = p or KanalParams()
    depth_p = max(0.0, min(10.0, depth * 20))
    rsi_p = 0.0 if rsi_peak is None else max(0.0, min(15.0, (p.rsiOs - rsi_peak) if side == "BUY" else (rsi_peak - p.rsiOb)))
    cci_p = 0.0 if (cci is None or cci_ma is None) else max(0.0, min(5.0, abs(cci - cci_ma) / 20))
    rr = abs(tp - entry) / abs(entry - sl) if (sl is not None and tp is not None and abs(entry - sl) > 0) else 0.0
    rr_p = 10 if rr >= 2 else 7 if rr >= 1.5 else 4 if rr >= 1 else 0
    score = min(99, math.floor(60 + depth_p + rsi_p + cci_p + rr_p + 0.5))
    r1 = lambda v: round(v * 10) / 10  # noqa: E731
    return {"score": int(score), "rr": rr,
            "parts": {"base": 60, "depth": r1(depth_p), "rsi": r1(rsi_p), "cci": r1(cci_p), "rr": rr_p}}


def _num(x: Any) -> Optional[float]:
    return None if x is None or (isinstance(x, float) and np.isnan(x)) else float(x)


# --------------------------------------------------------------------------- #
def kanal_analyze(symbol: str, tf: str, df: pd.DataFrame, p: Optional[KanalParams] = None,
                  entry: Optional[float] = None) -> Optional[dict[str, Any]]:
    """5 aşamalı sıralı KANAL kurulumu; son satır oluşan mum, n-2 son kapanmış mum."""
    p = p or KanalParams()
    n = len(df)
    if n < p.atrPeriod + p.halfLength + 30:
        return None
    t = n - 2
    h, l, c = (df[k].to_numpy(float) for k in ("high", "low", "close"))
    pr = (h + l + 2.0 * c) / 4.0
    rsi = rsi_wilder(c, p.rsiPeriod)
    cci = cci_series(h, l, c, p.cciPeriod)
    ma = sma_series(cci, p.cciMaPeriod)
    M = max(p.atrMult1, p.atrMult2, p.atrMult3)
    ttl = {"M3": 10, "M5": 10, "M15": 8, "H1": 6}.get(str(tf).upper(), p.setupLookback)
    frm = max(1, t - ttl)
    cy: dict[int, Optional[float]] = {}
    atr: dict[int, Optional[float]] = {}
    for i in range(max(1, frm - 2), t + 1):
        cy[i] = center_at(pr, i, p.halfLength, n - 1)
        atr[i] = atr_at(h, l, c, i, p.atrPeriod)

    def valid(*vals: float) -> bool:
        return all(not np.isnan(x) for x in vals)

    def eval_side(sell: bool) -> dict:
        empty = {"brk": False, "ext": False, "ret": False, "rsi": False, "cci": False,
                 "extreme": -np.inf if sell else np.inf, "depth": 0.0, "peak": None,
                 "m0": None, "mr": None, "rsiAt": None, "cciAt": None, "stage": 0}
        # M0: dış bant DIŞINDA kapanış ve aynı kapanmış mumda RSI aşırı bölgesi.
        m0 = None
        for b in range(t, frm - 1, -1):
            center, a, rv = cy.get(b), atr.get(b), rsi[b]
            if center is None or a is None or a <= 0 or np.isnan(rv):
                continue
            outside = c[b] > center + M*a if sell else c[b] < center - M*a
            ext = rv > p.rsiOb if sell else rv < p.rsiOs
            if outside and ext:
                m0 = b
                break
        if m0 is None:
            return empty
        out = {**empty, "brk": True, "ext": True, "m0": m0, "peak": float(rsi[m0])}
        c0, a0 = cy[m0], atr[m0]
        out["depth"] = ((c[m0] - (c0 + M*a0))/a0) if sell else (((c0 - M*a0) - c[m0])/a0)
        # Güvenli dönüş: dönüş M0'dan sonra ve en az 0.10 ATR kadar içeri kapanış.
        mr = None
        for b in range(m0 + 1, t + 1):
            center, a = cy.get(b), atr.get(b)
            if center is None or a is None:
                continue
            outer = center + M*a if sell else center - M*a
            if (c[b] <= outer - 0.10*a) if sell else (c[b] >= outer + 0.10*a):
                mr = b
                break
        if mr is None:
            out["stage"] = 2
            return out
        out.update(ret=True, mr=mr)
        # Aşama 4: RSI kesişimi MR mumunda veya sonrasında olabilir; güncel RSI teyit tarafında kalmalı.
        rsi_at = None
        for b in range(mr, t + 1):
            if not valid(rsi[b-1], rsi[b]):
                continue
            # Equality on the threshold is still the previous side: require a closed bar strictly across it.
            # BUY: <= 30 -> > 30; SELL: >= 70 -> < 70.
            crossed = (rsi[b-1] >= p.rsiOb and rsi[b] < p.rsiOb) if sell else (rsi[b-1] <= p.rsiOs and rsi[b] > p.rsiOs)
            if crossed:
                rsi_at = b
        if rsi_at is None or np.isnan(rsi[t]) or ((rsi[t] >= p.rsiOb) if sell else (rsi[t] <= p.rsiOs)):
            out["stage"] = 3
            return out
        out.update(rsi=True, rsiAt=rsi_at)
        # Aşama 5 CCI/MA kesişimi RSI teyidinden sonra; mevcut değer doğru tarafta kalmalı.
        cci_at = None
        # CCI/MA cross can occur on the RSI confirmation bar; include that closed bar.
        for b in range(rsi_at, t + 1):
            if not valid(cci[b-1], cci[b], ma[b-1], ma[b]):
                continue
            crossed = (cci[b-1] >= ma[b-1] and cci[b] < ma[b]) if sell else (cci[b-1] <= ma[b-1] and cci[b] > ma[b])
            if crossed:
                cci_at = b
        if cci_at is None or not valid(cci[t], ma[t]) or ((cci[t] >= ma[t]) if sell else (cci[t] <= ma[t])):
            out["stage"] = 4
            return out
        out.update(cci=True, cciAt=cci_at, stage=5)
        return out

    sell, buy = eval_side(True), eval_side(False)
    ct, at = cy.get(t), atr.get(t)
    close = float(c[t])
    band_up = ct + M*at if ct is not None and at is not None else None
    band_dn = ct - M*at if ct is not None and at is not None else None
    pos = "above" if band_up is not None and close > band_up else "below" if band_dn is not None and close < band_dn else "inside"
    if sell["stage"] > buy["stage"]:
        side = "SELL"
    elif buy["stage"] > sell["stage"]:
        side = "BUY"
    elif sell["stage"] > 0:
        side = "SELL" if (sell["m0"] or 0) > (buy["m0"] or 0) else "BUY"
    else:
        side = None
    cur = sell if side == "SELL" else buy if side == "BUY" else None
    live = float(entry if entry is not None else c[n-1])
    sl = tp = extreme = rr_v = None
    conf, parts = 0, {"base": 0, "depth": 0, "rsi": 0, "cci": 0, "rr": 0}
    if side and cur and cur["m0"] is not None and ct is not None and at is not None:
        end = cur["rsiAt"] if cur["rsiAt"] is not None else t
        extreme = float(np.min(l[cur["m0"]:end+1])) if side == "BUY" else float(np.max(h[cur["m0"]:end+1]))
        sl, tp = kanal_levels(side, live, extreme, ct, at, p)
        tp = ct
        cf = kanal_confidence(side, cur["depth"], cur["peak"], _num(cci[t]), _num(ma[t]), live, sl, tp, p)
        conf, parts, rr_v = cf["score"], cf["parts"], cf["rr"]
    blocked = bool(cur and cur["stage"] == 5 and (rr_v is None or rr_v < 1.0 or sl is None or tp is None or (sl >= live or tp <= live if side == "BUY" else sl <= live or tp >= live)))
    armed = bool(cur and cur["stage"] == 5 and not blocked)
    fire = bool(armed and cur["cciAt"] == t)
    def epoch(idx: Optional[int]) -> Optional[int]:
        if idx is None:
            return None
        v = df["time"].iloc[idx]
        stamp = pd.Timestamp(v)
        if stamp.tzinfo is None:
            stamp = stamp.tz_localize("UTC")
        return int(stamp.timestamp())
    bar_time = epoch(t) or 0
    setup_time = epoch(cur["m0"]) if cur else None
    reason = ""
    if side and cur:
        reason = (f"{'Alt' if side == 'BUY' else 'Üst'} dış bant kapanışı + RSI bölgesi · "
                  f"{'0.10 ATR güvenli dönüş' if cur['ret'] else 'dönüş bekleniyor'} · "
                  f"{'RSI kesişti' if cur['rsi'] else 'RSI bekleniyor'} · "
                  f"{'CCI kesişti' if cur['cci'] else 'CCI bekleniyor'}" + (" · R:R < 1:1 — SİNYAL BLOKE" if blocked else ""))
    return {
        "symbol": symbol, "tf": tf, "price": live,
        "rsi": _num(rsi[t]), "cci": _num(cci[t]), "cciMa": _num(ma[t]),
        "center": ct, "bandUp": band_up, "bandDn": band_dn, "atr": at, "pos": pos,
        "side": side, "stage": cur["stage"] if cur else 0,
        "checks": {k: bool(cur[k]) for k in ("brk", "ext", "ret", "rsi", "cci")} if cur else {"brk": False, "ext": False, "ret": False, "rsi": False, "cci": False},
        "depth": cur["depth"] if cur else 0.0, "rsiPeak": cur["peak"] if cur else None,
        "armed": armed, "fire": fire, "entry": live, "sl": sl, "tp": tp, "extreme": extreme,
        "rr": rr_v, "confidence": conf, "confParts": parts, "reason": reason,
        "barTime": bar_time, "setupTime": setup_time,
        "events": {"m0": epoch(cur["m0"]) if cur else None, "mr": epoch(cur["mr"]) if cur else None,
                   "rsi": epoch(cur["rsiAt"]) if cur else None, "cci": epoch(cur["cciAt"]) if cur else None},
        "blockedReason": "R:R < 1:1 veya SL/TP yönü geçersiz" if blocked else None,
        "setupStates": {
            "BUY": {"stage": buy["stage"], "setupTime": epoch(buy["m0"]), "brk": bool(buy["brk"]), "ext": bool(buy["ext"])},
            "SELL": {"stage": sell["stage"], "setupTime": epoch(sell["m0"]), "brk": bool(sell["brk"]), "ext": bool(sell["ext"])},
        },
    }
