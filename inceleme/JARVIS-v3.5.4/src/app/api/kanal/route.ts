import { eq } from "drizzle-orm";
import { db } from "@/db";
import { accountState } from "@/db/schema";
import { withUser } from "@/lib/api";
import { agentOnline } from "@/lib/sim";
import { getAgentInfo, getMarketWatch, getScan } from "@/lib/live";
import { demoCandles } from "@/lib/demo";
import { kanalAnalyze, type KanalItem } from "@/lib/kanal";
import { ensureKanal, updateKanal } from "@/lib/kanalStore";
import { userRules } from "@/lib/market";
import { parseTfs } from "@/lib/tf";

export const dynamic = "force-dynamic";

export async function GET() {
  return withUser(async (u) => {
    const cfg = await ensureKanal(u.id);
    const [acc] = await db.select().from(accountState).where(eq(accountState.userId, u.id)).limit(1);
    const live = agentOnline(acc?.agentLastSeen);
    const rules = await userRules(u.id);
    const ruleSymbols = [...new Set(rules.map((r) => r.symbol.toUpperCase()))];

    let items: KanalItem[] = [];
    let watch: string[] = [];
    let at = Date.now();
    if (live) {
      const sc = getScan(u.id);
      items = (sc?.items ?? []) as KanalItem[];
      watch = sc?.watch ?? [];
      at = sc?.at ?? 0;
    } else {
      // Demo: izleme kurallarındaki pariteleri demo mumlarıyla tara
      watch = cfg.symbols.length ? cfg.symbols : ruleSymbols; // demo: takip listesi (boşsa izleme kuralları)
      for (const sym of watch)
        for (const tf of parseTfs(cfg.timeframes)) {
          const it = kanalAnalyze(sym, tf, demoCandles(sym, tf, 320), cfg.params);
          if (it) items.push(it);
        }
    }
    items.sort((a, b) => b.stage - a.stage || Number(b.fire) - Number(a.fire) || a.symbol.localeCompare(b.symbol));
    return Response.json({
      settings: cfg, live, items, watch, at, ruleSymbols,
      marketWatch: live ? getMarketWatch(u.id) : [],
      agentVersion: live ? getAgentInfo(u.id)?.version || null : null,
    });
  });
}

export async function PATCH(req: Request) {
  return withUser(async (u) => {
    const b = await req.json();
    return Response.json(await updateKanal(u.id, b));
  });
}
