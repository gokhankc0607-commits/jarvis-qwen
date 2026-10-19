export type Candle = { time: number; open: number; high: number; low: number; close: number; volume: number };

/** Wilder RSI */
export function rsiSeries(close: number[], period = 14): (number | null)[] {
  const out: (number | null)[] = new Array(close.length).fill(null);
  if (close.length <= period) return out;
  let g = 0;
  let l = 0;
  for (let i = 1; i <= period; i++) {
    const d = close[i] - close[i - 1];
    if (d >= 0) g += d;
    else l -= d;
  }
  g /= period;
  l /= period;
  out[period] = l === 0 ? 100 : 100 - 100 / (1 + g / l);
  for (let i = period + 1; i < close.length; i++) {
    const d = close[i] - close[i - 1];
    g = (g * (period - 1) + (d > 0 ? d : 0)) / period;
    l = (l * (period - 1) + (d < 0 ? -d : 0)) / period;
    out[i] = l === 0 ? 100 : 100 - 100 / (1 + g / l);
  }
  return out;
}

export function cciSeries(c: Candle[], period = 20): (number | null)[] {
  const tp = c.map((x) => (x.high + x.low + x.close) / 3);
  const out: (number | null)[] = new Array(c.length).fill(null);
  for (let i = period - 1; i < c.length; i++) {
    let sum = 0;
    for (let j = i - period + 1; j <= i; j++) sum += tp[j];
    const sma = sum / period;
    let md = 0;
    for (let j = i - period + 1; j <= i; j++) md += Math.abs(tp[j] - sma);
    md /= period;
    out[i] = md === 0 ? 0 : (tp[i] - sma) / (0.015 * md);
  }
  return out;
}

export type GmmaOscillator = { osc: (number | null)[]; signal: (number | null)[] };

/** GMMA oscillator from the supplied Pine v6 defaults (Guppy, no anchor, SMA smooth 1, EMA signal 10). */
export function gmmaOscillator(close: number[], opts: { set?: "Guppy" | "SuperGuppy"; smoothLen?: number; signalLen?: number; anchorMult?: number } = {}): GmmaOscillator {
  const set = opts.set ?? "Guppy";
  const smoothLen = Math.max(1, Math.round(opts.smoothLen ?? 1));
  const signalLen = Math.max(1, Math.round(opts.signalLen ?? 10));
  const mult = Math.max(1, Math.round(opts.anchorMult ?? 1));
  const ema = (period: number): (number | null)[] => {
    const out: (number | null)[] = new Array(close.length).fill(null);
    const alpha = 2 / (period * mult + 1);
    let prev: number | null = null;
    for (let i = 0; i < close.length; i++) {
      prev = prev === null ? close[i] : alpha * close[i] + (1 - alpha) * prev;
      out[i] = prev;
    }
    return out;
  };
  const fastLens = set === "Guppy" ? [3, 5, 8, 10, 12, 15] : [3, 5, 7, 9, 11, 13, 15, 17, 19, 21, 23];
  const slowLens = set === "Guppy" ? [30, 35, 40, 45, 50, 60] : [25, 28, 31, 34, 37, 40, 43, 46, 49, 52, 55, 58, 61, 64, 67, 70];
  const cache = new Map<number, (number | null)[]>();
  for (const p of [...fastLens, ...slowLens]) cache.set(p, ema(p));
  const fast = new Array<number | null>(close.length).fill(null);
  const slow = new Array<number | null>(close.length).fill(null);
  const raw = new Array<number | null>(close.length).fill(null);
  for (let i = 0; i < close.length; i++) {
    const f = fastLens.map((p) => cache.get(p)?.[i]);
    const s = slowLens.map((p) => cache.get(p)?.[i]);
    if (f.some((v) => v === null || v === undefined) || s.some((v) => v === null || v === undefined)) continue;
    fast[i] = f.reduce<number>((sum, v) => sum + (v ?? 0), 0) / fastLens.length;
    slow[i] = s.reduce<number>((sum, v) => sum + (v ?? 0), 0) / slowLens.length;
    if (slow[i] !== 0) raw[i] = ((fast[i]! - slow[i]!) / slow[i]!) * 100;
  }
  const osc: (number | null)[] = new Array(close.length).fill(null);
  for (let i = 0; i < close.length; i++) {
    if (raw[i] === null || i < smoothLen - 1) continue;
    const window = raw.slice(i - smoothLen + 1, i + 1);
    if (window.every((v) => v !== null)) osc[i] = window.reduce((sum, v) => sum + (v as number), 0) / smoothLen;
  }
  const signal: (number | null)[] = new Array(close.length).fill(null);
  const alpha = 2 / (signalLen + 1);
  let prev: number | null = null;
  for (let i = 0; i < close.length; i++) {
    const value = raw[i];
    if (value === null) continue;
    prev = prev === null ? value : alpha * value + (1 - alpha) * prev;
    signal[i] = prev;
  }
  return { osc, signal };
}

export function bollinger(close: number[], period = 20, mult = 2) {
  const up: (number | null)[] = new Array(close.length).fill(null);
  const mid: (number | null)[] = new Array(close.length).fill(null);
  const lo: (number | null)[] = new Array(close.length).fill(null);
  for (let i = period - 1; i < close.length; i++) {
    let s = 0;
    for (let j = i - period + 1; j <= i; j++) s += close[j];
    const m = s / period;
    let v = 0;
    for (let j = i - period + 1; j <= i; j++) v += (close[j] - m) ** 2;
    const sd = Math.sqrt(v / period);
    mid[i] = m;
    up[i] = m + mult * sd;
    lo[i] = m - mult * sd;
  }
  return { up, mid, lo };
}

export type RadarCfg = { rsiPeriod: number; rsiOverbought: number; rsiOversold: number; cciPeriod: number; cciLevel: number };
export const DEFAULT_CFG: RadarCfg = { rsiPeriod: 14, rsiOverbought: 70, rsiOversold: 30, cciPeriod: 20, cciLevel: 100 };

export type RadarResult = {
  rsi: number | null;
  cci: number | null;
  signal: "BUY" | "SELL" | null;
  strength: number; // 0-4
  tags: string[];
  rsiZone: "os" | "ob" | null;
  cciZone: "os" | "ob" | null;
};

/**
 * RSI + CCI uyum / kesişim analizi.
 * - Bölge: RSI <= aşırı satım (veya >= aşırı alım), CCI <= -seviye (veya >= +seviye)
 * - Kesişim: son 3 mumda RSI aşırı satımı yukarı / aşırı alımı aşağı keser, CCI -seviyeyi yukarı / +seviyeyi aşağı keser
 * - SİNYAL: RSI ve CCI aynı yönü gösteriyorsa (bölge veya kesişim) BUY / SELL
 */
export function analyze(candles: Candle[], cfgIn?: Partial<RadarCfg>): RadarResult {
  const cfg = { ...DEFAULT_CFG, ...cfgIn };
  const empty: RadarResult = { rsi: null, cci: null, signal: null, strength: 0, tags: [], rsiZone: null, cciZone: null };
  if (candles.length < Math.max(cfg.rsiPeriod, cfg.cciPeriod) + 5) return empty;
  const r = rsiSeries(candles.map((c) => c.close), cfg.rsiPeriod);
  const c = cciSeries(candles, cfg.cciPeriod);
  const n = candles.length - 1;
  const rsi = r[n];
  const cci = c[n];
  if (rsi === null || cci === null) return empty;

  const rsiZone = rsi <= cfg.rsiOversold ? "os" : rsi >= cfg.rsiOverbought ? "ob" : null;
  const cciZone = cci <= -cfg.cciLevel ? "os" : cci >= cfg.cciLevel ? "ob" : null;

  let rsiCross: "up" | "down" | null = null;
  let cciCross: "up" | "down" | null = null;
  for (let i = Math.max(1, n - 2); i <= n; i++) {
    const rp = r[i - 1], rn = r[i], cp = c[i - 1], cn = c[i];
    if (rp !== null && rn !== null) {
      if (rp < cfg.rsiOversold && rn >= cfg.rsiOversold) rsiCross = "up";
      if (rp > cfg.rsiOverbought && rn <= cfg.rsiOverbought) rsiCross = "down";
    }
    if (cp !== null && cn !== null) {
      if (cp < -cfg.cciLevel && cn >= -cfg.cciLevel) cciCross = "up";
      if (cp > cfg.cciLevel && cn <= cfg.cciLevel) cciCross = "down";
    }
  }

  const tags: string[] = [];
  if (rsiZone === "os") tags.push(`RSI ${cfg.rsiOversold} altı`);
  if (rsiZone === "ob") tags.push(`RSI ${cfg.rsiOverbought} üstü`);
  if (rsiCross === "up") tags.push(`RSI ${cfg.rsiOversold} yukarı kesti`);
  if (rsiCross === "down") tags.push(`RSI ${cfg.rsiOverbought} aşağı kesti`);
  if (cciZone === "os") tags.push(`CCI -${cfg.cciLevel} altı`);
  if (cciZone === "ob") tags.push(`CCI +${cfg.cciLevel} üstü`);
  if (cciCross === "up") tags.push(`CCI -${cfg.cciLevel} yukarı kesti`);
  if (cciCross === "down") tags.push(`CCI +${cfg.cciLevel} aşağı kesti`);

  const rsiBull = rsiZone === "os" || rsiCross === "up";
  const cciBull = cciZone === "os" || cciCross === "up";
  const rsiBear = rsiZone === "ob" || rsiCross === "down";
  const cciBear = cciZone === "ob" || cciCross === "down";

  let signal: "BUY" | "SELL" | null = null;
  if (rsiBull && cciBull) signal = "BUY";
  else if (rsiBear && cciBear) signal = "SELL";

  const dir = signal === "BUY" ? "os" : "ob";
  const crossDir = signal === "BUY" ? "up" : "down";
  const strength = signal
    ? (rsiZone === dir ? 1 : 0) + (rsiCross === crossDir ? 1 : 0) + (cciZone === dir ? 1 : 0) + (cciCross === crossDir ? 1 : 0)
    : 0;

  return { rsi, cci, signal, strength, tags, rsiZone, cciZone };
}
