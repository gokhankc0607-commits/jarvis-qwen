import { and, desc, eq, gt, inArray, ne } from "drizzle-orm";
import { db } from "@/db";
import { accountState, signals, trades, compileJobs, strategies, watchRules } from "@/db/schema";
import { withUser } from "@/lib/api";
import { agentOnline, calcPnl, pipSize } from "@/lib/sim";
import { getActiveProvider } from "@/lib/llm";
import { allTicks, demoPrice, getAgentInfo, getCryptoAccount, getPing } from "@/lib/live";
import { cryptoCfg } from "@/lib/cryptoStore";
import { LATEST_AGENT, isOutdated } from "@/lib/version";

export const dynamic = "force-dynamic";

export async function GET() {
  return withUser(async (u) => {
    let [acc] = await db.select().from(accountState).where(eq(accountState.userId, u.id)).limit(1);
    if (!acc) {
      [acc] = await db.insert(accountState).values({ userId: u.id }).returning();
    }
    const online = agentOnline(acc.agentLastSeen);
    let open = await db
      .select()
      .from(trades)
      .where(and(eq(trades.userId, u.id), inArray(trades.status, ["open", "closing"])))
      .orderBy(desc(trades.openedAt));

    if (online) {
      open = open.filter((t) => t.source === "agent"); // canlı modda demo/örnek pozisyonlar karışmasın
    } else {
      // Demo: canlı fiyat hareketini bellekte simüle et (veritabanına yazmadan)
      open = open.map((t) => {
        const cp = demoPrice(t.id, t.currentPrice, pipSize(t.symbol));
        return { ...t, currentPrice: cp, pnl: calcPnl(t.symbol, t.side, t.volume, t.openPrice, cp) };
      });
      const floating = open.reduce((s, t) => s + t.pnl, 0);
      const equity = Math.round((acc.balance + floating) * 100) / 100;
      const margin = Math.round(open.reduce((s, t) => s + t.volume * 1000, 0) * 100) / 100;
      acc = { ...acc, equity, margin, freeMargin: Math.round((equity - margin) * 100) / 100, connected: false };
    }

    const liveOnly = online ? ne(signals.source, "demo") : undefined; // canlıda örnek sinyaller görünmez
    const pending = await db
      .select()
      .from(signals)
      .where(and(eq(signals.userId, u.id), eq(signals.status, "pending"), liveOnly))
      .orderBy(desc(signals.createdAt));
    const recentSignals = await db
      .select()
      .from(signals)
      .where(and(eq(signals.userId, u.id), liveOnly))
      .orderBy(desc(signals.createdAt))
      .limit(8);
    const failedSignals = online
      ? await db
          .select({ id: signals.id, symbol: signals.symbol, side: signals.side, note: signals.note, createdAt: signals.createdAt })
          .from(signals)
          .where(and(eq(signals.userId, u.id), eq(signals.status, "failed"), gt(signals.createdAt, new Date(Date.now() - 30 * 60000))))
          .orderBy(desc(signals.createdAt))
          .limit(3)
      : [];
    const jobs = await db
      .select({
        id: compileJobs.id,
        status: compileJobs.status,
        errors: compileJobs.errors,
        warnings: compileJobs.warnings,
        attempt: compileJobs.attempt,
        log: compileJobs.log,
        createdAt: compileJobs.createdAt,
        strategyName: strategies.name,
      })
      .from(compileJobs)
      .leftJoin(strategies, eq(strategies.id, compileJobs.strategyId))
      .where(eq(compileJobs.userId, u.id))
      .orderBy(desc(compileJobs.createdAt))
      .limit(5);
    const rules = await db
      .select({ symbol: watchRules.symbol, timeframe: watchRules.timeframe, enabled: watchRules.enabled })
      .from(watchRules)
      .where(eq(watchRules.userId, u.id));
    const provider = await getActiveProvider(u.id);

    // Performans: kapalı işlemlerin K/Z'si (canlıda yalnızca gerçek MT5 işlemleri)
    let closed = await db.select().from(trades).where(and(eq(trades.userId, u.id), eq(trades.status, "closed")));
    if (online) closed = closed.filter((t) => t.source === "agent");
    const now = Date.now();
    const sumSince = (days: number) =>
      closed.filter((t) => t.closedAt && now - new Date(t.closedAt).getTime() <= days * 86400000).reduce((s, t) => s + t.pnl, 0);
    const base = Math.max(acc.balance, 1);
    const perf = {
      weekPnl: sumSince(7),
      monthPnl: sumSince(30),
      yearPnl: sumSince(365),
      week: (sumSince(7) / base) * 100,
      month: (sumSince(30) / base) * 100,
      year: (sumSince(365) / base) * 100,
      winRate: closed.length ? (closed.filter((t) => t.pnl > 0).length / closed.length) * 100 : 0,
      closed: closed.length,
    };

    const info = online ? getAgentInfo(u.id) : undefined;
    const ticks = online ? allTicks(u.id) : [];
    const tickAge = ticks.length ? Math.min(...ticks.map((t) => (now - t.at) / 1000)) : null;

    return Response.json({
      account: acc,
      agentOnline: online,
      mode: online ? "live" : "demo",
      ping: online ? getPing(u.id) : null,
      agent: {
        online,
        version: info?.version || null,
        latest: LATEST_AGENT,
        outdated: isOutdated(info?.version),
        algo: info?.algo ?? true,
        tradeAllowed: info?.tradeAllowed ?? true,
        build: info?.build ?? 0,
        feedErrors: info?.feedErrors ?? [],
        feedOk: info?.feedOk ?? 0,
        tickAge,
        ticks: ticks.length,
      },
      failedSignals,
      crypto: await (async () => {
        const c = await cryptoCfg(u.id);
        const acc = online ? (getCryptoAccount(u.id) as { connected?: boolean; server?: string; balance?: number; equity?: number; freeMargin?: number; currency?: string; leverage?: number } | null) : null;
        return { enabled: c.enabled, exchange: c.exchange, demo: c.demo, leverage: c.leverage, orderUsdt: c.orderUsdt, connected: !!(info?.crypto && acc?.connected), label: info?.cryptoLabel ?? "", account: acc };
      })(),
      openTrades: open,
      pendingSignals: pending,
      recentSignals,
      jobs,
      watching: rules.filter((r) => r.enabled),
      provider: provider ? { name: provider.name, model: provider.model, isLocal: provider.isLocal } : null,
      perf,
    });
  });
}
