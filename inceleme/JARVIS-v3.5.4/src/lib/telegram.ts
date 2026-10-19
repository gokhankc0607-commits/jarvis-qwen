import { eq } from "drizzle-orm";
import { db } from "@/db";
import { telegramSettings } from "@/db/schema";
import type { KanalItem } from "./kanal";
import type { Signal } from "./types";
import { formatSignalText } from "./tgFormat";
export { formatSignalText };

type Row = typeof telegramSettings.$inferSelect;

export type TgCfg = {
  enabled: boolean; botToken: string; chatId: string;
  onSignal: boolean; onAuto: boolean; onProfit: boolean; onError: boolean;
  minConf: number; buttons: boolean; quietUntil: string | null;
};

const DEFAULTS: TgCfg = {
  enabled: false, botToken: "", chatId: "", onSignal: true, onAuto: true, onProfit: true, onError: true, minConf: 70, buttons: true, quietUntil: null,
};

export async function tgCfg(userId: number): Promise<TgCfg> {
  let [r] = await db.select().from(telegramSettings).where(eq(telegramSettings.userId, userId)).limit(1);
  if (!r) {
    await db.insert(telegramSettings).values({ userId }).onConflictDoNothing();
    [r] = await db.select().from(telegramSettings).where(eq(telegramSettings.userId, userId)).limit(1);
  }
  if (!r) return DEFAULTS;
  return { ...DEFAULTS, ...r, quietUntil: r.quietUntil ? new Date(r.quietUntil).toISOString() : null };
}

export async function saveTg(userId: number, body: Record<string, unknown>): Promise<TgCfg> {
  const cur = await tgCfg(userId);
  const set: Partial<Row> = { updatedAt: new Date() };
  for (const k of ["botToken", "chatId"] as const)
    if (body[k] !== undefined) set[k] = String(body[k] ?? "").trim().slice(0, 200);
  for (const k of ["enabled", "onSignal", "onAuto", "onProfit", "onError", "buttons"] as const)
    if (body[k] !== undefined) set[k] = Boolean(body[k]);
  if (body.minConf !== undefined) {
    const n = Number(body.minConf);
    set.minConf = Number.isFinite(n) ? Math.min(99, Math.max(30, Math.round(n))) : cur.minConf;
  }
  if (body.quietMinutes !== undefined) {
    const m = Math.max(0, Math.min(1440, Number(body.quietMinutes) || 0));
    set.quietUntil = m ? new Date(Date.now() + m * 60000) : null;
  }
  await db.update(telegramSettings).set(set).where(eq(telegramSettings.userId, userId));
  return tgCfg(userId);
}

const isQuiet = (c: TgCfg) => !!c.quietUntil && new Date(c.quietUntil).getTime() > Date.now();

/* ------------------------------------------------------------------ Telegram API */
export async function tgCall(token: string, method: string, payload: Record<string, unknown>, timeout = 15000) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeout);
  try {
    const r = await fetch(`https://api.telegram.org/bot${token}/${method}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
      signal: ctrl.signal,
    });
    const j = (await r.json().catch(() => ({}))) as { ok: boolean; description?: string; result?: unknown };
    return { ok: !!j.ok, desc: j.description ?? `HTTP ${r.status}`, result: j.result };
  } finally {
    clearTimeout(t);
  }
}

/** Bot'a yazmış kullanıcıların chat ID'lerini bulur (önce bota /start yazmalı). */
export async function findChat(token: string) {
  const r = await tgCall(token, "getUpdates", { limit: 20, timeout: 0 }, 20000);
  const ups = (r.result ?? []) as { message?: { chat?: { id: number; first_name?: string; username?: string } }; my_chat_member?: { chat?: { id: number } } }[];
  const seen: { id: number; name: string }[] = [];
  for (const u of ups) {
    const c = u.message?.chat ?? u.my_chat_member?.chat;
    if (c && !seen.some((s) => s.id === c.id)) seen.push({ id: c.id, name: u.message?.chat?.first_name || u.message?.chat?.username || "" });
  }
  return seen;
}

export async function sendTg(userId: number, text: string, kb?: { text: string; data?: string; url?: string }[][]): Promise<{ ok: boolean; error?: string; quiet?: boolean }> {
  const c = await tgCfg(userId);
  if (!c.enabled || !c.botToken || !c.chatId) return { ok: false, error: "Telegram kapalı / ayarlı değil" };
  if (isQuiet(c)) return { ok: false, quiet: true, error: "Susturuldu" };
  const payload: Record<string, unknown> = { chat_id: c.chatId, text, parse_mode: "HTML", disable_web_page_preview: true };
  if (kb?.length && c.buttons)
    payload.reply_markup = { inline_keyboard: kb.map((row) => row.map((b) => (b.url ? { text: b.text, url: b.url } : { text: b.text, callback_data: b.data ?? "noop" }))) };
  const r = await tgCall(c.botToken, "sendMessage", payload);
  return r.ok ? { ok: true } : { ok: false, error: r.desc };
}

/** Test mesajı: bot ve chat doğrulanır. */
export async function testTg(userId: number) {
  const c = await tgCfg(userId);
  if (!c.botToken) return { ok: false as const, error: "Bot token boş" };
  const me = await tgCall(c.botToken, "getMe", {});
  if (!me.ok) return { ok: false as const, error: `Token geçersiz: ${me.desc}` };
  if (!c.chatId) return { ok: false as const, error: "Chat ID boş", chats: await findChat(c.botToken) };
  const r = await sendTg(userId, "🤖 <b>JARVIS test mesajı</b>\nTelegram bildirimleri çalışıyor. Sinyal geldiğinde buraya yazacağım.");
  return r.ok ? { ok: true as const, bot: (me.result as { username?: string })?.username } : { ok: false as const, error: r.error };
}

/* ------------------------------------------------------------------ biçimlendirme */
const fx = (n: number | null | undefined, d = 2) => (n === null || n === undefined ? "—" : n.toFixed(d));
export const tfTr = (t?: string) => (t === "MAN" ? "elle emir" : t || "?");

/** Sinyal bildirimi: kanal teması / taşması + o anki RSI durumu + seçenek düğmeleri. */
export async function notifySignal(userId: number, s: Signal, item?: KanalItem | null, baseUrl?: string) {
  const c = await tgCfg(userId);
  if (!c.enabled || !c.onSignal) return;
  if (s.confidence && s.confidence < c.minConf) return;
  const text = formatSignalText(s, item);
  const link = baseUrl ? `${baseUrl}/signals` : undefined;
  const kb = [
    [
      { text: "✅ Evet, gir", data: `tgyes:${s.id}` },
      { text: "❌ Hayır", data: `tgno:${s.id}` },
    ],
    ...(link ? [[{ text: "📊 Panelde aç", url: link }]] : []),
    [{ text: "🔕 30 dk sessiz", data: "tgmute:30" }],
  ];
  return sendTg(userId, text, kb);
}

export async function notifyText(userId: number, kind: "auto" | "profit" | "error", text: string) {
  const c = await tgCfg(userId);
  if (!c.enabled) return;
  if (kind === "auto" && !c.onAuto) return;
  if (kind === "profit" && !c.onProfit) return;
  if (kind === "error" && !c.onError) return;
  return sendTg(userId, text);
}
