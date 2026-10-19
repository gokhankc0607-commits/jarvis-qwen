import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { watchRules } from "@/db/schema";
import { type Ctx, withUser } from "@/lib/api";
import { ruleFields } from "@/lib/rules";

export async function PATCH(req: Request, ctx: Ctx) {
  return withUser(async (u) => {
    const id = Number((await ctx.params).id);
    const f = ruleFields(await req.json());
    const [r] = await db.update(watchRules).set(f).where(and(eq(watchRules.id, id), eq(watchRules.userId, u.id))).returning();
    return Response.json(r);
  });
}

export async function DELETE(_req: Request, ctx: Ctx) {
  return withUser(async (u) => {
    const id = Number((await ctx.params).id);
    await db.delete(watchRules).where(and(eq(watchRules.id, id), eq(watchRules.userId, u.id)));
    return Response.json({ ok: true });
  });
}
