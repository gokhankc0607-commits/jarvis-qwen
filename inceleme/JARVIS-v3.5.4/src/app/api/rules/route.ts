import { asc, eq } from "drizzle-orm";
import { db } from "@/db";
import { watchRules } from "@/db/schema";
import { withUser } from "@/lib/api";
import { ruleFields } from "@/lib/rules";

export async function GET() {
  return withUser(async (u) => {
    const rows = await db.select().from(watchRules).where(eq(watchRules.userId, u.id)).orderBy(asc(watchRules.id));
    return Response.json(rows);
  });
}

export async function POST(req: Request) {
  return withUser(async (u) => {
    const f = ruleFields(await req.json());
    if (!f.symbol) throw new Error("Sembol gerekli");
    const [row] = await db.insert(watchRules).values({ ...f, symbol: f.symbol, userId: u.id }).returning();
    return Response.json(row);
  });
}
