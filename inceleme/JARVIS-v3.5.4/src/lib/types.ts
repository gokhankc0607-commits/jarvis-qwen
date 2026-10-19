export type Signal = {
  id: number; symbol: string; side: "BUY" | "SELL"; timeframe: string; price: number; sl: number | null; tp: number | null;
  volume: number; reason: string; indicators: Record<string, number | string | boolean>; confidence: number;
  status: string; note: string; source?: string; market?: string; createdAt: string; decidedAt: string | null;
};
export type Trade = {
  id: number; ticket: string; symbol: string; side: "BUY" | "SELL"; volume: number; openPrice: number; currentPrice: number;
  sl: number | null; tp: number | null; pnl: number; status: string; source: string; comment: string; openedAt: string; closedAt: string | null;
  timeframe?: string;
  market?: string;
};
export type Strategy = {
  id: number; name: string; filePath: string; description: string; code: string; version: number; status: string;
  lastCompiledAt: string | null; createdAt: string; updatedAt: string;
};
export type CompileJob = {
  id: number; strategyId: number; status: string; attempt: number; maxAttempts: number; autoFix: boolean; errors: number;
  warnings: number; log: string; source: string; createdAt: string; finishedAt: string | null; strategyName?: string | null;
};
export type Rule = {
  id: number; symbol: string; timeframe: string; rsiPeriod: number; rsiOverbought: number; rsiOversold: number; cciPeriod: number;
  cciLevel: number; stochEnabled: boolean; useDivergence: boolean; lotSize: number; slPips: number; tpPips: number; enabled: boolean;
};
export type ProviderT = {
  id: number; name: string; kind: string; baseUrl: string; model: string; apiKey: string; isLocal: boolean; isActive: boolean;
};
export type Msg = { id: number; role: string; content: string; createdAt: string };
export type Account = {
  connected: boolean; server: string; login: string; balance: number; equity: number; margin: number; freeMargin: number;
  currency: string; leverage: number; agentLastSeen: string | null;
};
export type StateT = {
  account: Account; agentOnline: boolean; mode: "live" | "demo"; openTrades: Trade[]; pendingSignals: Signal[]; recentSignals: Signal[];
  jobs: { id: number; status: string; errors: number; warnings: number; attempt: number; log: string; createdAt: string; strategyName: string | null }[];
  watching: { symbol: string; timeframe: string }[];
  provider: { name: string; model: string; isLocal: boolean } | null;
  ping: number | null;
  agent: {
    online: boolean; version: string | null; latest: string; outdated: boolean; algo: boolean; tradeAllowed: boolean; build: number;
    feedErrors: [string, string][]; feedOk: number; tickAge: number | null; ticks: number;
  };
  failedSignals: { id: number; symbol: string; side: string; note: string; createdAt: string }[];
  telegram?: { enabled: boolean; quiet: boolean };
  crypto?: {
    enabled: boolean; exchange: string; demo: boolean; leverage: number; orderUsdt: number; connected: boolean; label: string;
    account: { connected?: boolean; server?: string; balance?: number; equity?: number; freeMargin?: number; currency?: string; leverage?: number } | null;
  };
  perf: { weekPnl: number; monthPnl: number; yearPnl: number; week: number; month: number; year: number; winRate: number; closed: number };
};

export type QuoteT = {
  symbol: string; market: "forex" | "crypto"; category: "forex" | "crypto" | "metals" | "indices" | "commodities" | "stocks"; enabled: boolean; tfs: string[];
  price: number | null; change: number; changePct: number; spark: number[]; bid: number | null; ask: number | null; stale: number; tickAge: number | null; minDist: number | null; digits: number | null; rsi: number | null; cci: number | null;
  signal: "BUY" | "SELL" | null; tags: string[];
};
export type RadarRowT = {
  symbol: string; market?: "forex" | "crypto"; tf: string; price: number | null; rsi: number | null; cci: number | null; signal: "BUY" | "SELL" | null;
  strength: number; tags: string[]; rsiZone: "os" | "ob" | null; cciZone: "os" | "ob" | null; cfg: { os: number; ob: number; cci: number };
};
import type { KanalItem, KanalParams } from "./kanal";
export type KanalRowT = KanalItem & { market: "forex" | "crypto" };
export type MarketT = { live: boolean; quotes: QuoteT[]; radar: RadarRowT[]; kanal: KanalRowT[]; kanalParams: KanalParams; tf: string | null };
