import { userFromAgentKey } from "@/lib/auth";
import { putTicks } from "@/lib/live";

export async function POST(req: Request) {
  const u = await userFromAgentKey(req.headers.get("x-agent-key"));
  if (!u) return Response.json({ error: "Geçersiz ajan anahtarı" }, { status: 401 });
  const b = await req.json().catch(() => ({}));
  const ticks = Array.isArray(b.ticks) ? b.ticks.slice(0, 200) : [];
  putTicks(u.id, ticks);
  return Response.json({ ok: true, n: ticks.length });
}
