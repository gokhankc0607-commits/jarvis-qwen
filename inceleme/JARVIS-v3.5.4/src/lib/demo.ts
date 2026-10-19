import type { Candle } from "./indicators";
import { TF_MIN, categoryOf } from "./tf";

function hash(str: string) {
  let h = 2166136261;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}
function rnd(seed: number) {
  let t = (seed + 0x6d2b79f5) | 0;
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}

const BASE: Record<string, number> = {
  EURUSD: 1.0842, GBPUSD: 1.2704, USDJPY: 157.2, GBPJPY: 197.6, EURJPY: 170.4, AUDUSD: 0.6652, USDCAD: 1.3641,
  USDCHF: 0.9012, NZDUSD: 0.6123, EURGBP: 0.8534, XAUUSD: 2384.5, XAGUSD: 31.4, BTCUSD: 62345, ETHUSD: 2467,
  US30: 39220, US100: 19124, US500: 5432, GER40: 19345, UK100: 8211, USOIL: 78.4,
};
function basePrice(symbol: string) {
  const s = symbol.toUpperCase();
  if (BASE[s]) return BASE[s];
  for (const k of Object.keys(BASE)) if (s.startsWith(k)) return BASE[k];
  return 0.8 + ((hash(s) % 1000) / 1000) * 1.6;
}
const VOL: Record<ReturnType<typeof categoryOf>, number> = { forex: 1, crypto: 2.4, metals: 1.5, indices: 1.1, commodities: 1.4, stocks: 1.3 };

export function demoCandles(symbol: string, tf: string, count = 150, now = Date.now()): Candle[] {
  const sec = (TF_MIN[tf] ?? 60) * 60;
  const k0 = Math.floor(now / 1000 / sec);
  const seed = hash(symbol.toUpperCase());
  const base = basePrice(symbol);
  const vol = VOL[categoryOf(symbol)] * 0.0085;
  const scale = Math.sqrt((TF_MIN[tf] ?? 60) / 15);
  const ph1 = seed % 7, ph2 = seed % 13, ph3 = seed % 5;

  // Tüm zaman dilimlerinde ortak, kararlı (non-cumulative) sahte fiyat yolu
  const path = (k: number) => {
    const t = (k * sec) / 60; // dakika
    const w = Math.sin(t / 540 + ph1) + 0.6 * Math.sin(t / 138 + ph2) + 0.28 * Math.sin(t / 35 + ph3);
    return base * (1 + w * vol);
  };
  const noise = (k: number) => (rnd(seed + k * 7919 + sec) - 0.5) * base * vol * 0.22 * scale;

  const out: Candle[] = [];
  const t = now / 1000;
  const live = base * 0.00018 * VOL[categoryOf(symbol)] * (Math.sin(t / 4) + 0.6 * Math.sin(t / 1.7));
  for (let k = k0 - count + 1; k <= k0; k++) {
    const open = path(k - 1) + noise(k - 1);
    let close = path(k) + noise(k);
    if (k === k0) close += live;
    const wick = Math.abs(rnd(seed + k * 31 + 5)) * base * vol * 0.12 * scale + base * 0.00004;
    const wick2 = Math.abs(rnd(seed + k * 57 + 9)) * base * vol * 0.12 * scale + base * 0.00004;
    out.push({
      time: k * sec,
      open,
      high: Math.max(open, close) + wick,
      low: Math.min(open, close) - wick2,
      close,
      volume: Math.round(200 + rnd(seed + k * 13) * 1800),
    });
  }
  return out;
}

