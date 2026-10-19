import { eq } from "drizzle-orm";
import { db } from "@/db";
import { users } from "@/db/schema";
import { createSession, hashPassword, newAgentKey, verifyPassword } from "@/lib/auth";
import { seedUser } from "@/lib/seed";

const DEMO_EMAIL = "demo@jarvis.local";

async function handle(req: Request) {
  const { email, password } = await req.json().catch(() => ({}));
  const em = String(email ?? "").trim().toLowerCase();
  const pw = String(password ?? "");
  if (!em || !pw) return Response.json({ error: "E-posta ve şifre gerekli" }, { status: 400 });

  let [u] = await db.select().from(users).where(eq(users.email, em)).limit(1);
  if (!u && em === DEMO_EMAIL && pw === "jarvis123") {
    [u] = await db
      .insert(users)
      .values({ email: em, name: "Kaptan", passwordHash: hashPassword(pw), agentKey: newAgentKey() })
      .returning();
    await seedUser(u.id);
  }
  if (!u || !verifyPassword(pw, u.passwordHash))
    return Response.json({ error: "Geçersiz e-posta veya şifre" }, { status: 401 });
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
