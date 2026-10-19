import { readFile } from "fs/promises";
import path from "path";
import { userFromAgentKey } from "@/lib/auth";
import { AGENT_ROOT, listAgentFiles } from "@/lib/agentFiles";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const u = await userFromAgentKey(req.headers.get("x-agent-key"));
  if (!u) return Response.json({ error: "Geçersiz ajan anahtarı" }, { status: 401 });
  const name = new URL(req.url).searchParams.get("name") ?? "";
  const allowed = await listAgentFiles(); // yalnızca izinli dosya listesi (yol geçişi yok)
  if (!allowed.includes(name)) return Response.json({ error: "Dosya yok" }, { status: 404 });
  const buf = await readFile(path.join(AGENT_ROOT, name));
  return new Response(new Uint8Array(buf), { headers: { "Content-Type": "application/octet-stream" } });
}
