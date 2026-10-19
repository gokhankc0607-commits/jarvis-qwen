/** Sürümler. Ajan sürümü public/agent/app.py içindeki AGENT_VERSION ile aynı olmalıdır. */
export const PANEL_VERSION = "3.5.4";
export const LATEST_AGENT = "3.5.4";

export function cmpVersion(a: string, b: string) {
  const pa = a.split(".").map(Number), pb = b.split(".").map(Number);
  for (let i = 0; i < 3; i++) {
    const d = (pa[i] || 0) - (pb[i] || 0);
    if (d) return d;
  }
  return 0;
}
export const isOutdated = (v?: string | null) => !!v && cmpVersion(v, LATEST_AGENT) < 0;
