import { createHash } from "crypto";
import { readFile } from "fs/promises";
import path from "path";
import { userFromAgentKey } from "@/lib/auth";
import { AGENT_ROOT, listAgentFiles } from "@/lib/agentFiles";
import { LATEST_AGENT } from "@/lib/version";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const u = await userFromAgentKey(req.headers.get("x-agent-key"));
  if (!u) return Response.json({ error: "Geçersiz ajan anahtarı" }, { status: 401 });
  const names = await listAgentFiles();
  const files = await Promise.all(
    names.map(async (name) => {
      const buf = await readFile(path.join(AGENT_ROOT, name));
      return { name, size: buf.length, sha256: createHash("sha256").update(buf).digest("hex") };
    })
  );
  return Response.json({ version: LATEST_AGENT, files });
}
