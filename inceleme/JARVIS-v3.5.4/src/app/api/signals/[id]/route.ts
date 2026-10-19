import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { signals } from "@/db/schema";
import { type Ctx, num, withUser } from "@/lib/api";
import { decideSignal } from "@/lib/actions";

export async function PATCH(req: Request, ctx: Ctx) {
  return withUser(async (u) => {
    const id = Number((await ctx.params).id);
    const b = await req.json();
    if (b.decision === "approve" || b.decision === "reject" || b.decision === "retry") {
      const r = await decideSignal(u.id, id, b.decision !== "reject");
      return Response.json(r);
    }
    const set: Partial<typeof signals.$inferInsert> = {};
    if (b.sl !== undefined) set.sl = num(b.sl);
    if (b.tp !== undefined) set.tp = num(b.tp);
    if (b.volume !== undefined) set.volume = num(b.volume, 0.1) ?? 0.1;
    if (b.reason !== undefined) set.reason = String(b.reason);
    if (b.status === "expired") set.status = "expired";
    const [r] = await db.update(signals).set(set).where(and(eq(signals.id, id), eq(signals.userId, u.id))).returning();
    return Response.json(r);
  });
}

export async function DELETE(_req: Request, ctx: Ctx) {
  return withUser(async (u) => {
    const id = Number((await ctx.params).id);
    await db.delete(signals).where(and(eq(signals.id, id), eq(signals.userId, u.id)));
    return Response.json({ ok: true });
  });
}
