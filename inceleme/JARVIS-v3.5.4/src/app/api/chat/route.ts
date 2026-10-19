import { desc, eq } from "drizzle-orm";
import { db } from "@/db";
import { messages } from "@/db/schema";
import { withUser } from "@/lib/api";
import { handleChat } from "@/lib/chat";

export async function GET() {
  return withUser(async (u) => {
    const rows = await db.select().from(messages).where(eq(messages.userId, u.id)).orderBy(desc(messages.createdAt)).limit(40);
    return Response.json(rows.reverse());
  });
}

export async function DELETE() {
  return withUser(async (u) => {
    await db.delete(messages).where(eq(messages.userId, u.id));
    return Response.json({ ok: true });
  });
}

export async function POST(req: Request) {
  return withUser(async (u) => {
    const b = await req.json();
    const input = String(b.text ?? "").trim();
    if (!input) throw new Error("Mesaj boş");
    const ctx = { symbol: typeof b.context?.symbol === "string" ? b.context.symbol : null };
    return Response.json(await handleChat(u.id, input, ctx));
  });
}
