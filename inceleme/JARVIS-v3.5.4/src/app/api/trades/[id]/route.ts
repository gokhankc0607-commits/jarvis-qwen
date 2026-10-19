import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { trades } from "@/db/schema";
import { type Ctx, num, withUser } from "@/lib/api";
import { isLive, precheck, queueClose, queueModify, queuePartial } from "@/lib/tradeOps";

/**
 * Canlı modda (ajan bağlı) SL/TP değişikliği ve kapatma MT5'e KOMUT olarak gider; sonuç ajan bildirince kayda yansır.
 * Yanıt: { ...trade, commandId } — arayüz /api/commands/:id ile sonucu takip eder.
 */
export async function PATCH(req: Request, ctx: Ctx) {
  return withUser(async (u) => {
    const id = Number((await ctx.params).id);
    const b = await req.json();
    const [t] = await db.select().from(trades).where(and(eq(trades.id, id), eq(trades.userId, u.id))).limit(1);
    if (!t) throw new Error("İşlem bulunamadı");
    const live = (await isLive(u.id)) && t.source === "agent";

    if (b.action === "close") {
      const c = await queueClose(u.id, t, live);
      return Response.json({ ...t, status: live ? "closing" : "closed", commandId: c.id, queued: live });
    }

    if (b.action === "partial") {
      const c = await queuePartial(u.id, t, Number(b.fraction) || 0.5, live);
      const [r] = await db.select().from(trades).where(eq(trades.id, id));
      return Response.json({ ...r, commandId: c.id, queued: live });
    }

    let sl: number | null = null, tp: number | null = null;
    if (b.action === "breakeven") sl = t.openPrice;
    else {
      if (b.sl !== undefined) sl = b.sl === null || b.sl === "" ? 0 : num(b.sl);
      if (b.tp !== undefined) tp = b.tp === null || b.tp === "" ? 0 : num(b.tp);
      if (sl !== null && sl === t.sl) sl = null; // değişmeyenleri gönderme
      if (tp !== null && tp === t.tp) tp = null;
    }
    if (b.comment !== undefined) await db.update(trades).set({ comment: String(b.comment) }).where(eq(trades.id, id));
    // zaman dilimini elle ata (yalnızca panel kaydı; MT5'e gitmez). Sync boş olmayan değeri ezmez.
    if (b.timeframe !== undefined) {
      const tf = String(b.timeframe ?? "").toUpperCase();
      if (tf && !["M1", "M3", "M5", "M15", "M30", "H1", "H4", "D1", "MAN"].includes(tf)) throw new Error("Geçersiz zaman dilimi");
      await db.update(trades).set({ timeframe: tf }).where(eq(trades.id, id));
      if (sl === null && tp === null && b.sl === undefined && b.tp === undefined) {
        const [r] = await db.select().from(trades).where(eq(trades.id, id));
        return Response.json(r);
      }
    }
    if (sl === null && tp === null) {
      const [r] = await db.select().from(trades).where(eq(trades.id, id));
      return Response.json(r);
    }
    const err = precheck(u.id, t, sl, tp);
    if (err) throw new Error(err);
    const c = await queueModify(u.id, t, sl, tp, live);
    const [r] = await db.select().from(trades).where(eq(trades.id, id));
    return Response.json({ ...r, commandId: c.id, queued: live });
  });
}

export async function DELETE(_req: Request, ctx: Ctx) {
  return withUser(async (u) => {
    const id = Number((await ctx.params).id);
    await db.delete(trades).where(and(eq(trades.id, id), eq(trades.userId, u.id)));
    return Response.json({ ok: true });
  });
}
