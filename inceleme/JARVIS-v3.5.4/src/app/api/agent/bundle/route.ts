import { headers } from "next/headers";
import { readdir, readFile } from "fs/promises";
import path from "path";
import { withUser } from "@/lib/api";
import { buildConfig, dashboardUrl } from "@/lib/agentConfig";
import { makeZip, type ZipEntry } from "@/lib/zip";

export const dynamic = "force-dynamic";

async function walk(dir: string, base = ""): Promise<ZipEntry[]> {
  const out: ZipEntry[] = [];
  for (const d of await readdir(dir, { withFileTypes: true })) {
    if (d.name === "__pycache__" || d.name.startsWith(".")) continue;
    const full = path.join(dir, d.name);
    const rel = base ? `${base}/${d.name}` : d.name;
    if (d.isDirectory()) out.push(...(await walk(full, rel)));
    else out.push({ name: rel, data: new Uint8Array(await readFile(full)) });
  }
  return out;
}

/** ?mode=update -> config.json OLMADAN güncelleme paketi (mevcut ayarları ezmez). */
export async function GET(req: Request) {
  return withUser(async (u) => {
    const update = new URL(req.url).searchParams.get("mode") === "update";
    const dir = path.join(process.cwd(), "public", "agent");
    const files = (await walk(dir)).map((f) => ({ ...f, name: `JARVIS-Agent/${f.name}` }));
    if (!update) {
      const cfg = await buildConfig(dashboardUrl(await headers()), u.agentKey);
      files.push({ name: "JARVIS-Agent/config.json", data: new TextEncoder().encode(cfg) });
    }
    const wf = files.find((f) => f.name.endsWith("ci/build-agent.yml"));
    if (wf) files.push({ name: "JARVIS-Agent/.github/workflows/build-agent.yml", data: wf.data });
    const zip = makeZip(files);
    return new Response(new Uint8Array(zip), {
      headers: {
        "Content-Type": "application/zip",
        "Content-Disposition": `attachment; filename="${update ? "JARVIS-Agent-GUNCELLEME" : "JARVIS-Agent"}.zip"`,
        "Content-Length": String(zip.length),
      },
    });
  });
}
