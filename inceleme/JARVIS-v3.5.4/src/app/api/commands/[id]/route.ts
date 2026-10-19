import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { tradeCommands } from "@/db/schema";
import { type Ctx, withUser } from "@/lib/api";

export const dynamic = "force-dynamic";

export async function GET(_req: Request, ctx: Ctx) {
  return withUser(async (u) => {
    const id = Number((await ctx.params).id);
    const [c] = await db.select().from(tradeCommands).where(and(eq(tradeCommands.id, id), eq(tradeCommands.userId, u.id))).limit(1);
    if (!c) throw new Error("Komut bulunamadı");
    return Response.json(c);
  });
}
