import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { aiProviders } from "@/db/schema";
import { type Ctx, withUser } from "@/lib/api";

export async function PATCH(req: Request, ctx: Ctx) {
  return withUser(async (u) => {
    const id = Number((await ctx.params).id);
    const b = await req.json();
    const set: Partial<typeof aiProviders.$inferInsert> = {};
    for (const k of ["name", "baseUrl", "model", "kind"] as const) if (b[k] !== undefined) set[k] = String(b[k]);
    if (b.apiKey !== undefined && !String(b.apiKey).startsWith("••••")) set.apiKey = String(b.apiKey);
    if (set.baseUrl) set.isLocal = /localhost|127\.0\.0\.1|0\.0\.0\.0|192\.168\.|10\./.test(set.baseUrl);
    if (b.isActive === true) {
      await db.update(aiProviders).set({ isActive: false }).where(eq(aiProviders.userId, u.id));
      set.isActive = true;
    } else if (b.isActive === false) set.isActive = false;
    const [r] = await db.update(aiProviders).set(set).where(and(eq(aiProviders.id, id), eq(aiProviders.userId, u.id))).returning();
    return Response.json({ ...r, apiKey: r.apiKey ? "••••" + r.apiKey.slice(-4) : "" });
  });
}

export async function DELETE(_req: Request, ctx: Ctx) {
  return withUser(async (u) => {
    const id = Number((await ctx.params).id);
    await db.delete(aiProviders).where(and(eq(aiProviders.id, id), eq(aiProviders.userId, u.id)));
    return Response.json({ ok: true });
  });
}
