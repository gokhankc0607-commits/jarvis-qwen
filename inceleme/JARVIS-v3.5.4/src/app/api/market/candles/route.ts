import { and, eq, inArray } from "drizzle-orm";
import { db } from "@/db";
import { accountState, trades } from "@/db/schema";
import { withUser } from "@/lib/api";
import { agentOnline } from "@/lib/sim";
import { loadCandlesMeta, ruleCfg, userRules } from "@/lib/market";
import { getTick } from "@/lib/live";
import { TF_MIN } from "@/lib/tf";
import { ensureKanal } from "@/lib/kanalStore";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  return withUser(async (u) => {
    const sp = new URL(req.url).searchParams;
    const symbol = (sp.get("symbol") ?? "").toUpperCase().trim();
    const tf = (sp.get("tf") ?? "H1").toUpperCase();
    const market = sp.get("market") === "crypto" ? "crypto" : "forex";
    if (!symbol || !(tf in TF_MIN)) throw new Error("Geçersiz sembol veya zaman dilimi");
    const [acc] = await db.select().from(accountState).where(eq(accountState.userId, u.id)).limit(1);
    const live = agentOnline(acc?.agentLastSeen);
    const rule = (await userRules(u.id)).find((r) => r.symbol.toUpperCase() === symbol);
    const rows = await db
      .select({ symbol: trades.symbol, side: trades.side, volume: trades.volume, openPrice: trades.openPrice, sl: trades.sl, tp: trades.tp, source: trades.source, market: trades.market })
      .from(trades)
      .where(and(eq(trades.userId, u.id), inArray(trades.status, ["open", "closing"])));

    const meta = loadCandlesMeta(u.id, live, symbol, tf, market);
    let candles = meta.candles;
    const ageMs = meta.ageMs;
    // Canlı fiyat akışını son muma işle: grafik mum verisi gelmeden de anlık hareket eder
    const tk = live ? getTick(u.id, symbol, 15000, market) : undefined;
    if (tk && candles.length) {
      const last = candles[candles.length - 1];
      candles = [...candles.slice(0, -1), { ...last, close: tk.bid, high: Math.max(last.high, tk.bid), low: Math.min(last.low, tk.bid) }];
    }
    return Response.json({
      live,
      candles,
      ageMs,
      tick: tk ? { bid: tk.bid, ask: tk.ask, age: (Date.now() - tk.at) / 1000, stale: tk.stale, digits: tk.digits ?? null } : null,
      cfg: ruleCfg(rule),
      kp: (await ensureKanal(u.id)).params,
      market,
      trades: rows.filter((t) => t.symbol.toUpperCase() === symbol && (!live || t.source === "agent") && ((t as { market?: string }).market ?? "forex") === market),
    });
  });
}
