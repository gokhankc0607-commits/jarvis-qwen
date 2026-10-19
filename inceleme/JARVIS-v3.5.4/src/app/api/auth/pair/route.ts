import { headers } from "next/headers";
import { NextResponse } from "next/server";
import { and, eq, gt, like } from "drizzle-orm";
import { db } from "@/db";
import { sessions } from "@/db/schema";
import { createSession } from "@/lib/auth";

export const dynamic = "force-dynamic";

/** QR ile gelen tek kullanımlık bağlantı: oturum açar ve komuta merkezine yönlendirir. */
export async function GET(req: Request) {
  const t = new URL(req.url).searchParams.get("t") ?? "";
  const h = await headers();
  const host = h.get("x-forwarded-host") ?? h.get("host") ?? "localhost:3000";
  const proto = (h.get("x-forwarded-proto") ?? "http").split(",")[0].trim();
  const origin = `${proto}://${host}`;

  const [row] = t.startsWith("pair_")
    ? await db.select().from(sessions).where(and(eq(sessions.id, t), like(sessions.id, "pair_%"), gt(sessions.expiresAt, new Date()))).limit(1)
    : [];
  if (!row) return NextResponse.redirect(new URL("/login?pair=expired", origin));
  await db.delete(sessions).where(eq(sessions.id, t)); // tek kullanım
  await createSession(row.userId);
  return NextResponse.redirect(new URL("/dashboard", origin));
}
