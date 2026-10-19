import { userFromAgentKey } from "@/lib/auth";
import { handleChat } from "@/lib/chat";

export const maxDuration = 40;

/** Ajanın sesli komutları ("Jarvis, EURUSD al", "SL girişe çek", "evet") — panel sohbetiyle aynı işleyici. */
export async function POST(req: Request) {
  const u = await userFromAgentKey(req.headers.get("x-agent-key"));
  if (!u) return Response.json({ error: "Geçersiz ajan anahtarı" }, { status: 401 });
  const b = await req.json().catch(() => ({}));
  const text = String(b.text ?? "").trim();
  if (!text) return Response.json({ reply: "", action: null });
  const out = await handleChat(u.id, text, {});
  return Response.json({ reply: out.reply, action: out.action });
}
