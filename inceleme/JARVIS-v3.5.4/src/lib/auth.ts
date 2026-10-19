import { cookies, headers } from "next/headers";
import { randomBytes, scryptSync, timingSafeEqual } from "crypto";
import { eq, and, gt } from "drizzle-orm";
import { db } from "@/db";
import { users, sessions } from "@/db/schema";

const COOKIE = "jarvis_session";

export function hashPassword(pw: string) {
  const salt = randomBytes(16).toString("hex");
  const hash = scryptSync(pw, salt, 64).toString("hex");
  return `${salt}:${hash}`;
}

export function verifyPassword(pw: string, stored: string) {
  const [salt, hash] = stored.split(":");
  if (!salt || !hash) return false;
  const test = scryptSync(pw, salt, 64);
  const orig = Buffer.from(hash, "hex");
  return orig.length === test.length && timingSafeEqual(orig, test);
}

export function newAgentKey() {
  return "jrv_" + randomBytes(24).toString("hex");
}

export async function createSession(userId: number) {
  const id = randomBytes(32).toString("hex");
  const expiresAt = new Date(Date.now() + 1000 * 60 * 60 * 24 * 30);
  await db.insert(sessions).values({ id, userId, expiresAt });
  const c = await cookies();
  // Secure çerez http://192.168.x.x (telefon) üzerinden reddedilir; yalnızca https'te işaretle
  const proto = ((await headers()).get("x-forwarded-proto") ?? "").split(",")[0].trim();
  c.set(COOKIE, id, {
    httpOnly: true,
    sameSite: "lax",
    path: "/",
    expires: expiresAt,
    secure: proto === "https",
  });
}

export async function destroySession() {
  const c = await cookies();
  const id = c.get(COOKIE)?.value;
  if (id) await db.delete(sessions).where(eq(sessions.id, id));
  c.delete(COOKIE);
}

export type SessionUser = { id: number; email: string; name: string; agentKey: string };

export async function getUser(): Promise<SessionUser | null> {
  const c = await cookies();
  const id = c.get(COOKIE)?.value;
  if (!id) return null;
  const rows = await db
    .select({ id: users.id, email: users.email, name: users.name, agentKey: users.agentKey })
    .from(sessions)
    .innerJoin(users, eq(users.id, sessions.userId))
    .where(and(eq(sessions.id, id), gt(sessions.expiresAt, new Date())))
    .limit(1);
  return rows[0] ?? null;
}

export async function userFromAgentKey(key: string | null) {
  if (!key) return null;
  const rows = await db.select().from(users).where(eq(users.agentKey, key)).limit(1);
  return rows[0] ?? null;
}

export function unauthorized() {
  return Response.json({ error: "Yetkisiz" }, { status: 401 });
}
