import { userFromAgentKey } from "@/lib/auth";
import { putScan, putSeries, setAgentInfo, setCryptoMarketWatch, setMarketWatch, setPing } from "@/lib/live";
import { TF_MIN } from "@/lib/tf";
import type { Candle } from "@/lib/indicators";

type RawSeries = { symbol: string; timeframe: string; bid?: number; ask?: number; candles: number[][]; src?: string; market?: string };

export async function POST(req: Request) {
  const u = await userFromAgentKey(req.headers.get("x-agent-key"));
  if (!u) return Response.json({ error: "Geçersiz ajan anahtarı" }, { status: 401 });
  const b = await req.json().catch(() => ({}));
  let n = 0;
  for (const s of (Array.isArray(b.series) ? b.series : []) as RawSeries[]) {
    if (!s?.symbol || !(s.timeframe in TF_MIN) || !Array.isArray(s.candles)) continue;
    const candles: Candle[] = s.candles
      .filter((c) => Array.isArray(c) && c.length >= 5)
      .map((c) => ({ time: c[0], open: c[1], high: c[2], low: c[3], close: c[4], volume: c[5] ?? 0 }));
    putSeries(u.id, { symbol: s.symbol, timeframe: s.timeframe, candles, bid: s.bid ?? null, ask: s.ask ?? null, market: s.src === "crypto" || s.market === "crypto" ? "crypto" : "forex" });
    n++;
  }
  if (typeof b.ping === "number") setPing(u.id, b.ping);
  if (Array.isArray(b.mw)) setMarketWatch(u.id, (b.mw as unknown[]).filter((x): x is string => typeof x === "string").slice(0, 500));
  if (Array.isArray(b.cryptoMw)) setCryptoMarketWatch(u.id, (b.cryptoMw as unknown[]).filter((x): x is string => typeof x === "string").slice(0, 200));
  if (b.feed && typeof b.feed === "object") {
    const errs = Array.isArray(b.feed.errors) ? (b.feed.errors as unknown[]).slice(0, 20).map((e) => (Array.isArray(e) ? [String(e[0]), String(e[1]).slice(0, 160)] : [String(e), ""])) : [];
    setAgentInfo(u.id, { feedErrors: errs as [string, string][], feedOk: Number(b.feed.ok ?? 0) || 0 });
  }
  // KANAL taraması: Piyasa Gözlemi'ndeki tüm pariteler (ajan hesaplar, panel gösterir)
  if (Array.isArray(b.scan)) {
    const items = (b.scan as Record<string, unknown>[])
      .filter((x) => x && typeof x.symbol === "string" && typeof x.tf === "string" && x.tf in TF_MIN)
      .slice(0, 800);
    const watch = Array.isArray(b.watch) ? (b.watch as unknown[]).filter((x): x is string => typeof x === "string").slice(0, 200) : [];
    putScan(u.id, items, watch);
  }
  return Response.json({ ok: true, series: n, scan: Array.isArray(b.scan) ? b.scan.length : 0 });
}
