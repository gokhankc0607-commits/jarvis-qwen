import { eq } from "drizzle-orm";
import { db } from "@/db";
import { kanalSettings, watchRules } from "@/db/schema";
import { analyze, DEFAULT_CFG, type Candle, type RadarCfg } from "./indicators";
import { getSeries, getTick } from "./live";
import { TF_MIN, categoryOf, parseTfs, type Category } from "./tf";
import { demoCandles } from "./demo";
import { kanalAnalyze, type KanalItem } from "./kanal";
import { ensureKanal } from "./kanalStore";

/* ------------------------------------------------------------------ yükleme */
export function loadCandles(userId: number, live: boolean, symbol: string, tf: string, market?: string): Candle[] {
  if (live) return getSeries(userId, symbol, tf, 180000, market)?.candles ?? [];
  return demoCandles(symbol, tf, 320);
}

export function loadCandlesMeta(userId: number, live: boolean, symbol: string, tf: string, market?: string): { candles: Candle[]; ageMs: number | null } {
  if (!live) return { candles: demoCandles(symbol, tf, 320), ageMs: 0 };
  const s = getSeries(userId, symbol, tf, 180000, market);
  return { candles: s?.candles ?? [], ageMs: s ? Date.now() - s.at : null };
}

type Rule = typeof watchRules.$inferSelect;
const DEFAULT_RULE = {
  rsiPeriod: 14, rsiOverbought: 70, rsiOversold: 30, cciPeriod: 20, cciLevel: 100, stochEnabled: false, useDivergence: false,
  lotSize: 0.1, slPips: 30, tpPips: 60, createdAt: new Date(0),
};
export const ruleCfg = (r?: Rule | null): RadarCfg =>
  r
    ? { rsiPeriod: r.rsiPeriod, rsiOverbought: r.rsiOverbought, rsiOversold: r.rsiOversold, cciPeriod: r.cciPeriod, cciLevel: r.cciLevel }
    : DEFAULT_CFG;

export async function userRules(userId: number) {
  return db.select().from(watchRules).where(eq(watchRules.userId, userId)).orderBy(watchRules.id);
}

/* ------------------------------------------------------------------ özet */
export type Quote = {
  symbol: string;
  market: "forex" | "crypto";
  category: Category;
  enabled: boolean;
  tfs: string[];
  price: number | null;
  change: number;
  changePct: number;
  spark: number[];
  bid: number | null;
  ask: number | null;
  stale: number; // fiyatın kaç sn'dir değişmediği (ajan ölçer): uzunsa piyasa kapalı olabilir
  tickAge: number | null; // son fiyatın panele ulaşma yaşı (sn)
  minDist: number | null; // brokerın minimum SL/TP mesafesi (stops level + spread), fiyat birimiyle
  digits: number | null;
  rsi: number | null;
  cci: number | null;
  signal: "BUY" | "SELL" | null;
  tags: string[];
};
export type RadarRow = {
  symbol: string;
  market: "forex" | "crypto";
  tf: string;
  price: number | null;
  rsi: number | null;
  cci: number | null;
  signal: "BUY" | "SELL" | null;
  strength: number;
  tags: string[];
  rsiZone: "os" | "ob" | null;
  cciZone: "os" | "ob" | null;
  cfg: { os: number; ob: number; cci: number };
};

export type KanalRow = KanalItem & { market: "forex" | "crypto" };

export async function buildMarket(userId: number, live: boolean, tfFilter?: string | null) {
  const tfOnly = tfFilter && TF_MIN[tfFilter] ? tfFilter : null; // tek zaman dilimi seçildiyse
  const kcfg = await ensureKanal(userId);
  const kanalRows: KanalRow[] = [];
  type R = Rule & { fromList?: boolean; market?: "forex" | "crypto" };
  const rules: R[] = await userRules(userId);
  // KANAL takip listesindeki pariteler (izleme kuralı yoksa KANAL zaman dilimleriyle eklenir)
  const [ks] = await db.select({ symbols: kanalSettings.symbols, cryptoSymbols: kanalSettings.cryptoSymbols, timeframes: kanalSettings.timeframes }).from(kanalSettings).where(eq(kanalSettings.userId, userId)).limit(1);
  const ruleSyms = new Set(rules.map((r) => r.symbol.toUpperCase()));
  const base = { ...DEFAULT_RULE, id: -1, userId, enabled: true, fromList: true, timeframe: ks?.timeframes || "M15" };
  for (const sym of (Array.isArray(ks?.symbols) ? ks.symbols : []) as string[]) {
    if (ruleSyms.has(String(sym).toUpperCase())) continue;
    rules.push({ ...base, symbol: String(sym).toUpperCase(), market: "forex" } as R);
  }
  // Kripto takip listesi: borsa mumları / fiyatlarıyla (BTCUSDT vb.), forex ile karışmaz
  for (const sym of (Array.isArray(ks?.cryptoSymbols) ? ks.cryptoSymbols : []) as string[])
    rules.push({ ...base, symbol: String(sym).toUpperCase(), market: "crypto" } as R);
  const quotes: Quote[] = [];
  const radar: RadarRow[] = [];
  const seen = new Map<string, Quote>();

  for (const r of rules) {
    const symbol = r.symbol.toUpperCase();
    const market: "forex" | "crypto" = r.market === "crypto" ? "crypto" : "forex";
    const seenKey = `${market}:${symbol}`;
    // Tek zaman dilimi seçiliyse: bütün pariteler o TF'de; seçilmemişse her paritenin kendi TF'leri
    const tfs = tfOnly ? (parseTfs(r.timeframe).includes(tfOnly) ? [tfOnly] : [tfOnly]) : parseTfs(r.timeframe);
    const cfg = ruleCfg(r);
    const existing = seen.get(seenKey);
    if (existing) {
      existing.tfs = [...new Set([...existing.tfs, ...tfs])];
      existing.enabled = existing.enabled || r.enabled;
    }
    let first = true;
    const tk = live ? getTick(userId, symbol, 15000, market) : undefined; // canlı fiyat akışı (≈1 sn)
    for (const tf of tfs) {
      const candles = loadCandles(userId, live, symbol, tf, market);
      const a = analyze(candles, cfg);
      // KANAL radarı: bant dışı kapanış → bantların içine dönüş → RSI → CCI (5 koşul) — işlem sinyali bu
      const ki = candles.length ? kanalAnalyze(symbol, tf, candles, kcfg.params, tk ? (tk.bid + tk.ask) / 2 : undefined) : null;
      if (ki) kanalRows.push({ ...ki, market });
      const candlePx = candles.length ? candles[candles.length - 1].close : null;
      const price = tk ? tk.bid : candlePx;
      radar.push({
        symbol, market, tf, price, rsi: a.rsi, cci: a.cci, signal: a.signal, strength: a.strength, tags: a.tags,
        rsiZone: a.rsiZone, cciZone: a.cciZone, cfg: { os: cfg.rsiOversold, ob: cfg.rsiOverbought, cci: cfg.cciLevel },
      });
      if (first && !existing) {
        first = false;
        const n = candles.length;
        const back = Math.max(1, Math.min(n - 1, Math.round(1440 / (TF_MIN[tf] ?? 60))));
        const ref = n > 1 ? candles[n - 1 - back].close : price ?? 0;
        const q: Quote = {
          symbol, market, category: market === "crypto" ? "crypto" : categoryOf(symbol), enabled: r.enabled, tfs,
          price, change: price !== null ? price - ref : 0, changePct: price !== null && ref ? ((price - ref) / ref) * 100 : 0,
          spark: candles.slice(-40).map((c) => c.close),
          bid: tk?.bid ?? null, ask: tk?.ask ?? null, stale: tk?.stale ?? 0, tickAge: tk ? (Date.now() - tk.at) / 1000 : null,
          minDist: tk && tk.point !== undefined ? (tk.stops ?? 0) * tk.point + (tk.ask - tk.bid) : null, digits: tk?.digits ?? null,
          rsi: a.rsi, cci: a.cci, signal: a.signal, tags: a.tags,
        };
        seen.set(seenKey, q);
        quotes.push(q);
      }
    }
  }
  radar.sort((a, b) => Number(!!b.signal) - Number(!!a.signal) || b.strength - a.strength || b.tags.length - a.tags.length);
  kanalRows.sort((a, b) => Number(b.fire) - Number(a.fire) || Number(b.armed) - Number(a.armed) || b.stage - a.stage || b.confidence - a.confidence || a.symbol.localeCompare(b.symbol));
  return { quotes, radar, kanal: kanalRows, kanalParams: kcfg.params, tf: tfOnly };
}
