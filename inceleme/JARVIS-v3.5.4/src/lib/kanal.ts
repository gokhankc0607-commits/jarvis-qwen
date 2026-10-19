import { cciSeries, gmmaOscillator, rsiSeries, type Candle } from "./indicators";

/**
 * KANAL 5 aşamalı sıralı akışı — panel, Python ajanı ve MQL5 EA için ortak kurallar.
 * M0: dış bant dışında kapanış + aynı mumda RSI bölgesi. Sonra MR: en az 0.10 ATR kanal içine kapanış.
 * Ardından RSI eşiği kesişimi ve CCI/MA kesişimi sırasıyla aranır; dönüş mumunda RSI ve RSI teyit mumunda CCI kesişimi de kabul edilir (aynı kapanmış mumda olabilir). Kesişimler doğru tarafta kalmalıdır.
 * Setup TTL: M3/M5 10, M15 8, H1 6 bar. SL = M0'dan RSI teyidine kadar ekstrem, TP = merkez çizgi.
 * R:R < 1:1 bloke edilir; yalnızca CCI teyit mumunda, beş koşul aynı anda geçerliyken sinyal oluşur.
 */
export const KANAL_TFS = ["M3", "M5", "M15", "H1"] as const;
export type TpMode = "center" | "band";

export type KanalParams = {
  halfLength: number; atrPeriod: number; atrMult1: number; atrMult2: number; atrMult3: number;
  setupLookback: number; // bant dışı kapanış en fazla kaç mum önce olabilir
  crossMaxAge: number; // RSI ve CCI kesişimi en fazla kaç mum önce olabilir (ayrıca şu an hâlâ onaylı olmalı)
  minBreakAtr: number; // "kesin kapanış": en dış bandın en az bu kadar (ATR×) dışında kapanış (0 = dışında olması yeter)
  rsiPeriod: number; rsiOb: number; rsiOs: number;
  cciPeriod: number; cciMaPeriod: number;
  slPadAtr: number; // eski ayar uyumluluğu; sıralı akışta kullanılmaz
  tpMode: TpMode; // eski ayar uyumluluğu; hedef daima merkez çizgidir
  cryptoSpreadMaxPct: number; cryptoMinVolume24h: number; fundingPenaltyThresholdPct: number;
  guppyConfirm: boolean; // Guppy GMMA OSC teyidi: opsiyonel 6. koşul — girişte OSC>sinyal (ALIŞ) / OSC<sinyal (SATIŞ); kapalıysa davranış v3.5.3 ile aynı
  guppySet: "Guppy" | "SuperGuppy";
  guppySmoothLen: number; // osc SMA yumuşatma periyodu (Pine varsayılanı 1)
  guppySignalLen: number; // sinyal EMA periyodu (Pine varsayılanı 10)
};

export const KANAL_DEFAULTS: KanalParams = {
  halfLength: 60, atrPeriod: 100, atrMult1: 4.2, atrMult2: 3.5, atrMult3: 2.8,
  setupLookback: 10, crossMaxAge: 10, minBreakAtr: 0,
  rsiPeriod: 14, rsiOb: 70, rsiOs: 30, cciPeriod: 34, cciMaPeriod: 21,
  slPadAtr: 0, tpMode: "center",
  cryptoSpreadMaxPct: 0.15, cryptoMinVolume24h: 5_000_000, fundingPenaltyThresholdPct: 0.10,
  guppyConfirm: false, guppySet: "Guppy", guppySmoothLen: 1, guppySignalLen: 10,
};

const clamp = (v: unknown, lo: number, hi: number, d: number, int = false) => {
  const n = Number(v);
  if (v === undefined || v === null || v === "" || !Number.isFinite(n)) return d;
  const c = Math.min(hi, Math.max(lo, n));
  return int ? Math.round(c) : c;
};

export function sanitizeParams(p?: Record<string, unknown> | Partial<KanalParams> | null): KanalParams {
  const x = (p ?? {}) as Record<string, unknown>;
  const D = KANAL_DEFAULTS;
  const setupLookback = clamp(x.setupLookback, 2, 30, D.setupLookback, true);
  return {
    halfLength: clamp(x.halfLength, 5, 200, D.halfLength, true),
    atrPeriod: clamp(x.atrPeriod, 10, 300, D.atrPeriod, true),
    atrMult1: clamp(x.atrMult1, 0.5, 10, D.atrMult1),
    atrMult2: clamp(x.atrMult2, 0.5, 10, D.atrMult2),
    atrMult3: clamp(x.atrMult3, 0.5, 10, D.atrMult3),
    setupLookback,
    crossMaxAge: Math.min(setupLookback, clamp(x.crossMaxAge, 1, 30, D.crossMaxAge, true)),
    minBreakAtr: clamp(x.minBreakAtr, 0, 2, D.minBreakAtr),
    rsiPeriod: clamp(x.rsiPeriod, 2, 50, D.rsiPeriod, true),
    rsiOb: clamp(x.rsiOb, 50, 95, D.rsiOb),
    rsiOs: clamp(x.rsiOs, 5, 50, D.rsiOs),
    cciPeriod: clamp(x.cciPeriod, 5, 100, D.cciPeriod, true),
    cciMaPeriod: clamp(x.cciMaPeriod, 2, 100, D.cciMaPeriod, true),
    slPadAtr: clamp(x.slPadAtr, 0, 3, D.slPadAtr),
    tpMode: x.tpMode === "band" ? "band" : "center",
    cryptoSpreadMaxPct: clamp(x.cryptoSpreadMaxPct, 0.01, 5, D.cryptoSpreadMaxPct),
    cryptoMinVolume24h: clamp(x.cryptoMinVolume24h, 0, 100_000_000_000, D.cryptoMinVolume24h),
    fundingPenaltyThresholdPct: clamp(x.fundingPenaltyThresholdPct, 0.001, 5, D.fundingPenaltyThresholdPct),
    guppyConfirm: x.guppyConfirm === true || x.guppyConfirm === "true" || Number(x.guppyConfirm) === 1 ? true : x.guppyConfirm === false || x.guppyConfirm === "false" || x.guppyConfirm === undefined || x.guppyConfirm === null || x.guppyConfirm === "" ? D.guppyConfirm : Boolean(x.guppyConfirm),
    guppySet: x.guppySet === "SuperGuppy" ? "SuperGuppy" : "Guppy",
    guppySmoothLen: clamp(x.guppySmoothLen, 1, 50, D.guppySmoothLen, true),
    guppySignalLen: clamp(x.guppySignalLen, 1, 100, D.guppySignalLen, true),
  };
}

/* ------------------------------------------------------------------ yapı taşları (KANAL3BAND / KANAL-CCI / KANAL-RSI ile aynı) */
export const bandPrice = (c: Candle) => (c.high + c.low + 2 * c.close) / 4; // PB_WEIGHTED

/** Centered YSR: üçgen ağırlıklı merkezi ortalama. nEff: sağ kenar (strateji oluşmakta olan mumu hariç tutar). */
export function centerAt(pr: number[], i: number, H: number, nEff?: number): number | null {
  if (i - H < 0) return null;
  const n = nEff ?? pr.length;
  let sum = (H + 1) * pr[i];
  let sw = H + 1;
  let k = H;
  for (let j = 1; j <= H; j++) {
    sum += k * pr[i - j];
    sw += k;
    if (i + j <= n - 1) {
      sum += k * pr[i + j];
      sw += k;
    }
    k--;
  }
  return sum / sw;
}

/** KANAL3BAND'in ATR'si: TR'lerin basit ortalaması, 10 mum geriden. */
export function atrAt(c: Candle[], i: number, P: number): number | null {
  if (i < P + 10) return null;
  let sum = 0;
  for (let j = 0; j < P; j++) {
    const q = i - 10 - j;
    sum += Math.max(c[q].high, c[q - 1].close) - Math.min(c[q].low, c[q - 1].close);
  }
  return sum / P;
}

export function smaSeries(src: (number | null)[], period: number): (number | null)[] {
  const out: (number | null)[] = new Array(src.length).fill(null);
  const s = src.findIndex((v) => v !== null);
  if (s < 0) return out;
  for (let i = s + period - 1; i < src.length; i++) {
    let sum = 0;
    for (let k = 0; k < period; k++) sum += src[i - k] as number;
    out[i] = sum / period;
  }
  return out;
}

/** Grafik çizimi için tam seriler (merkez + 3 üst + 3 alt bant). */
export function kanalSeries(candles: Candle[], pIn?: Partial<KanalParams>) {
  const p = sanitizeParams(pIn);
  const n = candles.length;
  const pr = candles.map(bandPrice);
  const center: (number | null)[] = new Array(n).fill(null);
  const up: (number | null)[][] = [0, 1, 2].map(() => new Array(n).fill(null));
  const dn: (number | null)[][] = [0, 1, 2].map(() => new Array(n).fill(null));
  const mult = [p.atrMult1, p.atrMult2, p.atrMult3];
  for (let i = 0; i < n; i++) {
    const cy = centerAt(pr, i, p.halfLength);
    center[i] = cy;
    const a = atrAt(candles, i, p.atrPeriod);
    if (cy === null || a === null) continue;
    for (let k = 0; k < 3; k++) {
      up[k][i] = cy + mult[k] * a;
      dn[k][i] = cy - mult[k] * a;
    }
  }
  const close = candles.map((c) => c.close);
  const rsi = rsiSeries(close, p.rsiPeriod);
  const cci = cciSeries(candles, p.cciPeriod);
  const cciMa = smaSeries(cci, p.cciMaPeriod);
  const guppy = gmmaOscillator(close, { set: p.guppySet, smoothLen: p.guppySmoothLen, signalLen: p.guppySignalLen });
  return { center, up, dn, rsi, cci, cciMa, guppy, params: p };
}

/* ------------------------------------------------------------------ seviyeler + güven */
/** SL = RSI kesişiminden önceki dip/tepe ± pay · TP = merkez çizgi (ya da en yakın karşı bant). */
export function kanalLevels(side: "BUY" | "SELL", _entry: number, extreme: number, center: number, _atr: number, _pIn?: Partial<KanalParams>) {
  // Risk seviyesi M0 kurulumunun dönüş öncesi ekstremidir; TP merkez çizgisi.
  return { sl: extreme, tp: center };
}

export type ConfParts = { base: number; depth: number; rsi: number; cci: number; rr: number };

/**
 * Güven (0-99), şeffaf:
 *  60 (5/5 koşul yapısı) + bant dışı derinlik min(10, ATR×20) + RSI aşırılığı min(15, |seviye − RSI tepe/dip|)
 *  + CCI–mor çizgi farkı min(5, |fark|/20) + risk/ödül (≥2 → 10, ≥1.5 → 7, ≥1 → 4)
 */
export function kanalConfidence(side: "BUY" | "SELL", depth: number, rsiPeak: number | null, cci: number | null, cciMa: number | null, entry: number, sl: number | null, tp: number | null, pIn?: Partial<KanalParams>) {
  const p = sanitizeParams(pIn);
  const depthP = Math.max(0, Math.min(10, depth * 20));
  const rsiP = rsiPeak === null ? 0 : Math.max(0, Math.min(15, side === "BUY" ? p.rsiOs - rsiPeak : rsiPeak - p.rsiOb));
  const cciP = cci === null || cciMa === null ? 0 : Math.max(0, Math.min(5, Math.abs(cci - cciMa) / 20));
  const rr = sl !== null && tp !== null && Math.abs(entry - sl) > 0 ? Math.abs(tp - entry) / Math.abs(entry - sl) : 0;
  const rrP = rr >= 2 ? 10 : rr >= 1.5 ? 7 : rr >= 1 ? 4 : 0;
  const score = Math.min(99, Math.floor(60 + depthP + rsiP + cciP + rrP + 0.5));
  const r1 = (v: number) => Math.round(v * 10) / 10;
  return { score, rr, parts: { base: 60, depth: r1(depthP), rsi: r1(rsiP), cci: r1(cciP), rr: rrP } as ConfParts };
}

/* ------------------------------------------------------------------ strateji */
export type KanalItem = {
  symbol: string; tf: string; price: number;
  rsi: number | null; cci: number | null; cciMa: number | null;
  center: number | null; bandUp: number | null; bandDn: number | null; atr: number | null; // bandUp/Dn = EN DIŞ bantlar
  pos: "above" | "below" | "inside";
  side: "BUY" | "SELL" | null;
  stage: number; // 0-5: 1 bant dışı kapanış · 2 RSI aşırı bölgede · +1 bant içine dönüş · +1 RSI kesişimi · +1 CCI kesişimi
  checks: { brk: boolean; ext: boolean; ret: boolean; rsi: boolean; cci: boolean };
  depth: number; // bant dışı kapanış derinliği (ATR)
  rsiPeak: number | null; // pencere içindeki RSI dip (ALIŞ) / tepe (SATIŞ)
  armed: boolean; fire: boolean;
  guppyOk: boolean | null; // Guppy GMMA OSC teyit durumu (kapalıysa null)
  guppyExit: "none" | "cross" | "zone"; // açık pozisyon çıkış teyidi: none=yok, cross=OSC sinyalini ters kesti, zone=OSC sıfır bölgesine döndü
  entry: number | null; sl: number | null; tp: number | null; extreme: number | null; rr: number | null;
  confidence: number; confParts: ConfParts;
  reason: string; barTime: number; setupTime: number | null;
  events: { m0: number | null; mr: number | null; rsi: number | null; cci: number | null };
  blockedReason?: string;
  setupStates: Record<"BUY" | "SELL", { stage: number; setupTime: number | null; brk: boolean; ext: boolean }>;
};

type SideEval = { brk: boolean; ext: boolean; ret: boolean; rsi: boolean; cci: boolean; extreme: number; depth: number; peak: number | null };

const SETUP_TTL: Record<string, number> = { M3: 10, M5: 10, M15: 8, H1: 6 };

export function kanalAnalyze(symbol: string, tf: string, candles: Candle[], pIn?: Partial<KanalParams>, entry?: number): KanalItem | null {
  const p = sanitizeParams(pIn);
  const n = candles.length;
  if (n < p.atrPeriod + p.halfLength + 30) return null;
  const t = n - 2; // yalnızca son kapanmış mumu değerlendirme
  const pr = candles.map(bandPrice);
  const rsi = rsiSeries(candles.map((c) => c.close), p.rsiPeriod);
  const cci = cciSeries(candles, p.cciPeriod);
  const ma = smaSeries(cci, p.cciMaPeriod);
  // Guppy GMMA OSC teyidi (opsiyonel): osc/sinyal serileri kapanmış mumlarda değerlendirilir.
  const gm = gmmaOscillator(candles.map((c) => c.close), { set: p.guppySet, smoothLen: p.guppySmoothLen, signalLen: p.guppySignalLen });
  const guppyOkAt = (sell: boolean, i: number): boolean | null => {
    const o = gm.osc[i], s = gm.signal[i];
    if (o === null || s === null) return null;
    return sell ? o < s : o > s;
  };
  const M = Math.max(p.atrMult1, p.atrMult2, p.atrMult3);
  const ttl = SETUP_TTL[tf.toUpperCase()] ?? p.setupLookback;
  const from = Math.max(1, t - ttl);
  const cy: (number | null)[] = new Array(n).fill(null);
  const atr: (number | null)[] = new Array(n).fill(null);
  for (let i = from - 2; i <= t; i++) {
    if (i < 1) continue;
    cy[i] = centerAt(pr, i, p.halfLength, n - 1);
    atr[i] = atrAt(candles, i, p.atrPeriod);
  }
  const crossUp = (a: (number | null)[], b: (number | null)[], i: number) => i > 0 && a[i-1] !== null && a[i] !== null && b[i-1] !== null && b[i] !== null && a[i-1]! <= b[i-1]! && a[i]! > b[i]!;
  const crossDown = (a: (number | null)[], b: (number | null)[], i: number) => i > 0 && a[i-1] !== null && a[i] !== null && b[i-1] !== null && b[i] !== null && a[i-1]! >= b[i-1]! && a[i]! < b[i]!;
  type Eval = { brk:boolean; ext:boolean; ret:boolean; rsi:boolean; cci:boolean; extreme:number; depth:number; peak:number|null; m0:number|null; mr:number|null; rsiAt:number|null; cciAt:number|null; stage:number };
  const evalSide = (sell: boolean): Eval => {
    const empty: Eval = { brk:false, ext:false, ret:false, rsi:false, cci:false, extreme:sell?-Infinity:Infinity, depth:0, peak:null, m0:null, mr:null, rsiAt:null, cciAt:null, stage:0 };
    // M0 is strictly a CLOSED outer-band breakout with RSI already in the extreme zone.
    let m0 = -1;
    for (let b=t; b>=from; b--) {
      const center=cy[b], a=atr[b], rv=rsi[b];
      if (center===null || a===null || a<=0 || rv===null) continue;
      const outer=sell ? center+M*a : center-M*a;
      const outside=sell ? candles[b].close>outer : candles[b].close<outer;
      const extreme=sell ? rv>p.rsiOb : rv<p.rsiOs;
      if (outside && extreme) { m0=b; break; }
    }
    if (m0<0) return empty;
    const out: Eval = { ...empty, brk:true, ext:true, m0, peak:rsi[m0] };
    const m0Center=cy[m0]!, m0Atr=atr[m0]!;
    out.depth = sell ? (candles[m0].close-(m0Center+M*m0Atr))/m0Atr : ((m0Center-M*m0Atr)-candles[m0].close)/m0Atr;
    let mr = -1;
    // Safer return: close at least 0.10 ATR inside the outer band, on a later bar.
    for (let b=m0+1; b<=t; b++) {
      const center=cy[b], a=atr[b];
      if (center===null || a===null) continue;
      const outer=sell ? center+M*a : center-M*a;
      if (sell ? candles[b].close <= outer-0.10*a : candles[b].close >= outer+0.10*a) { mr=b; break; }
    }
    if (mr<0) { out.stage=2; return out; }
    out.ret=true; out.mr=mr;
    let rsiAt=-1;
    // MR mumunda RSI da eşiği kesebilir; aynı kapanmış mumdaki teyidi kaçırma.
    for (let b=mr; b<=t; b++) {
      const r0=rsi[b-1], r1=rsi[b];
      if (r0===null || r1===null) continue;
      // Threshold equality belongs to the prior side; confirm only after RSI closes strictly across it.
      // BUY: <= 30 → > 30; SELL: >= 70 → < 70. This catches an exact-threshold prior value.
      if (sell ? r0>=p.rsiOb && r1<p.rsiOb : r0<=p.rsiOs && r1>p.rsiOs) rsiAt=b;
    }
    const rNow=rsi[t];
    if (rsiAt<0 || rNow===null || (sell ? rNow>=p.rsiOb : rNow<=p.rsiOs)) { out.stage=3; return out; }
    out.rsi=true; out.rsiAt=rsiAt;
    let cciAt=-1;
    // RSI ve CCI/MA aynı kapanmış mumda kesişebilir; olay mumunu da dahil et.
    for (let b=rsiAt; b<=t; b++) {
      if (sell ? crossDown(cci,ma,b) : crossUp(cci,ma,b)) cciAt=b;
    }
    const cNow=cci[t], mNow=ma[t];
    if (cciAt<0 || cNow===null || mNow===null || (sell ? cNow>=mNow : cNow<=mNow)) { out.stage=4; return out; }
    out.cci=true; out.cciAt=cciAt; out.stage=5;
    return out;
  };
  const sell=evalSide(true), buy=evalSide(false);
  const ct=cy[t], at=atr[t], close=candles[t].close;
  const bandUp=ct!==null&&at!==null?ct+M*at:null;
  const bandDn=ct!==null&&at!==null?ct-M*at:null;
  const pos: KanalItem["pos"]=bandUp!==null&&close>bandUp?"above":bandDn!==null&&close<bandDn?"below":"inside";
  let side: "BUY"|"SELL"|null=null;
  if (sell.stage>buy.stage) side="SELL";
  else if (buy.stage>sell.stage) side="BUY";
  else if (sell.stage>0) side=(sell.m0??0)>(buy.m0??0)?"SELL":"BUY";
  const cur=side==="SELL"?sell:side==="BUY"?buy:null;
  const live=entry??candles[n-1].close;
  let sl:number|null=null,tp:number|null=null,extreme:number|null=null,rrv:number|null=null,confidence=0;
  let confParts:ConfParts={base:0,depth:0,rsi:0,cci:0,rr:0};
  if (side && cur && cur.m0!==null && ct!==null && at!==null) {
    let lo=Infinity, hi=-Infinity;
    const end=cur.rsiAt??t;
    for (let b=cur.m0;b<=end;b++) { lo=Math.min(lo,candles[b].low); hi=Math.max(hi,candles[b].high); }
    extreme=side==="BUY"?lo:hi;
    const lv=kanalLevels(side,live,extreme,ct,at,p); sl=lv.sl; tp=ct;
    const cf=kanalConfidence(side,cur.depth,cur.peak,cci[t],ma[t],live,sl,tp,p);
    confidence=cf.score; rrv=cf.rr; confParts=cf.parts;
  }
  // Guppy GMMA OSC girişi opsiyonel 6. koşul olarak teyit eder (kapalıysa guppyOk=null, davranış v3.5.3 ile aynı).
  const guppyOk = p.guppyConfirm && side ? guppyOkAt(side === "SELL", t) : null;
  if (guppyOk === false && confidence > 0) confidence = Math.max(0, confidence - 10);
  const rrBlocked=!!(cur?.stage===5 && (rrv===null || rrv<1 || sl===null || tp===null || (side==="BUY" ? sl>=live || tp<=live : sl<=live || tp>=live)));
  const armed=!!cur && cur.stage===5 && !rrBlocked && guppyOk !== false;
  const fire=armed && cur?.cciAt===t; // tek seferlik tetik yalnızca CCI teyit mumunda
  // Çıkış teyidi: açık pozisyon yönünde sinyal kaybı — OSC sinyali ters keserse "cross", sıfır bölgesine dönerse "zone".
  let guppyExit: KanalItem["guppyExit"] = "none";
  {
    const o1 = gm.osc[t - 1], s1 = gm.signal[t - 1], o0 = gm.osc[t], s0 = gm.signal[t];
    if (o1 !== null && s1 !== null && o0 !== null && s0 !== null) {
      if (side === "BUY" ? o1 >= s1 && o0 < s0 : side === "SELL" ? o1 <= s1 && o0 > s0 : false) guppyExit = "cross";
      else if (side === "BUY" ? o0 <= 0 : side === "SELL" ? o0 >= 0 : false) guppyExit = "zone";
    }
  }
  const evTime=(idx:number|null) => idx===null ? null : candles[idx].time;
  const reason=side&&cur ? `${side==="BUY"?"Alt":"Üst"} dış bant kapanışı + RSI bölgesi · ${cur.ret?"0.10 ATR güvenli dönüş":"dönüş bekleniyor"} · ${cur.rsi?"RSI kesişti":"RSI bekleniyor"} · ${cur.cci?"CCI kesişti":"CCI bekleniyor"}${p.guppyConfirm?` · Guppy OSC ${guppyOk===null?"veri yok":guppyOk?"teyit etti":"TEYIT ETMEDI (bloke)"}`:""}${rrBlocked?" · R:R < 1:1 — SİNYAL BLOKE":""}` : "";
  return {
    symbol,tf,price:live,rsi:rsi[t],cci:cci[t],cciMa:ma[t],center:ct,bandUp,bandDn,atr:at,pos,side,
    stage:cur?.stage??0,checks:cur?{brk:cur.brk,ext:cur.ext,ret:cur.ret,rsi:cur.rsi,cci:cur.cci}:{brk:false,ext:false,ret:false,rsi:false,cci:false},
    depth:cur?.depth??0,rsiPeak:cur?.peak??null,armed,fire,guppyOk,guppyExit,entry:live,sl,tp,extreme,rr:rrv,confidence,confParts,reason,
    barTime:candles[t].time,setupTime:cur?.m0===null||cur?.m0===undefined?null:candles[cur.m0].time,
    events:{m0:evTime(cur?.m0??null),mr:evTime(cur?.mr??null),rsi:evTime(cur?.rsiAt??null),cci:evTime(cur?.cciAt??null)},
    blockedReason: rrBlocked ? "R:R < 1:1 veya SL/TP yönü geçersiz" : guppyOk === false && cur?.stage === 5 ? "Guppy GMMA OSC teyit etmedi — sinyal bloke" : undefined,
    setupStates: {
      BUY: { stage: buy.stage, setupTime: buy.m0 === null ? null : candles[buy.m0].time, brk: buy.brk, ext: buy.ext },
      SELL: { stage: sell.stage, setupTime: sell.m0 === null ? null : candles[sell.m0].time, brk: sell.brk, ext: sell.ext },
    },
  };
}
