import { and, eq, inArray } from "drizzle-orm";
import { db } from "@/db";
import { accountState, trades, tradeCommands } from "@/db/schema";
import { agentOnline, pipSize } from "./sim";
import { findTick } from "./live";
import { resolveLevel } from "./orders";
import type { Level } from "./tradeCommand";

export type TradeRow = typeof trades.$inferSelect;

export async function isLive(userId: number) {
  const [a] = await db.select().from(accountState).where(eq(accountState.userId, userId)).limit(1);
  return agentOnline(a?.agentLastSeen);
}

export async function openTrades(userId: number, live: boolean) {
  const rows = await db.select().from(trades).where(and(eq(trades.userId, userId), eq(trades.status, "open")));
  return live ? rows.filter((t) => t.source === "agent") : rows;
}

const digitsOf = (p: number) => (p > 1000 ? 2 : p > 50 ? 3 : 5);

/** Pozisyon için yeni SL/TP hesaplar. be: girişe çek. Pip mesafeleri GİRİŞ fiyatından ölçülür. */
export function computeModify(t: TradeRow, o: { be?: boolean; sl?: Level | "remove" | null; tp?: Level | "remove" | null }) {
  const side = t.side as "BUY" | "SELL";
  const pip = pipSize(t.symbol);
  const d = digitsOf(t.openPrice);
  let sl: number | null = null, tp: number | null = null;
  if (o.be) sl = t.openPrice;
  else if (o.sl === "remove") sl = 0;
  else if (o.sl) sl = resolveLevel(o.sl, "sl", side, t.openPrice, pip);
  if (o.tp === "remove") tp = 0;
  else if (o.tp) tp = resolveLevel(o.tp, "tp", side, t.openPrice, pip);
  return { sl: sl === null ? null : Number(sl.toFixed(d)), tp: tp === null ? null : Number(tp.toFixed(d)) };
}

/** Panelde ön kontrol (ajan yine MT5 kurallarıyla kesin kontrol yapar). */
export function precheck(userId: number, t: TradeRow, sl: number | null, tp: number | null): string | null {
  const tk = findTick(userId, t.symbol, 20000, (t.market as "forex" | "crypto") ?? "forex");
  const ref = tk ? (t.side === "BUY" ? tk.bid : tk.ask) : t.currentPrice;
  const buy = t.side === "BUY";
  if (sl && (buy ? sl >= ref : sl <= ref)) {
    const atEntry = Math.abs(sl - t.openPrice) < Math.abs(t.openPrice) * 1e-6;
    return atEntry
      ? `${t.symbol} ${buy ? "ALIŞ" : "SATIŞ"}: fiyat (${ref}) henüz girişin (${t.openPrice}) ${buy ? "üstüne" : "altına"} geçmedi, SL girişe çekilemez.`
      : `${t.symbol}: SL ${sl} geçersiz — ${buy ? "ALIŞ'ta SL fiyatın altında" : "SATIŞ'ta SL fiyatın üstünde"} olmalı (güncel ${ref}).`;
  }
  if (tp && (buy ? tp <= ref : tp >= ref)) return `${t.symbol}: TP ${tp} geçersiz — ${buy ? "ALIŞ'ta TP fiyatın üstünde" : "SATIŞ'ta TP fiyatın altında"} olmalı (güncel ${ref}).`;
  return null;
}

export async function queueModify(userId: number, t: TradeRow, sl: number | null, tp: number | null, live: boolean) {
  if (!live) {
    const set: Partial<typeof trades.$inferInsert> = {};
    if (sl !== null) set.sl = sl || null;
    if (tp !== null) set.tp = tp || null;
    await db.update(trades).set(set).where(eq(trades.id, t.id));
    const [c] = await db.insert(tradeCommands).values({ userId, ticket: t.ticket, symbol: t.symbol, type: "modify", sl, tp, status: "done", note: "Demo: kayıt güncellendi", doneAt: new Date() }).returning();
    return c;
  }
  const [c] = await db.insert(tradeCommands).values({ userId, ticket: t.ticket, symbol: t.symbol, type: "modify", sl, tp, market: t.market ?? "forex" }).returning();
  return c;
}

export async function queueClose(userId: number, t: TradeRow, live: boolean) {
  if (!live || t.source !== "agent") {
    await db.update(trades).set({ status: "closed", closedAt: new Date() }).where(eq(trades.id, t.id));
    const [a] = await db.select().from(accountState).where(eq(accountState.userId, userId)).limit(1);
    if (a) await db.update(accountState).set({ balance: a.balance + t.pnl }).where(eq(accountState.userId, userId));
    const [c] = await db.insert(tradeCommands).values({ userId, ticket: t.ticket, symbol: t.symbol, type: "close", status: "done", note: "Demo: kapatıldı", doneAt: new Date() }).returning();
    return c;
  }
  await db.update(trades).set({ status: "closing" }).where(eq(trades.id, t.id));
  const [c] = await db.insert(tradeCommands).values({ userId, ticket: t.ticket, symbol: t.symbol, type: "close", market: t.market ?? "forex" }).returning();
  return c;
}

/** Pozisyonun bir kısmını kapat (fraction 0.5 = yarısı). Canlıda MT5'e komut gider; demoda kayıt güncellenir. */
export async function queuePartial(userId: number, t: TradeRow, fraction: number, live: boolean) {
  const fr = Math.min(0.9, Math.max(0.1, fraction));
  if (!live || t.source !== "agent") {
    const step = 0.01;
    const part = Math.floor((t.volume * fr) / step + 1e-9) * step;
    if (part < 0.01 || t.volume - part < 0.01 - 1e-9) throw new Error(`${t.symbol}: ${t.volume} lot bölünemeyecek kadar küçük.`);
    const realized = Math.round(t.pnl * (part / t.volume) * 100) / 100;
    await db.update(trades).set({ volume: Math.round((t.volume - part) * 100) / 100, pnl: Math.round((t.pnl - realized) * 100) / 100 }).where(eq(trades.id, t.id));
    const [a] = await db.select().from(accountState).where(eq(accountState.userId, userId)).limit(1);
    if (a) await db.update(accountState).set({ balance: a.balance + realized }).where(eq(accountState.userId, userId));
    const [c] = await db.insert(tradeCommands).values({ userId, ticket: t.ticket, symbol: t.symbol, type: "partial", fraction: fr, status: "done", note: `Demo: ${part.toFixed(2)} lot kapatıldı (gerçekleşen ${realized})`, doneAt: new Date() }).returning();
    return c;
  }
  const [c] = await db.insert(tradeCommands).values({ userId, ticket: t.ticket, symbol: t.symbol, type: "partial", fraction: fr, market: t.market ?? "forex" }).returning();
  return c;
}

export async function waitCommands(ids: number[], ms = 12000) {
  const end = Date.now() + ms;
  let rows: (typeof tradeCommands.$inferSelect)[] = [];
  while (Date.now() < end) {
    rows = await db.select().from(tradeCommands).where(inArray(tradeCommands.id, ids));
    if (rows.every((r) => r.status === "done" || r.status === "failed")) return rows;
    await new Promise((r) => setTimeout(r, 700));
  }
  return rows;
}

/* ------------------------------------------------ bekleyen "hepsini kapat" onayı (bellekte, 2 dk) */
export type PendingAction =
  | { kind: "closeAll"; ids: number[]; at: number }
  | { kind: "askMarket"; at: number; cmd: Record<string, unknown> }; // "kripto mu forex mi?" sorusu
const g = globalThis as typeof globalThis & { __jarvisPA?: Map<number, PendingAction> };
export function setPendingAction(userId: number, a: PendingAction | null) {
  g.__jarvisPA ??= new Map();
  if (a) g.__jarvisPA.set(userId, a);
  else g.__jarvisPA.delete(userId);
}
export function getPendingAction(userId: number): PendingAction | undefined {
  const a = g.__jarvisPA?.get(userId);
  return a && Date.now() - a.at < 120000 ? a : undefined;
}
