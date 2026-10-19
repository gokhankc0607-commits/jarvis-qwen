import { readFileSync } from "fs";
import path from "path";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { kanalSettings, strategies } from "@/db/schema";
import { KANAL_DEFAULTS, KANAL_TFS, sanitizeParams, type KanalParams } from "./kanal";
import { parseTfs } from "./tf";

/** KANAL yalnızca M3 / M5 / M15 / H1 zaman dilimlerinde çalışır. */
export function kanalTfs(v: string | string[] | null | undefined): string {
  const list = parseTfs(Array.isArray(v) ? v.join(",") : v ?? "").filter((t) => (KANAL_TFS as readonly string[]).includes(t));
  return list.join(",");
}

/** Otomatik işlem (kullanıcı açarsa): koşullar 5/5 + güven ≥ minConf ise JARVIS SORMADAN işleme girer. */
/** Otomatik işlem + kâr yönetimi (girişe çekme %beAtPct, yarı kâr %partialAtPct'te %partialPct kapat). */
export type AutoCfg = { enabled: boolean; minConf: number; maxPositions: number; beAtPct: number; beAll: boolean; partialAtPct: number; partialPct: number };
export const AUTO_DEFAULTS: AutoCfg = { enabled: false, minConf: 80, maxPositions: 3, beAtPct: 30, beAll: false, partialAtPct: 50, partialPct: 50 };

export function sanitizeAuto(a?: Record<string, unknown> | null): AutoCfg {
  const x = a ?? {};
  const n = (v: unknown, lo: number, hi: number, d: number) => {
    const k = Number(v);
    return v === undefined || v === null || v === "" || !Number.isFinite(k) ? d : Math.min(hi, Math.max(lo, Math.round(k)));
  };
  return {
    enabled: x.enabled === true,
    minConf: n(x.minConf, 50, 99, AUTO_DEFAULTS.minConf),
    maxPositions: n(x.maxPositions, 1, 20, AUTO_DEFAULTS.maxPositions),
    beAtPct: n(x.beAtPct, 0, 95, AUTO_DEFAULTS.beAtPct),
    beAll: x.beAll === true,
    partialAtPct: n(x.partialAtPct, 0, 95, AUTO_DEFAULTS.partialAtPct),
    partialPct: n(x.partialPct, 10, 90, AUTO_DEFAULTS.partialPct),
  };
}

/** Kripto listesi: "btc", "BTC/USDT", "btcusd" -> BTCUSDT (vadeli USDT çiftleri). */
export function sanitizeCryptoSymbols(v: unknown): string[] {
  const arr = Array.isArray(v) ? v : typeof v === "string" ? v.split(/[\s,;]+/) : [];
  const out: string[] = [];
  for (const x of arr) {
    let s = String(x ?? "").toUpperCase().replace(/[^A-Z0-9]/g, "");
    if (!s || s.length > 20) continue;
    if (/USDTP$|PERP$/.test(s)) s = s.replace(/USDTP$|PERP$/, "");
    if (!/USDT$/.test(s)) s = /USD$/.test(s) ? s + "T" : s + "USDT";
    if (s.length >= 5 && !out.includes(s)) out.push(s);
    if (out.length >= 80) break;
  }
  return out;
}

export type ScanMode = "list" | "marketwatch";
export type KanalCfg = {
  enabled: boolean; timeframes: string; scanMode: ScanMode; symbols: string[]; cryptoSymbols: string[];
  scanAll: boolean; // eski ajan uyumluluğu (= scanMode === "marketwatch")
  lot: number; params: KanalParams; auto: AutoCfg;
};

export function sanitizeSymbols(v: unknown): string[] {
  const arr = Array.isArray(v) ? v : typeof v === "string" ? v.split(/[\s,;]+/) : [];
  const out: string[] = [];
  for (const x of arr) {
    const s = String(x ?? "").toUpperCase().trim();
    if (/^[A-Z0-9._#+-]{2,20}$/.test(s) && !out.includes(s)) out.push(s);
    if (out.length >= 80) break;
  }
  return out;
}

type Row = typeof kanalSettings.$inferSelect;
const toCfg = (r: Row): KanalCfg => ({
  enabled: r.enabled,
  timeframes: kanalTfs(r.timeframes) || "M15",
  scanMode: r.scanMode === "marketwatch" ? "marketwatch" : "list",
  symbols: sanitizeSymbols(r.symbols),
  cryptoSymbols: sanitizeCryptoSymbols(r.cryptoSymbols),
  scanAll: r.scanMode === "marketwatch",
  lot: r.lot,
  params: sanitizeParams(r.params),
  auto: sanitizeAuto(r.auto),
});

/** Varsayılan kripto takip listesi (kullanıcının istediği); liste boşsa bir kez doldurulur. */
export const DEFAULT_CRYPTO_SYMBOLS = [
  "BTCUSDT", "ETHUSDT", "BNBUSDT", "SOLUSDT", "XRPUSDT", "AVAXUSDT", "SUIUSDT", "APTUSDT", "LINKUSDT", "FETUSDT", "RENDERUSDT", "TAOUSDT", "GRTUSDT", "NEARUSDT",
];

export async function ensureKanal(userId: number): Promise<KanalCfg> {
  let [r] = await db.select().from(kanalSettings).where(eq(kanalSettings.userId, userId)).limit(1);
  if (!r) {
    await db.insert(kanalSettings).values({ userId, params: KANAL_DEFAULTS as unknown as Record<string, number | string | boolean>, cryptoSymbols: DEFAULT_CRYPTO_SYMBOLS }).onConflictDoNothing();
    [r] = await db.select().from(kanalSettings).where(eq(kanalSettings.userId, userId)).limit(1);
  }
  // Mevcut kullanıcı: kripto listesi hiç doldurulmadıysa varsayılan listeyi bir kez yaz (işaret: params.cryptoSeeded)
  const p = (r.params ?? {}) as Record<string, unknown>;
  if (!p.cryptoSeeded) {
    const cur = sanitizeCryptoSymbols(r.cryptoSymbols);
    const merged = [...cur, ...DEFAULT_CRYPTO_SYMBOLS.filter((s) => !cur.includes(s))];
    await db.update(kanalSettings).set({ cryptoSymbols: merged, params: { ...p, cryptoSeeded: true } as Record<string, number | string | boolean> }).where(eq(kanalSettings.userId, userId));
    [r] = await db.select().from(kanalSettings).where(eq(kanalSettings.userId, userId)).limit(1);
  }
  return toCfg(r);
}

export async function updateKanal(userId: number, body: Record<string, unknown>): Promise<KanalCfg> {
  const cur = await ensureKanal(userId);
  const set: Partial<typeof kanalSettings.$inferInsert> = { updatedAt: new Date() };
  if (body.enabled !== undefined) set.enabled = Boolean(body.enabled);
  if (body.scanMode !== undefined) set.scanMode = body.scanMode === "marketwatch" ? "marketwatch" : "list";
  if (body.symbols !== undefined) set.symbols = sanitizeSymbols(body.symbols);
  if (body.cryptoSymbols !== undefined) set.cryptoSymbols = sanitizeCryptoSymbols(body.cryptoSymbols);
  if (body.lot !== undefined) {
    const l = Number(body.lot);
    if (Number.isFinite(l) && l > 0 && l <= 100) set.lot = l;
  }
  const tfs = Array.isArray(body.timeframes) ? kanalTfs(body.timeframes.map(String)) : typeof body.timeframes === "string" ? kanalTfs(body.timeframes) : "";
  if (tfs) set.timeframes = tfs;
  if (body.params && typeof body.params === "object")
    set.params = { ...(sanitizeParams({ ...cur.params, ...(body.params as Record<string, unknown>) }) as unknown as Record<string, number | string | boolean>), cryptoSeeded: true };
  if (body.auto && typeof body.auto === "object")
    set.auto = sanitizeAuto({ ...cur.auto, ...(body.auto as Record<string, unknown>) }) as unknown as Record<string, number | boolean>;
  await db.update(kanalSettings).set(set).where(eq(kanalSettings.userId, userId));
  return ensureKanal(userId);
}

/* ------------------------------------------------------------------ MQL5 kaynakları */
export const KANAL_SOURCES = [
  { file: "KANAL_Strateji.mq5", name: "KANAL Strateji EA (Band + RSI + CCI)", filePath: "MQL5\\Experts\\Jarvis\\KANAL_Strateji.mq5",
    description: "KANAL 5 aşama: M0 dış bant kapanışı + RSI bölgesi → 0.10 ATR güvenli dönüş → RSI ve CCI/MA sıralı kesişimleri. TTL M3/M5:10, M15:8, H1:6; R:R<1:1 bloke. SL ekstrem, TP merkez. Varsayılan: yalnızca uyarı." },
  { file: "KANAL3BAND.mq5", name: "KANAL3BAND (gösterge)", filePath: "MQL5\\Indicators\\Jarvis\\KANAL3BAND.mq5",
    description: "Centered YSR merkez çizgisi + 3 ATR bant çifti + 3 hareketli ortalama." },
  { file: "KANAL-CCI.mq5", name: "KANAL-CCI (gösterge)", filePath: "MQL5\\Indicators\\Jarvis\\KANAL-CCI.mq5",
    description: "CCI(34) + MA(21) mor çizgi, trend renk değişimi ve alarm." },
  { file: "KANAL-RSI-PANEL.mq5", name: "KANAL-RSI PANEL (gösterge)", filePath: "MQL5\\Indicators\\Jarvis\\KANAL-RSI-PANEL.mq5",
    description: "RSI(14) + M1…D1 çoklu zaman dilimi RSI paneli." },
] as const;

/** Eski (v1) EA'yı tanıyan imza: bunu içeren kayıtlar yeni stratejiyle güncellenir. */
const OLD_EA_MARK = "KANAL3BAND geri dönüş + RSI + CCI";

/** Kullanıcının strateji listesinde KANAL dosyaları yoksa ekler; eski (v1) EA kaydını yeni kuralla günceller. */
export async function ensureKanalStrategies(userId: number) {
  const have = await db
    .select({ id: strategies.id, filePath: strategies.filePath, code: strategies.code, version: strategies.version })
    .from(strategies)
    .where(eq(strategies.userId, userId));
  const paths = new Set(have.map((h) => h.filePath));
  for (const s of KANAL_SOURCES) {
    const ex = have.find((h) => h.filePath === s.filePath);
    if (ex && s.file === "KANAL_Strateji.mq5" && (ex.code.includes(OLD_EA_MARK) || ex.code.includes('#property version   "3.10"') || ex.code.includes('#property version   "3.21"') || ex.code.includes('#property version   "3.22"'))) {
      try {
        const code = readFileSync(path.join(process.cwd(), "public", "agent", "mql5", s.file), "utf8");
        await db
          .update(strategies)
          .set({ code, version: ex.version + 1, status: "draft", description: s.description, updatedAt: new Date() })
          .where(eq(strategies.id, ex.id));
      } catch {}
      continue;
    }
    if (paths.has(s.filePath)) continue;
    let code = "";
    try {
      code = readFileSync(path.join(process.cwd(), "public", "agent", "mql5", s.file), "utf8");
    } catch {
      continue;
    }
    await db.insert(strategies).values({ userId, name: s.name, filePath: s.filePath, description: s.description, code, version: 1, status: "draft" });
  }
}
