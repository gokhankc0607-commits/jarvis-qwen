import { desc, eq } from "drizzle-orm";
import { db } from "@/db";
import { signals } from "@/db/schema";
import { num, withUser } from "@/lib/api";

export async function GET() {
  return withUser(async (u) => {
    const rows = await db.select().from(signals).where(eq(signals.userId, u.id)).orderBy(desc(signals.createdAt));
    return Response.json(rows);
  });
}

export async function POST(req: Request) {
  return withUser(async (u) => {
    const b = await req.json();
    const symbol = String(b.symbol ?? "").toUpperCase().trim();
    const side = b.side === "SELL" ? "SELL" : "BUY";
    const price = num(b.price);
    if (!symbol || price === null) throw new Error("Sembol ve fiyat gerekli");
    const [row] = await db
      .insert(signals)
      .values({
        userId: u.id,
        symbol,
        side,
        price,
        timeframe: String(b.timeframe || "H1"),
        sl: num(b.sl),
        tp: num(b.tp),
        volume: num(b.volume, 0.1) ?? 0.1,
        reason: String(b.reason || "Manuel sinyal"),
        confidence: Math.min(100, Math.max(0, num(b.confidence, 50) ?? 50)),
        indicators: b.indicators && typeof b.indicators === "object" ? b.indicators : {},
        source: b.source === "demo" ? "demo" : "manual",
      })
      .returning();
    return Response.json(row);
  });
}
