import { eq } from "drizzle-orm";
import { db } from "@/db";
import { accountState, signals } from "@/db/schema";
import { agentOnline, pipSize } from "./sim";
import { findTick, getAgentInfo } from "./live";
import { cryptoCanon } from "./symbols";
import { demoCandles } from "./demo";
import { decideSignal } from "./actions";
import type { Level } from "./tradeCommand";

export type OrderInput = {
  symbol: string; side: "BUY" | "SELL"; volume: number; market?: "forex" | "crypto";
  sl?: number | null; tp?: number | null; slPips?: number | null; tpPips?: number | null;
  slLevel?: Level | null; tpLevel?: Level | null;
};

/** Seviye çözümü: pip -> fiyat; "auto": fiyata yakınsa (±%30) fiyat, değilse pip. */
export function resolveLevel(lv: Level, kind: "sl" | "tp", side: "BUY" | "SELL", from: number, pip: number): number {
  const asPrice = lv.unit === "price" || (lv.unit === "auto" && Math.abs(lv.v - from) / from < 0.3);
  if (asPrice) return lv.v;
  const d = lv.v * pip;
  const down = (kind === "sl") === (side === "BUY");
  return down ? from - d : from + d;
}

/**
 * Elle emir oluşturur. approve=true -> hemen onaylı (Hızlı Emir'de "Emri gönder" = açık onay).
 * approve=false -> bekleyen emir; sohbette "Evet" ile onaylanır.
 */
export async function createManualOrder(userId: number, inp: OrderInput, approve: boolean, reason = "Elle emir (panel · Hızlı Emir)") {
  const symbolIn = inp.symbol.toUpperCase().trim();
  if (!/^[A-Z0-9._#+-]{2,20}$/.test(symbolIn)) throw new Error("Geçerli bir sembol girin (örn. EURUSD)");
  if (!(inp.volume >= 0.01 && inp.volume <= 100)) throw new Error("Lot 0.01 ile 100 arasında olmalı");
  const side = inp.side;
  const [acc] = await db.select().from(accountState).where(eq(accountState.userId, userId)).limit(1);
  const live = agentOnline(acc?.agentLastSeen);
  const market = inp.market ?? "forex";
  const symbolQ = market === "crypto" ? cryptoCanon(symbolIn) : symbolIn;
  const tk = live ? findTick(userId, symbolQ, 20000, market) : undefined;
  if (live && !tk)
    throw new Error(market === "crypto"
      ? `${symbolQ} için borsadan canlı fiyat yok. Kripto Borsası bağlı mı, parite Kripto takip listesinde mi?`
      : `${symbolIn} için canlı fiyat yok. Sembol MT5 Piyasa Gözlemi'nde / izleme listesinde olmalı ve ajan çalışmalı.`);
  if (live && market === "forex" && getAgentInfo(userId)?.algo === false) throw new Error("MT5'te Algo Trading KAPALI. Üst çubuktaki Algo Trading düğmesini açın, sonra tekrar deneyin.");
  if (live && market === "crypto" && !getAgentInfo(userId)?.crypto) throw new Error("Kripto borsası ajanda bağlı değil (Panel → Kripto Borsası → Aç; ajan açık olmalı).");
  const symbol = tk ? tk.s : symbolQ; // canlı fiyatın geldiği ad (ajan brokerdaki gerçek ada çevirir)
  let price: number;
  if (tk) price = side === "BUY" ? tk.ask : tk.bid;
  else {
    const c = demoCandles(symbol, "M15", 5);
    price = c[c.length - 1].close;
  }
  const pip = pipSize(tk?.real ?? symbol);
  let sl = inp.sl ?? null, tp = inp.tp ?? null;
  if (inp.slPips) sl = side === "BUY" ? price - inp.slPips * pip : price + inp.slPips * pip;
  if (inp.tpPips) tp = side === "BUY" ? price + inp.tpPips * pip : price - inp.tpPips * pip;
  if (inp.slLevel) sl = resolveLevel(inp.slLevel, "sl", side, price, pip);
  if (inp.tpLevel) tp = resolveLevel(inp.tpLevel, "tp", side, price, pip);
  const tr = side === "BUY" ? "AL" : "SAT";
  if (sl && (side === "BUY" ? sl >= price : sl <= price)) throw new Error(`SL yanlış tarafta: ${tr} emrinde SL fiyatın ${side === "BUY" ? "altında" : "üstünde"} olmalı (güncel ${price}, SL ${sl}).`);
  if (tp && (side === "BUY" ? tp <= price : tp >= price)) throw new Error(`TP yanlış tarafta: ${tr} emrinde TP fiyatın ${side === "BUY" ? "üstünde" : "altında"} olmalı (güncel ${price}, TP ${tp}).`);
  const digits = tk?.digits ?? (price > 1000 ? 2 : price > 50 ? 3 : 5);
  const r = (v: number | null) => (v ? Number(v.toFixed(digits)) : null);

  const [sig] = await db
    .insert(signals)
    .values({
      userId, symbol, side, timeframe: "MAN", price: Number(price.toFixed(digits)), sl: r(sl), tp: r(tp), volume: inp.volume,
      reason, confidence: 100, source: "manual", status: "pending", indicators: {}, market,
      note: approve ? "Kullanıcı onayladı (panel)" : "Onay bekleniyor",
    })
    .returning();
  const out = approve ? await decideSignal(userId, sig.id, true) : sig;
  return { signal: out, live, price, digits };
}

/** Onaylanan emrin MT5 sonucunu bekler (ajan ≤2 sn'de bir senkronize olur). */
export async function waitSignal(id: number, ms = 12000) {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    const [s] = await db.select().from(signals).where(eq(signals.id, id)).limit(1);
    if (!s || s.status === "executed" || s.status === "failed" || s.status === "rejected" || s.status === "expired") return s;
    await new Promise((r) => setTimeout(r, 700));
  }
  const [s] = await db.select().from(signals).where(eq(signals.id, id)).limit(1);
  return s;
}
