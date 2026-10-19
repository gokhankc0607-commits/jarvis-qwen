import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { strategies, compileJobs } from "@/db/schema";
import { type Ctx, withUser } from "@/lib/api";

export async function GET(_req: Request, ctx: Ctx) {
  return withUser(async (u) => {
    const id = Number((await ctx.params).id);
    const [r] = await db.select().from(strategies).where(and(eq(strategies.id, id), eq(strategies.userId, u.id)));
    if (!r) throw new Error("Bulunamadı");
    return Response.json(r);
  });
}

export async function PATCH(req: Request, ctx: Ctx) {
  return withUser(async (u) => {
    const id = Number((await ctx.params).id);
    const b = await req.json();
    const [cur] = await db.select().from(strategies).where(and(eq(strategies.id, id), eq(strategies.userId, u.id)));
    if (!cur) throw new Error("Bulunamadı");
    const set: Partial<typeof strategies.$inferInsert> = { updatedAt: new Date() };
    if (b.name !== undefined) set.name = String(b.name);
    if (b.filePath !== undefined) set.filePath = String(b.filePath);
    if (b.description !== undefined) set.description = String(b.description);
    if (b.code !== undefined && b.code !== cur.code) {
      set.code = String(b.code);
      set.version = cur.version + 1;
      set.status = "draft";
    }
    const [r] = await db.update(strategies).set(set).where(eq(strategies.id, id)).returning();
    return Response.json(r);
  });
}

export async function DELETE(_req: Request, ctx: Ctx) {
  return withUser(async (u) => {
    const id = Number((await ctx.params).id);
    await db.delete(strategies).where(and(eq(strategies.id, id), eq(strategies.userId, u.id)));
    await db.delete(compileJobs).where(and(eq(compileJobs.strategyId, id), eq(compileJobs.userId, u.id)));
    return Response.json({ ok: true });
  });
}
