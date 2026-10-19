import { watchRules } from "@/db/schema";
import { joinTfs, parseTfs } from "./tf";

type RuleInsert = Partial<typeof watchRules.$inferInsert>;

export function ruleFields(b: Record<string, unknown>): RuleInsert {
  const f: RuleInsert = {};
  const n = (k: string) => (b[k] !== undefined && b[k] !== "" && Number.isFinite(Number(b[k])) ? Number(b[k]) : undefined);
  if (b.symbol !== undefined) f.symbol = String(b.symbol).toUpperCase().trim();
  // Tek pariteye birden fazla zaman dilimi: "M15,H1,H4"
  if (Array.isArray(b.timeframes)) {
    const j = joinTfs(b.timeframes.map(String));
    if (j) f.timeframe = j;
  } else if (b.timeframe !== undefined) {
    const j = joinTfs([String(b.timeframe)]) || joinTfs(String(b.timeframe).split(","));
    if (j) f.timeframe = j;
  }
  const ints = ["rsiPeriod", "cciPeriod"] as const;
  for (const k of ints) { const v = n(k); if (v !== undefined) f[k] = Math.round(v); }
  const floats = ["rsiOverbought", "rsiOversold", "cciLevel", "lotSize", "slPips", "tpPips"] as const;
  for (const k of floats) { const v = n(k); if (v !== undefined) f[k] = v; }
  const bools = ["stochEnabled", "useDivergence", "enabled"] as const;
  for (const k of bools) if (b[k] !== undefined) f[k] = Boolean(b[k]);
  return f;
}

/** Ajan için: her kuralı zaman dilimi başına ayrı kurala böler. */
export function expandRules<T extends { timeframe: string }>(rules: T[]): T[] {
  return rules.flatMap((r) => {
    const tfs = parseTfs(r.timeframe);
    return (tfs.length ? tfs : ["H1"]).map((tf) => ({ ...r, timeframe: tf }));
  });
}
