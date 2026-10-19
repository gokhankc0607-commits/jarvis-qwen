import { sameSymbol } from "./symbols";
import type { Candle } from "./indicators";

/**
 * Canlı (geçici) veri deposu — ajanın gönderdiği mumlar ve ping burada tutulur.
 * Veritabanına yazılmaz: anlık piyasa verisi kalıcı olmak zorunda değil ve
 * her saniye DB yazmak gömülü veritabanını gereksiz yorar.
 */
export type LiveSeries = { symbol: string; timeframe: string; candles: Candle[]; bid: number | null; ask: number | null; at: number };
type UserLive = { series: Map<string, LiveSeries>; ping: number | null; pingAt: number };

const g = globalThis as typeof globalThis & {
  __jarvisScan?: Map<number, { at: number; items: unknown[]; watch: string[] }>;
  __jarvisLive?: Map<number, UserLive>;
  __jarvisDemoPx?: Map<number, number>;
};

function user(userId: number): UserLive {
  g.__jarvisLive ??= new Map();
  let u = g.__jarvisLive.get(userId);
  if (!u) {
    u = { series: new Map(), ping: null, pingAt: 0 };
    g.__jarvisLive.set(userId, u);
  }
  return u;
}

const key = (symbol: string, tf: string, market?: string) => `${market === "crypto" ? "C:" : ""}${symbol.toUpperCase()}|${tf}`;

export function putSeries(userId: number, s: Omit<LiveSeries, "at"> & { market?: string }) {
  user(userId).series.set(key(s.symbol, s.timeframe, s.market), { ...s, at: Date.now() });
}

export function getSeries(userId: number, symbol: string, tf: string, maxAgeMs = 180000, market?: string): LiveSeries | undefined {
  const s = user(userId).series.get(key(symbol, tf, market));
  return s && Date.now() - s.at < maxAgeMs ? s : undefined;
}

export function setPing(userId: number, ping: number | null) {
  const u = user(userId);
  u.ping = ping;
  u.pingAt = Date.now();
}

export function getPing(userId: number): number | null {
  const u = user(userId);
  return Date.now() - u.pingAt < 30000 ? u.ping : null;
}

/** Demo modunda açık işlem fiyatlarını bellekte oynatır (DB'ye yazmadan). */
export function demoPrice(tradeId: number, base: number, step: number): number {
  g.__jarvisDemoPx ??= new Map();
  const cur = g.__jarvisDemoPx.get(tradeId) ?? base;
  const next = Math.round((cur + (Math.random() - 0.48) * step * 6) / (step / 10)) * (step / 10);
  g.__jarvisDemoPx.set(tradeId, next);
  return next;
}

/** Ajanın KANAL taraması (Piyasa Gözlemi'ndeki tüm pariteler). */
export function putScan(userId: number, items: unknown[], watch: string[]) {
  g.__jarvisScan ??= new Map();
  g.__jarvisScan.set(userId, { at: Date.now(), items, watch });
}
export function getScan(userId: number, maxAgeMs = 90000) {
  const s = g.__jarvisScan?.get(userId);
  return s && Date.now() - s.at < maxAgeMs ? s : undefined;
}

/* ------------------------------------------------------------------ canlı fiyat akışı (ajan -> panel, ~1 sn) */
export type Tick = {
  s: string; real?: string; src?: string; bid: number; ask: number; t: number; stale: number;
  digits?: number; point?: number; stops?: number; minLot?: number; lotStep?: number; at: number;
};
const gt = globalThis as typeof globalThis & {
  __jarvisTicks?: Map<number, Map<string, Tick>>;
  __jarvisAgent?: Map<number, AgentInfo>;
};

export function putTicks(userId: number, ticks: Omit<Tick, "at">[]) {
  gt.__jarvisTicks ??= new Map();
  let m = gt.__jarvisTicks.get(userId);
  if (!m) gt.__jarvisTicks.set(userId, (m = new Map()));
  const now = Date.now();
  for (const t of ticks)
    if (t && typeof t.s === "string" && Number.isFinite(t.bid) && Number.isFinite(t.ask))
      m.set((t.src === "crypto" ? "C:" : "") + t.s.toUpperCase(), { ...t, at: now });
}
export function getTick(userId: number, symbol: string, maxAgeMs = 15000, market?: string): Tick | undefined {
  const t = gt.__jarvisTicks?.get(userId)?.get((market === "crypto" ? "C:" : "") + symbol.toUpperCase());
  return t && Date.now() - t.at < maxAgeMs ? t : undefined;
}
/** Takma ad / ek farkıyla da bulur (US100 <-> NAS100, EURUSD <-> EURUSD.m). */
export function findTick(userId: number, symbol: string, maxAgeMs = 20000, market?: "forex" | "crypto"): Tick | undefined {
  const ok = (t: Tick) => (market === "crypto" ? t.src === "crypto" : market === "forex" ? t.src !== "crypto" : true);
  const direct = getTick(userId, symbol, maxAgeMs, market);
  if (direct && ok(direct)) return direct;
  return allTicks(userId, maxAgeMs).find((t) => ok(t) && (sameSymbol(t.s, symbol) || (t.real ? sameSymbol(t.real, symbol) : false)));
}

export function allTicks(userId: number, maxAgeMs = 15000): Tick[] {
  const m = gt.__jarvisTicks?.get(userId);
  if (!m) return [];
  const now = Date.now();
  return [...m.values()].filter((t) => now - t.at < maxAgeMs);
}

/** Ajanın bildirdiği durum (sürüm, Algo Trading, veri akışı hataları). */
export type AgentInfo = {
  version: string; algo: boolean; tradeAllowed: boolean; build: number; at: number;
  feedErrors: [string, string][]; feedOk: number;
  crypto?: boolean; cryptoLabel?: string;
};
export function setAgentInfo(userId: number, p: Partial<AgentInfo>) {
  gt.__jarvisAgent ??= new Map();
  const cur = gt.__jarvisAgent.get(userId) ?? { version: "", algo: true, tradeAllowed: true, build: 0, at: 0, feedErrors: [], feedOk: 0 };
  gt.__jarvisAgent.set(userId, { ...cur, ...p, at: Date.now() });
}
export function getAgentInfo(userId: number): AgentInfo | undefined {
  return gt.__jarvisAgent?.get(userId);
}

/** MT5 Piyasa Gözlemi'ndeki semboller (ajan bildirir; takip listesi seçimi için). */
const gm = globalThis as typeof globalThis & { __jarvisMW?: Map<number, { at: number; list: string[] }> };
export function setMarketWatch(userId: number, list: string[]) {
  gm.__jarvisMW ??= new Map();
  gm.__jarvisMW.set(userId, { at: Date.now(), list });
}
export function getMarketWatch(userId: number): string[] {
  return gm.__jarvisMW?.get(userId)?.list ?? [];
}

/* ------------------------------------------------------------------ kripto hesap / semboller (ajan bildirir) */
const gc = globalThis as typeof globalThis & {
  __jarvisCryptoAcc?: Map<number, { at: number; acc: Record<string, unknown> | null }>;
  __jarvisCryptoMw?: Map<number, string[]>;
};
export function setCryptoAccount(userId: number, acc: Record<string, unknown> | null) {
  gc.__jarvisCryptoAcc ??= new Map();
  gc.__jarvisCryptoAcc.set(userId, { at: Date.now(), acc });
}
export function getCryptoAccount(userId: number) {
  const r = gc.__jarvisCryptoAcc?.get(userId);
  return r && Date.now() - r.at < 30000 ? r.acc : null;
}
export function setCryptoMarketWatch(userId: number, list: string[]) {
  gc.__jarvisCryptoMw ??= new Map();
  gc.__jarvisCryptoMw.set(userId, list);
}
export function getCryptoMarketWatch(userId: number): string[] {
  return gc.__jarvisCryptoMw?.get(userId) ?? [];
}
