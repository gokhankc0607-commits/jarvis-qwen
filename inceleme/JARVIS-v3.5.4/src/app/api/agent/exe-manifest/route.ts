import { existsSync, statSync } from "fs";
import { readFile } from "fs/promises";
import path from "path";
import { userFromAgentKey } from "@/lib/auth";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * Ajanın kendini (JARVIS.exe) güncelleyebilmesi için: derlenmiş EXE'nin
 * sürümü / boyutu / SHA-256 özeti. Dosya yoksa 404 döner — ajan sessizce atlar.
 *
 * EXE, `public/` altında DEĞİLDİR (projede `agent-dist/` klasöründe durur):
 * panelde oturum açmamış birinin devasa dosyayı indirmesi engellenir.
 */
const DIST_DIR = path.join(process.cwd(), "agent-dist");
const EXE = path.join(DIST_DIR, "JARVIS.exe");
const META = path.join(DIST_DIR, "JARVIS.exe.json");

export async function GET(req: Request) {
  const u = await userFromAgentKey(req.headers.get("x-agent-key"));
  if (!u) return Response.json({ error: "Geçersiz ajan anahtarı" }, { status: 401 });

  if (!existsSync(EXE)) {
    return Response.json(
      { error: "Bu panelde derlenmiş JARVIS.exe yok", hint: "python build.py --all --publish" },
      { status: 404 },
    );
  }
  let meta: { version?: string; sha256?: string; size?: number; builtAt?: string } = {};
  try {
    meta = JSON.parse(await readFile(META, "utf8"));
  } catch {
    meta = {};
  }
  const size = statSync(EXE).size;
  return Response.json(
    {
      version: meta.version ?? "0.0.0",
      sha256: meta.sha256 ?? null,          // özet yoksa ajan yalnızca sürüme bakar
      size: meta.size ?? size,
      builtAt: meta.builtAt ?? null,
      name: "JARVIS.exe",
    },
    { headers: { "Cache-Control": "no-store" } },
  );
}
