/** Brokerlar aynı enstrümana farklı ad verir. İlk ad paneldeki standart addır. (Python: mt5_engine.SYMBOL_GROUPS ile aynı) */
export const SYMBOL_GROUPS: string[][] = [
  ["US100", "NAS100", "USTEC", "NDX100", "NQ100", "NASDAQ100", "NASDAQ", "USTECH", "US100CASH", "NAS100CASH", "NDX"],
  ["US30", "DJ30", "DOW30", "WS30", "DJI30", "DOWJONES", "US30CASH", "DJ30CASH", "DJI", "DOW"],
  ["US500", "SPX500", "SP500", "US500CASH", "SPX"],
  ["GER40", "DE40", "DAX40", "GER30", "DE30", "DAX", "GERMANY40", "GER40CASH"],
  ["UK100", "FTSE100", "UK100CASH", "FTSE"],
  ["JP225", "JPN225", "NIKKEI225", "NIK225", "JAPAN225"],
  ["FRA40", "CAC40", "FRANCE40"],
  ["EU50", "EUSTX50", "STOXX50", "ESTX50"],
  ["AUS200", "ASX200", "AU200"],
  ["HK50", "HSI50", "HONGKONG50"],
  ["XAUUSD", "GOLD", "GOLDUSD"],
  ["XAGUSD", "SILVER"],
  ["USOIL", "WTI", "XTIUSD", "USOUSD", "OILUSD", "CRUDEOIL"],
  ["UKOIL", "BRENT", "XBRUSD", "UKOUSD"],
  ["BTCUSD", "BITCOIN", "BTCUSDT", "XBTUSD"],
  ["ETHUSD", "ETHEREUM", "ETHUSDT"],
];

export const CURRENCIES = new Set(["EUR", "USD", "GBP", "JPY", "CHF", "AUD", "NZD", "CAD", "TRY", "SEK", "NOK", "DKK", "ZAR", "MXN", "PLN", "HKD", "SGD", "CNH", "HUF", "CZK"]);

export const normSym = (s: string) => s.toUpperCase().replace(/[^A-Z0-9]/g, "");

/** Standart ad: NAS100.cash -> US100, EURUSDm -> EURUSD, GOLD -> XAUUSD */
/** Kripto adı: BTCUSD / BTC/USDT / BTCUSDT.P -> BTCUSDT */
export function cryptoCanon(s: string): string {
  const n = normSym(s).replace(/USDTP$|PERP$/, "");
  if (/USDT$/.test(n)) return n;
  if (/USD$/.test(n)) return n + "T";
  return n + "USDT";
}

export function canonSymbol(s: string): string {
  const n = normSym(s);
  for (const g of SYMBOL_GROUPS)
    for (const a of g) {
      const an = normSym(a);
      if (n === an || (an.length >= 4 && n.startsWith(an) && n.length - an.length <= 5)) return g[0];
    }
  if (n.length >= 6 && CURRENCIES.has(n.slice(0, 3)) && CURRENCIES.has(n.slice(3, 6))) return n.slice(0, 6);
  return n;
}

export const sameSymbol = (a: string, b: string) => canonSymbol(a) === canonSymbol(b);
