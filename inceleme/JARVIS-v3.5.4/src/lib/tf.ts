export const TFS = ["M1", "M3", "M5", "M15", "M30", "H1", "H4", "D1"] as const;
export const TF_MIN: Record<string, number> = { M1: 1, M3: 3, M5: 5, M15: 15, M30: 30, H1: 60, H4: 240, D1: 1440 };

/** "M15,H1" -> ["M15","H1"] (geçersizleri atar, küçükten büyüğe sıralar) */
export function parseTfs(s: string | null | undefined): string[] {
  const list = String(s ?? "")
    .split(",")
    .map((x) => x.trim().toUpperCase())
    .filter((x) => x in TF_MIN);
  return [...new Set(list)].sort((a, b) => TF_MIN[a] - TF_MIN[b]);
}

export function joinTfs(a: string[]): string {
  return parseTfs(a.join(",")).join(",");
}

export type Category = "forex" | "crypto" | "metals" | "indices" | "commodities" | "stocks";

export function categoryOf(symbol: string): Category {
  const s = symbol.toUpperCase();
  if (/^(BTC|ETH|LTC|XRP|SOL|DOGE|ADA|BNB|DOT|AVAX)/.test(s)) return "crypto";
  if (/^(X(AU|AG|PT|PD)|GOLD|SILVER)/.test(s)) return "metals";
  if (/^(US30|US100|US500|USTEC|NAS|SPX|SP500|GER|DE40|DE30|DAX|UK100|FTSE|JP225|JPN225|FRA40|EU50|DJ|DOW|WS30|NDX|AUS200|HK50)/.test(s)) return "indices";
  if (/^(USOIL|UKOIL|WTI|BRENT|NGAS|XTI|XBR|XNG|COPPER|OIL)/.test(s)) return "commodities";
  if (/^(AAPL|TSLA|MSFT|NVDA|AMZN|GOOG|META|NFLX|AMD)/.test(s)) return "stocks";
  return "forex";
}

export const CATEGORY_TABS: { key: Category; label: string }[] = [
  { key: "forex", label: "Forex" },
  { key: "crypto", label: "Crypto" },
  { key: "metals", label: "XAUUSD" },
  { key: "indices", label: "Indices" },
  { key: "commodities", label: "Commodities" },
  { key: "stocks", label: "Stocks" },
];
