import { eq } from "drizzle-orm";
import { db } from "@/db";
import { users } from "@/db/schema";
import { createSession, hashPassword, newAgentKey } from "@/lib/auth";
import { seedUser } from "@/lib/seed";

async function handle(req: Request) {
  const { email, password, name } = await req.json().catch(() => ({}));
  const em = String(email ?? "").trim().toLowerCase();
  const pw = String(password ?? "");
  if (!/^\S+@\S+\.\S+$/.test(em)) return Response.json({ error: "Geçerli bir e-posta girin" }, { status: 400 });
  if (pw.length < 6) return Response.json({ error: "Şifre en az 6 karakter olmalı" }, { status: 400 });
  const [ex] = await db.select({ id: users.id }).from(users).where(eq(users.email, em)).limit(1);
  if (ex) return Response.json({ error: "Bu e-posta zaten kayıtlı" }, { status: 409 });
  const [u] = await db
    .insert(users)
    .values({ email: em, name: String(name || "Kaptan").slice(0, 60), passwordHash: hashPassword(pw), agentKey: newAgentKey() })
    .returning();
  await seedUser(u.id);
  await createSession(u.id);
  return Response.json({ ok: true });
}

export async function POST(req: Request) {
  try {
    return await handle(req);
  } catch (e) {
    console.error("[auth]", e);
    const msg = (e as Error).message || "";
    return Response.json(
      { error: `Veritabanı hatası: ${msg.split("\n")[0].slice(0, 160)}` },
      { status: 500 }
    );
  }
}
