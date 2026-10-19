import { readdir } from "fs/promises";
import path from "path";

export const AGENT_ROOT = path.join(process.cwd(), "public", "agent");
/** Otomatik güncellenebilen dosyalar: kaynak kod, MQL5, gereksinimler. (.bat/.exe/config.json ASLA dokunulmaz) */
const OK = /^(?:[\w-]+\.py|mql5\/[\w.-]+\.mq5|requirements(?:-voice)?\.txt|config\.example\.json|README\.md)$/;

export async function listAgentFiles(dir = AGENT_ROOT, base = ""): Promise<string[]> {
  const out: string[] = [];
  for (const d of await readdir(dir, { withFileTypes: true })) {
    if (d.name.startsWith(".") || d.name === "__pycache__") continue;
    const rel = base ? `${base}/${d.name}` : d.name;
    if (d.isDirectory()) out.push(...(await listAgentFiles(path.join(dir, d.name), rel)));
    else if (OK.test(rel)) out.push(rel);
  }
  return out;
}
