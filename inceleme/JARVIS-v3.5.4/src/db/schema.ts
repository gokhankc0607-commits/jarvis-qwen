import {
  pgTable,
  serial,
  text,
  integer,
  boolean,
  timestamp,
  doublePrecision,
  jsonb,
} from "drizzle-orm/pg-core";

export const users = pgTable("users", {
  id: serial("id").primaryKey(),
  email: text("email").notNull().unique(),
  name: text("name").notNull(),
  passwordHash: text("password_hash").notNull(),
  agentKey: text("agent_key").notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const sessions = pgTable("sessions", {
  id: text("id").primaryKey(),
  userId: integer("user_id").notNull(),
  expiresAt: timestamp("expires_at").notNull(),
});

export const accountState = pgTable("account_state", {
  userId: integer("user_id").primaryKey(),
  connected: boolean("connected").default(false).notNull(),
  server: text("server").default("").notNull(),
  login: text("login").default("").notNull(),
  balance: doublePrecision("balance").default(0).notNull(),
  equity: doublePrecision("equity").default(0).notNull(),
  margin: doublePrecision("margin").default(0).notNull(),
  freeMargin: doublePrecision("free_margin").default(0).notNull(),
  currency: text("currency").default("USD").notNull(),
  leverage: integer("leverage").default(100).notNull(),
  agentLastSeen: timestamp("agent_last_seen"),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

export const strategies = pgTable("strategies", {
  id: serial("id").primaryKey(),
  userId: integer("user_id").notNull(),
  name: text("name").notNull(),
  filePath: text("file_path").notNull(),
  description: text("description").default("").notNull(),
  code: text("code").notNull(),
  version: integer("version").default(1).notNull(),
  status: text("status").default("draft").notNull(), // draft|queued|compiling|compiled|error
  lastCompiledAt: timestamp("last_compiled_at"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

export const compileJobs = pgTable("compile_jobs", {
  id: serial("id").primaryKey(),
  userId: integer("user_id").notNull(),
  strategyId: integer("strategy_id").notNull(),
  status: text("status").default("queued").notNull(), // queued|running|success|failed
  attempt: integer("attempt").default(1).notNull(),
  maxAttempts: integer("max_attempts").default(5).notNull(),
  autoFix: boolean("auto_fix").default(true).notNull(),
  errors: integer("errors").default(0).notNull(),
  warnings: integer("warnings").default(0).notNull(),
  log: text("log").default("").notNull(),
  source: text("source").default("demo").notNull(), // demo|agent
  createdAt: timestamp("created_at").defaultNow().notNull(),
  finishedAt: timestamp("finished_at"),
});

export const signals = pgTable("signals", {
  id: serial("id").primaryKey(),
  userId: integer("user_id").notNull(),
  symbol: text("symbol").notNull(),
  side: text("side").notNull(), // BUY|SELL
  timeframe: text("timeframe").default("H1").notNull(),
  price: doublePrecision("price").notNull(),
  sl: doublePrecision("sl"),
  tp: doublePrecision("tp"),
  volume: doublePrecision("volume").default(0.1).notNull(),
  reason: text("reason").default("").notNull(),
  indicators: jsonb("indicators").$type<Record<string, number | string | boolean>>().default({}).notNull(),
  confidence: integer("confidence").default(50).notNull(),
  status: text("status").default("pending").notNull(), // pending|approved|rejected|executed|failed|expired
  note: text("note").default("").notNull(),
  source: text("source").default("agent").notNull(), // agent (gerçek tarama) | manual (panelden) | demo (örnek/test — asla MT5'e gitmez)
  market: text("market").default("forex").notNull(), // forex (MT5) | crypto (borsa)
  createdAt: timestamp("created_at").defaultNow().notNull(),
  decidedAt: timestamp("decided_at"),
});

export const trades = pgTable("trades", {
  id: serial("id").primaryKey(),
  userId: integer("user_id").notNull(),
  ticket: text("ticket").notNull(),
  symbol: text("symbol").notNull(),
  side: text("side").notNull(),
  volume: doublePrecision("volume").notNull(),
  openPrice: doublePrecision("open_price").notNull(),
  currentPrice: doublePrecision("current_price").notNull(),
  sl: doublePrecision("sl"),
  tp: doublePrecision("tp"),
  pnl: doublePrecision("pnl").default(0).notNull(),
  status: text("status").default("open").notNull(), // open|closing|closed
  source: text("source").default("demo").notNull(),
  timeframe: text("timeframe").default("").notNull(), // işlemin açıldığı zaman dilimi (M3/M5/M15/H1…, MAN = elle)
  market: text("market").default("forex").notNull(), // forex | crypto
  comment: text("comment").default("").notNull(),
  openedAt: timestamp("opened_at").defaultNow().notNull(),
  closedAt: timestamp("closed_at"),
});

export const watchRules = pgTable("watch_rules", {
  id: serial("id").primaryKey(),
  userId: integer("user_id").notNull(),
  symbol: text("symbol").notNull(),
  timeframe: text("timeframe").default("H1").notNull(),
  rsiPeriod: integer("rsi_period").default(14).notNull(),
  rsiOverbought: doublePrecision("rsi_overbought").default(70).notNull(),
  rsiOversold: doublePrecision("rsi_oversold").default(30).notNull(),
  cciPeriod: integer("cci_period").default(20).notNull(),
  cciLevel: doublePrecision("cci_level").default(100).notNull(),
  stochEnabled: boolean("stoch_enabled").default(true).notNull(),
  useDivergence: boolean("use_divergence").default(true).notNull(),
  lotSize: doublePrecision("lot_size").default(0.1).notNull(),
  slPips: doublePrecision("sl_pips").default(30).notNull(),
  tpPips: doublePrecision("tp_pips").default(60).notNull(),
  enabled: boolean("enabled").default(true).notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const aiProviders = pgTable("ai_providers", {
  id: serial("id").primaryKey(),
  userId: integer("user_id").notNull(),
  name: text("name").notNull(),
  kind: text("kind").notNull(), // ollama|openai_compat|anthropic|gemini
  baseUrl: text("base_url").notNull(),
  model: text("model").notNull(),
  apiKey: text("api_key").default("").notNull(),
  isLocal: boolean("is_local").default(true).notNull(),
  isActive: boolean("is_active").default(false).notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const messages = pgTable("messages", {
  id: serial("id").primaryKey(),
  userId: integer("user_id").notNull(),
  role: text("role").notNull(), // user|assistant|system
  content: text("content").notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

/** KANAL stratejisi ayarları (KANAL3BAND geri dönüş + RSI + CCI MA kesişimi) */
export const kanalSettings = pgTable("kanal_settings", {
  userId: integer("user_id").primaryKey(),
  enabled: boolean("enabled").default(true).notNull(),
  timeframes: text("timeframes").default("M15,H1").notNull(),
  scanAll: boolean("scan_all").default(true).notNull(), // (eski) Piyasa Gözlemi'ndeki tüm pariteler
  scanMode: text("scan_mode").default("list").notNull(), // list = takip listem · marketwatch = Piyasa Gözlemi'nin tamamı
  symbols: jsonb("symbols").$type<string[]>().default([]).notNull(), // takip listesi (forex / MT5)
  cryptoSymbols: jsonb("crypto_symbols").$type<string[]>().default([]).notNull(), // kripto takip listesi
  lot: doublePrecision("lot").default(0.1).notNull(),
  params: jsonb("params").$type<Record<string, number | string | boolean>>().default({}).notNull(),
  /** Otomatik işlem: { enabled, minConf, maxPositions, beAtPct, beAll } */
  auto: jsonb("auto").$type<Record<string, number | boolean>>().default({}).notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

/** MT5'e gidecek pozisyon komutları (SL/TP değiştir, kapat) — ajan uygular ve sonucu bildirir. */
export const tradeCommands = pgTable("trade_commands", {
  id: serial("id").primaryKey(),
  userId: integer("user_id").notNull(),
  ticket: text("ticket").notNull(),
  symbol: text("symbol").notNull(),
  type: text("type").notNull(), // modify | close | partial
  fraction: doublePrecision("fraction"), // partial: kapatılacak oran (0.5 = yarısı)
  market: text("market").default("forex").notNull(),
  sl: doublePrecision("sl"), // null = değiştirme, 0 = kaldır
  tp: doublePrecision("tp"),
  status: text("status").default("queued").notNull(), // queued | sent | done | failed
  note: text("note").default("").notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  doneAt: timestamp("done_at"),
});

/** Telegram bot bildirim ayarları (sinyal / otomatik işlem / kâr yönetimi / hata). */
export const telegramSettings = pgTable("telegram_settings", {
  userId: integer("user_id").primaryKey(),
  enabled: boolean("enabled").default(false).notNull(),
  botToken: text("bot_token").default("").notNull(),
  chatId: text("chat_id").default("").notNull(),
  onSignal: boolean("on_signal").default(true).notNull(),   // KANAL sinyali (onay bekleyen)
  onAuto: boolean("on_auto").default(true).notNull(),       // otomatik açılan işlem
  onProfit: boolean("on_profit").default(true).notNull(),   // SL girişe çekme / yarı kâr
  onError: boolean("on_error").default(true).notNull(),     // emir reddi / hata
  minConf: integer("min_conf").default(70).notNull(),       // sinyal bildirimi için alt güven eşiği
  quietUntil: timestamp("quiet_until"),                     // bu saate kadar bildirim gönderme
  buttons: boolean("buttons").default(true).notNull(),      // bildirime onay/reddet düğmeleri ekle
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

/** Kripto borsa (ccxt) ayarları — varsayılan Binance VADELİ DEMO (test ağı). Anahtarlar yalnız ajana gider. */
export const cryptoSettings = pgTable("crypto_settings", {
  userId: integer("user_id").primaryKey(),
  enabled: boolean("enabled").default(false).notNull(),
  exchange: text("exchange").default("binance").notNull(), // ccxt id
  apiKey: text("api_key").default("").notNull(),
  secret: text("secret").default("").notNull(),
  password: text("password").default("").notNull(), // okx / kucoin passphrase
  demo: boolean("demo").default(true).notNull(), // Binance Demo Trading (test ağı)
  leverage: integer("leverage").default(5).notNull(),
  marginMode: text("margin_mode").default("isolated").notNull(),
  orderUsdt: doublePrecision("order_usdt").default(50).notNull(), // işlem başına teminat (USDT)
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});
