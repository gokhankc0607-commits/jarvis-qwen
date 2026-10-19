import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { telegramSettings } from "@/db/schema";
import { userFromAgentKey } from "@/lib/auth";
import { decideSignal } from "@/lib/actions";
import { findChat, tgCfg, tgCall } from "@/lib/telegram";

export const dynamic = "force-dynamic";

/**
 * Ajan, Telegram botundaki düğme tıklamalarını buraya iletir:
 *   tgyes:<id> / tgano:<id>  -> sinyali onayla / reddet ·  tgmute:<dk> -> sessiz ·  tgchat -> chat listesi
 * Onay, kullanıcının Telegram'daki açık onayıdır; işlem kuralları aynen uygulanır.
 */
export async function POST(req: Request) {
  const u = await userFromAgentKey(req.headers.get("x-agent-key"));
  if (!u) return Response.json({ error: "Geçersiz ajan anahtarı" }, { status: 401 });
  const b = await req.json().catch(() => ({}));
  const data = String(b.data ?? "");
  const cbId = b.callbackQueryId ? String(b.callbackQueryId) : "";
  const cfg = await tgCfg(u.id);
  const answer = async (text: string) => {
    if (cbId && cfg.botToken)
      await tgCall(cfg.botToken, "answerCallbackQuery", { callback_query_id: cbId, text, show_alert: text.startsWith("✗") }).catch(() => {});
  };

  const [kind, arg] = data.split(":");
  if (kind === "tgyes" || kind === "tgano") {
    const id = Number(arg);
    if (!Number.isFinite(id)) return Response.json({ ok: false, note: "Geçersiz sinyal" });
    try {
      const r = await decideSignal(u.id, id, kind === "tgyes");
      if (kind === "tgano") {
        await answer("❌ Sinyal reddedildi.");
        return Response.json({ ok: true, note: "reddedildi" });
      }
      await answer(r.status === "executed" ? `✅ İşlem açıldı · ${r.note}` : "✅ Onay iletildi — JARVIS emri MT5'e gönderiyor.");
      return Response.json({ ok: true, note: r.note });
    } catch (e) {
      await answer(`✗ ${(e as Error).message}`);
      return Response.json({ ok: false, note: (e as Error).message });
    }
  }
  if (kind === "tgmute") {
    const min = Math.max(1, Math.min(1440, Number(arg) || 30));
    await db
      .update(telegramSettings)
      .set({ quietUntil: new Date(Date.now() + min * 60000), updatedAt: new Date() })
      .where(eq(telegramSettings.userId, u.id));
    await answer(`🔕 ${min} dk sessize alındı.`);
    return Response.json({ ok: true, note: `sessiz ${min} dk` });
  }
  if (kind === "tgchat" || data === "/chat") return Response.json({ ok: true, chats: cfg.botToken ? await findChat(cfg.botToken) : [] });
  return Response.json({ ok: false, note: "Bilinmeyen işlem" });
}
