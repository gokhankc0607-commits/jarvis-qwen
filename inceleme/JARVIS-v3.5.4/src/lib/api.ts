import { getUser, type SessionUser } from "./auth";

export type Ctx<P = { id: string }> = { params: Promise<P> };

export async function withUser(fn: (u: SessionUser) => Promise<Response>) {
  const u = await getUser();
  if (!u) return Response.json({ error: "Yetkisiz" }, { status: 401 });
  try {
    return await fn(u);
  } catch (e) {
    return Response.json({ error: (e as Error).message }, { status: 400 });
  }
}

export function num(v: unknown, d: number | null = null): number | null {
  if (v === undefined || v === null || v === "") return d;
  const n = Number(v);
  return Number.isFinite(n) ? n : d;
}

export function pick<T extends Record<string, unknown>>(body: Record<string, unknown>, keys: (keyof T)[]) {
  const out: Partial<T> = {};
  for (const k of keys) if (k in body) out[k] = body[k as string] as T[keyof T];
  return out;
}
