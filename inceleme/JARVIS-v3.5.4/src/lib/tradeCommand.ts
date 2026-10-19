import { CURRENCIES, SYMBOL_GROUPS, canonSymbol, normSym, sameSymbol } from "./symbols";

/**
 * Türkçe / İngilizce serbest metinden işlem komutu çözer (sohbet + sesli).
 * Örnekler:
 *   "EURUSD 0.1 lot al sl 30 tp 60"   "altın sat"   "buy gir"   "nas100 alış sl 4150"
 *   "SL'yi girişe çek"   "xauusd stop 4150 yap"   "tp 60 pip"   "sl kaldır"   "hepsinin sl girişe çek"
 *   "NAS100 kapat"   "hepsini kapat"   "buy işlemlerini kapat"
 */
export type Level = { v: number; unit: "pip" | "price" | "auto" };
export type Market = "forex" | "crypto";
export type TradeCmd =
  | { kind: "open"; symbol: string | null; side: "BUY" | "SELL"; volume: number | null; sl: Level | null; tp: Level | null; market: Market | null }
  | { kind: "modify"; symbol: string | null; all: boolean; be: boolean; sl: Level | "remove" | null; tp: Level | "remove" | null; side: "BUY" | "SELL" | null }
  | { kind: "close"; symbol: string | null; all: boolean; side: "BUY" | "SELL" | null; fraction?: number };

const FOLD: Record<string, string> = { ç: "c", ğ: "g", ı: "i", ö: "o", ş: "s", ü: "u", â: "a", î: "i", û: "u" };

export function foldTr(s: string) {
  return s
    .toLocaleLowerCase("tr-TR")
    .replace(/[çğıöşüâîû]/g, (c) => FOLD[c] ?? c)
    .replace(/(\d),(\d)/g, "$1.$2") // 0,1 -> 0.1
    .replace(/['’`´]/g, " ") // sl'yi -> sl yi
    .replace(/[^a-z0-9.+\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

const WORD_SYMBOL: Record<string, string> = {
  altin: "XAUUSD", gold: "XAUUSD", ons: "XAUUSD", gumus: "XAGUSD", silver: "XAGUSD",
  btcusdt: "BTCUSDT", ethusdt: "ETHUSDT", solana: "SOLUSDT", sol: "SOLUSDT", xrp: "XRPUSDT", ripple: "XRPUSDT", bnb: "BNBUSDT", doge: "DOGEUSDT", dogecoin: "DOGEUSDT", ada: "ADAUSDT", avax: "AVAXUSDT", link: "LINKUSDT",
  nasdaq: "US100", nas: "US100", dow: "US30", dowjones: "US30", dax: "GER40", sp500: "US500", spx: "US500",
  bitcoin: "BTCUSD", btc: "BTCUSD", ethereum: "ETHUSD", eth: "ETHUSD", petrol: "UKOIL", brent: "UKOIL", wti: "USOIL",
};
const WORD_CCY: Record<string, string> = { euro: "EUR", avro: "EUR", dolar: "USD", dollar: "USD", sterlin: "GBP", paund: "GBP", pound: "GBP", yen: "JPY", frank: "CHF", kanada: "CAD", avustralya: "AUD" };

/** Metindeki sembolü bulur. known: kullanıcının izleme / pozisyon / Piyasa Gözlemi sembolleri (tercih edilen adlar). */
export function findSymbol(tokens: string[], known: string[]): string | null {
  const toKnown = (c: string) => known.find((k) => sameSymbol(k, c)) ?? c;
  // 1) bilinen semboller (broker adıyla birebir: nas100, eurusd.m ...)
  for (const t of tokens) {
    const n = normSym(t);
    if (n.length < 3) continue;
    const k = known.find((x) => normSym(x) === n);
    if (k) return k;
  }
  // 2) takma ad grupları + 6 harfli döviz çiftleri
  for (const t of tokens) {
    const n = normSym(t);
    if (n.length < 4 || /^\d+$/.test(n)) continue;
    if (SYMBOL_GROUPS.some((g) => g.some((a) => normSym(a) === n)) || (n.length >= 6 && CURRENCIES.has(n.slice(0, 3)) && CURRENCIES.has(n.slice(3, 6))))
      return toKnown(canonSymbol(n));
  }
  // 3) kelimeler: altın, nasdaq, "euro dolar" ...
  for (let i = 0; i < tokens.length; i++) {
    const w = tokens[i];
    if (WORD_SYMBOL[w]) return toKnown(WORD_SYMBOL[w]);
    const a = WORD_CCY[w] ?? (CURRENCIES.has(w.toUpperCase()) && w.length === 3 ? w.toUpperCase() : null);
    const b = tokens[i + 1] ? WORD_CCY[tokens[i + 1]] ?? (CURRENCIES.has(tokens[i + 1].toUpperCase()) && tokens[i + 1].length === 3 ? tokens[i + 1].toUpperCase() : null) : null;
    if (a && b && a !== b) return toKnown(a + b);
    if (w === "eurodolar") return toKnown("EURUSD");
  }
  return null;
}

const isBuy = (t: string) => t === "buy" || t === "long" || t === "al" || t === "alalim" || t.startsWith("alis") || t.startsWith("alim");
const isSell = (t: string) => t === "sell" || t === "short" || t === "sat" || t === "satalim" || t.startsWith("satis") || t.startsWith("satim");
const isClose = (t: string) => t.startsWith("kapat") || t === "kapa" || t === "close" || t === "cik" || t === "cikalim";
const isAll = (t: string) => t.startsWith("hepsi") || t.startsWith("tum") || t.startsWith("butun") || t === "all";
const isBe = (t: string) => t.startsWith("giris") || t.startsWith("basabas") || t === "breakeven" || t === "be" || t.startsWith("maliyet");

function level(num: string, unit?: string): Level {
  const v = Number(num);
  if (unit && /^(pip|pips|puan|point|nokta)$/.test(unit)) return { v, unit: "pip" };
  return { v, unit: "auto" };
}

export function parseTradeCommand(raw: string, known: string[] = []): TradeCmd | null {
  let t = foldTr(raw);
  if (!t) return null;
  // kalıpları sadeleştir
  t = t
    .replace(/\bstop ?loss\b|\bzarar ?durdur\w*\b|\bstoplos\w*\b|\bstop\w*\b/g, " sl ")
    .replace(/\btake ?profit\b|\bkar ?al\w*\b|\bkari ?al\w*\b|\bhedef\w*\b|\btakeprofit\b/g, " tp ")
    .replace(/\b(sl|tp)(yi|i|u|ni|ini|y|leri|lerin|ler|ini|in|si|sini)\b/g, " $1 ")
    .replace(/\s+/g, " ")
    .trim();
  const tokens = t.split(" ");

  // "yarısını kapat", "yarı kâr al", "%50 kapat", "yarım kapat"
  const half = /\byari(m|si|sini|yi|ya)?\b/.test(t) || /\byuzde ?50\b/.test(t) || /%\s?50\b/.test(raw);
  const halfIntent = half && (/\bkapat\w*|\bkapa\b|\bcik\w*|\bkar\w*\b|\bkari\b|\bal\b|\btp\b|\bclose\b/.test(t));
  if (halfIntent) {
    const sideH: "BUY" | "SELL" | null = /\b(buy|alis\w*|long)\b/.test(t) ? "BUY" : /\b(sell|satis\w*|short)\b/.test(t) ? "SELL" : null;
    const symH = findSymbol(tokens.filter((x) => !["sl", "tp", "lot", "pip", "al", "sat", "buy", "sell", "kar", "kari", "yari", "yarisini", "yarim"].includes(x)), known);
    return { kind: "close", symbol: symH, all: tokens.some(isAll), side: sideH, fraction: 0.5 };
  }

  // piyasa: "kripto" / "forex" (MT5) açıkça söylendiyse
  const market: Market | null = /\b(kripto|crypto|kriptodan|kriptoda|binance|borsa|borsadan|vadeli|futures)\b/.test(t) ? "crypto"
    : /\b(forex|forexten|forexte|mt5|mt5ten|metatrader|broker|brokerdan)\b/.test(t) ? "forex" : null;
  const buy = tokens.some(isBuy);
  const sell = tokens.some(isSell);
  const side: "BUY" | "SELL" | null = buy && !sell ? "BUY" : sell && !buy ? "SELL" : null;
  const close = tokens.some(isClose);
  const all = tokens.some(isAll);
  const hasSl = tokens.includes("sl");
  const hasTp = tokens.includes("tp");
  const be = tokens.some(isBe) && (hasSl || tokens.some((x) => x.startsWith("cek") || x.startsWith("tasi") || x.startsWith("al")) || tokens.length <= 3);

  const symbol = findSymbol(tokens.filter((x) => !["sl", "tp", "lot", "pip", "al", "sat", "buy", "sell", "kripto", "crypto", "forex", "mt5", "binance", "vadeli"].includes(x)), known);

  // SL / TP değerleri
  const grab = (key: "sl" | "tp"): Level | "remove" | null => {
    const m = t.match(new RegExp(`\\b${key}\\b(?:\\s+(?:seviyesi\\w*|degeri\\w*|olarak|fiyat\\w*|mesafe\\w*))?\\s+(\\d+(?:\\.\\d+)?)\\s*(pip|pips|puan|point|nokta)?`));
    if (m) return level(m[1], m[2]);
    const m2 = t.match(new RegExp(`(\\d+(?:\\.\\d+)?)\\s*(pip|pips|puan|point|nokta)?\\s+${key}\\b`));
    if (m2) return level(m2[1], m2[2]);
    if (new RegExp(`\\b${key}\\b\\s+(kaldir\\w*|sil\\w*|iptal\\w*|yok\\w*|kapat\\w*|0)\\b`).test(t)) return "remove";
    return null;
  };
  const sl = hasSl ? grab("sl") : null;
  const tp = hasTp ? grab("tp") : null;
  const volM = t.match(/(\d+(?:\.\d+)?)\s*lot/) ?? t.match(/\blot\w*\s+(\d+(?:\.\d+)?)/);
  const volume = volM ? Number(volM[1]) : null;

  // "sl kaldır" içindeki "kapat" kapatma sayılmasın
  const closeIntent = close && !/\b(sl|tp)\b\s+kapat/.test(t);

  if (closeIntent && !hasSl && !hasTp) return { kind: "close", symbol, all, side };
  if (be || ((hasSl || hasTp) && !side) || ((hasSl || hasTp) && side && all)) {
    if (be || sl || tp) return { kind: "modify", symbol, all, be, sl: be && !(sl && sl !== "remove") ? null : sl, tp, side: all ? side : null };
  }
  if (side && !closeIntent) {
    return { kind: "open", symbol, side, volume, sl: sl && sl !== "remove" ? sl : null, tp: tp && tp !== "remove" ? tp : null, market };
  }
  return null;
}

/** İşlemle ilgili gibi görünen ama çözülemeyen metin (LLM'e gitmesin; yardım gösterilsin). */
export function looksLikeTrade(raw: string) {
  const t = foldTr(raw);
  return /\b(sl|tp|stop|lot|buy|sell|long|short|kapat\w*|al|sat|alis\w*|satis\w*|emir\w*|islem\w*\s+(ac|gir)\w*|gir)\b/.test(t);
}

export const TRADE_HELP =
  "Komutu anlayamadım efendim. Örnekler: “EURUSD 0.1 lot al sl 30 tp 60”, “btc kripto al”, “altın forex sat”, “SL girişe çek”, “tp 80 pip”, “yarısını kapat”, “NAS100 kapat”, “hepsini kapat”.";
