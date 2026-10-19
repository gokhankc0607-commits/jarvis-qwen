import { createReadStream, existsSync, statSync } from "fs";
import { Readable } from "stream";
import path from "path";
import { userFromAgentKey } from "@/lib/auth";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/** Güvenlik sınırı: bu boyutun üstündeki dosyalar gönderilmez (yanlış dosya koruması). */
const MAX_BYTES = 1024 * 1024 * 1024; // 1 GB

/**
 * Derlenmiş JARVIS.exe'yi ajana akıtarak gönderir (uygulama içi güncelleme).
 * Erişim yalnızca geçerli ajan anahtarıyla; dosya `agent-dist/` içinde, `public/` altında değil.
 */
export async function GET(req: Request) {
  const u = await userFromAgentKey(req.headers.get("x-agent-key"));
  if (!u) return Response.json({ error: "Geçersiz ajan anahtarı" }, { status: 401 });

  const file = path.join(process.cwd(), "agent-dist", "JARVIS.exe");
  if (!existsSync(file)) {
    return Response.json({ error: "Derlenmiş EXE yok" }, { status: 404 });
  }
  const size = statSync(file).size;
  if (size > MAX_BYTES) {
    return Response.json({ error: "EXE beklenmedik boyutta" }, { status: 500 });
  }
  const stream = Readable.toWeb(createReadStream(file)) as unknown as ReadableStream;
  return new Response(stream, {
    headers: {
      "Content-Type": "application/octet-stream",
      "Content-Length": String(size),
      "Content-Disposition": 'attachment; filename="JARVIS.exe"',
      "Cache-Control": "no-store",
    },
  });
}
