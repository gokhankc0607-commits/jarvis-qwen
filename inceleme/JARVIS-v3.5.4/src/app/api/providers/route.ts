import { asc, eq } from "drizzle-orm";
import { db } from "@/db";
import { aiProviders } from "@/db/schema";
import { withUser } from "@/lib/api";

const KINDS = ["ollama", "openai_compat", "anthropic", "gemini"];

export async function GET() {
  return withUser(async (u) => {
    const rows = await db.select().from(aiProviders).where(eq(aiProviders.userId, u.id)).orderBy(asc(aiProviders.id));
    return Response.json(rows.map((r) => ({ ...r, apiKey: r.apiKey ? "••••" + r.apiKey.slice(-4) : "" })));
  });
}

export async function POST(req: Request) {
  return withUser(async (u) => {
    const b = await req.json();
    if (!b.name || !b.baseUrl || !b.model) throw new Error("Ad, URL ve model gerekli");
    const kind = KINDS.includes(b.kind) ? b.kind : "openai_compat";
    const baseUrl = String(b.baseUrl);
    const isLocal = /localhost|127\.0\.0\.1|0\.0\.0\.0|192\.168\.|10\./.test(baseUrl);
    const [row] = await db
      .insert(aiProviders)
      .values({ userId: u.id, name: String(b.name), kind, baseUrl, model: String(b.model), apiKey: String(b.apiKey || ""), isLocal })
      .returning();
    return Response.json({ ...row, apiKey: row.apiKey ? "••••" + row.apiKey.slice(-4) : "" });
  });
}
