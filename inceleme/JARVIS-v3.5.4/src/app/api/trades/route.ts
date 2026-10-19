import { desc, eq } from "drizzle-orm";
import { db } from "@/db";
import { trades } from "@/db/schema";
import { num, withUser } from "@/lib/api";
import { isAgentOnline } from "@/lib/actions";

export async function GET() {
  return withUser(async (u) => {
    const rows = await db.select().from(trades).where(eq(trades.userId, u.id)).orderBy(desc(trades.openedAt));
    const online = await isAgentOnline(u.id);
    return Response.json(online ? rows.filter((t) => t.source === "agent") : rows); // canlıda yalnızca gerçek MT5 işlemleri
  });
}

/** Manuel işlem kaydı (günlük / demo). Gerçek emirler yalnızca onaylı sinyallerle ajan tarafından açılır. */
export async function POST(req: Request) {
  return withUser(async (u) => {
    const b = await req.json();
    const symbol = String(b.symbol ?? "").toUpperCase().trim();
    const openPrice = num(b.openPrice);
    const volume = num(b.volume, 0.1) ?? 0.1;
    if (!symbol || openPrice === null) throw new Error("Sembol ve açılış fiyatı gerekli");
    const [row] = await db
      .insert(trades)
      .values({
        userId: u.id,
        ticket: String(b.ticket || 100490000 + Math.floor(Math.random() * 9999)),
        symbol,
        side: b.side === "SELL" ? "SELL" : "BUY",
        volume,
        openPrice,
        currentPrice: openPrice,
        sl: num(b.sl),
        tp: num(b.tp),
        comment: String(b.comment || "manuel kayıt"),
        source: "manual",
      })
      .returning();
    return Response.json(row);
  });
}
