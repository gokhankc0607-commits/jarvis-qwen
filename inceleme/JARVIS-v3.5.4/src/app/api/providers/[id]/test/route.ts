import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { aiProviders } from "@/db/schema";
import { type Ctx, withUser } from "@/lib/api";
import { callLLM } from "@/lib/llm";

export async function POST(_req: Request, ctx: Ctx) {
  return withUser(async (u) => {
    const id = Number((await ctx.params).id);
    const [p] = await db.select().from(aiProviders).where(and(eq(aiProviders.id, id), eq(aiProviders.userId, u.id)));
    if (!p) throw new Error("Bulunamadı");
    const t0 = Date.now();
    try {
      const out = await callLLM(p, [{ role: "user", content: "Sadece 'JARVIS hazır' yaz." }], 20000);
      return Response.json({ ok: true, ms: Date.now() - t0, reply: out.slice(0, 200) });
    } catch (e) {
      return Response.json({ ok: false, ms: Date.now() - t0, error: (e as Error).message.slice(0, 300) });
    }
  });
}
