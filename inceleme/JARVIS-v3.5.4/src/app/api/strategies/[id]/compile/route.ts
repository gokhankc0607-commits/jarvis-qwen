import { type Ctx, withUser } from "@/lib/api";
import { compileStrategy } from "@/lib/actions";

export async function POST(req: Request, ctx: Ctx) {
  return withUser(async (u) => {
    const id = Number((await ctx.params).id);
    const b = await req.json().catch(() => ({}));
    const job = await compileStrategy(u.id, id, b.autoFix !== false);
    return Response.json(job);
  });
}
