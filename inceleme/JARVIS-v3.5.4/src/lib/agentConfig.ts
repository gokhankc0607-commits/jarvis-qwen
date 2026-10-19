import { readFile } from "fs/promises";
import path from "path";

export function dashboardUrl(h: Headers) {
  const host = h.get("x-forwarded-host") ?? h.get("host") ?? "localhost:3000";
  const proto = h.get("x-forwarded-proto") ?? (host.startsWith("localhost") || host.startsWith("127.") ? "http" : "https");
  return `${proto}://${host}`;
}

export async function buildConfig(url: string, agentKey: string) {
  const raw = await readFile(path.join(process.cwd(), "public", "agent", "config.example.json"), "utf8");
  const cfg = JSON.parse(raw);
  cfg.dashboard_url = url;
  cfg.agent_key = agentKey;
  return JSON.stringify(cfg, null, 2);
}
