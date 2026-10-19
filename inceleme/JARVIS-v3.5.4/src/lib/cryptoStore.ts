import { eq } from "drizzle-orm";
import { db } from "@/db";
import { cryptoSettings } from "@/db/schema";

export type CryptoCfg = {
  enabled: boolean; exchange: string; apiKey: string; secret: string; password: string;
  demo: boolean; leverage: number; marginMode: "isolated" | "cross"; orderUsdt: number;
};
const EXCHANGES = ["binance", "bybit", "okx", "mexc", "kucoinfutures", "bitget", "gateio"];

export async function cryptoCfg(userId: number): Promise<CryptoCfg> {
  let [r] = await db.select().from(cryptoSettings).where(eq(cryptoSettings.userId, userId)).limit(1);
  if (!r) {
    await db.insert(cryptoSettings).values({ userId }).onConflictDoNothing();
    [r] = await db.select().from(cryptoSettings).where(eq(cryptoSettings.userId, userId)).limit(1);
  }
  return {
    enabled: r?.enabled ?? false, exchange: r?.exchange ?? "binance", apiKey: r?.apiKey ?? "", secret: r?.secret ?? "", password: r?.password ?? "",
    demo: r?.demo ?? true, leverage: r?.leverage ?? 5, marginMode: r?.marginMode === "cross" ? "cross" : "isolated", orderUsdt: r?.orderUsdt ?? 50,
  };
}

export async function saveCrypto(userId: number, b: Record<string, unknown>): Promise<CryptoCfg> {
  await cryptoCfg(userId);
  const set: Partial<typeof cryptoSettings.$inferInsert> = { updatedAt: new Date() };
  if (b.enabled !== undefined) set.enabled = Boolean(b.enabled);
  if (b.demo !== undefined) set.demo = Boolean(b.demo);
  if (typeof b.exchange === "string" && EXCHANGES.includes(b.exchange)) set.exchange = b.exchange;
  for (const k of ["apiKey", "secret", "password"] as const) {
    const v = b[k];
    if (typeof v === "string" && !v.startsWith("••••")) set[k] = v.trim().slice(0, 300);
  }
  if (b.leverage !== undefined) set.leverage = Math.min(125, Math.max(1, Math.round(Number(b.leverage) || 5)));
  if (b.marginMode !== undefined) set.marginMode = b.marginMode === "cross" ? "cross" : "isolated";
  if (b.orderUsdt !== undefined) set.orderUsdt = Math.min(100000, Math.max(5, Number(b.orderUsdt) || 50));
  await db.update(cryptoSettings).set(set).where(eq(cryptoSettings.userId, userId));
  return cryptoCfg(userId);
}

export const maskCrypto = (c: CryptoCfg) => ({
  ...c,
  apiKey: c.apiKey ? "••••" + c.apiKey.slice(-6) : "",
  secret: c.secret ? "••••" + c.secret.slice(-4) : "",
  password: c.password ? "••••" : "",
});
