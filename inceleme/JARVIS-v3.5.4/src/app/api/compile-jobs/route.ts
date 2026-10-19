import { desc, eq } from "drizzle-orm";
import { db } from "@/db";
import { compileJobs, strategies } from "@/db/schema";
import { withUser } from "@/lib/api";

export async function GET(req: Request) {
  return withUser(async (u) => {
    const sid = new URL(req.url).searchParams.get("strategyId");
    const rows = await db
      .select({ job: compileJobs, strategyName: strategies.name })
      .from(compileJobs)
      .leftJoin(strategies, eq(strategies.id, compileJobs.strategyId))
      .where(eq(compileJobs.userId, u.id))
      .orderBy(desc(compileJobs.createdAt))
      .limit(50);
    const list = rows.map((r) => ({ ...r.job, strategyName: r.strategyName }));
    return Response.json(sid ? list.filter((j) => j.strategyId === Number(sid)) : list);
  });
}
