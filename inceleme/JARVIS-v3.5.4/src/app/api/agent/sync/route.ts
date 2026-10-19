import { and, eq, gt, inArray, asc, ne, lt } from "drizzle-orm";
import { db } from "@/db";
import { accountState, trades, signals, compileJobs, strategies, watchRules, tradeCommands } from "@/db/schema";
import { userFromAgentKey } from "@/lib/auth";
import { getActiveProvider } from "@/lib/llm";
import { expandRules } from "@/lib/rules";
import { setAgentInfo, setCryptoAccount, setPing } from "@/lib/live";
import { cryptoCfg } from "@/lib/cryptoStore";
import { LATEST_AGENT, cmpVersion } from "@/lib/version";
import { notifySignal, notifyText, tgCfg } from "@/lib/telegram";
import { panelUrl } from "@/lib/baseUrl";
import { getScan } from "@/lib/live";
import { ensureKanal } from "@/lib/kanalStore";

type Pos = { ticket: string | number; symbol: string; side: string; volume: number; openPrice: number; currentPrice: number; sl?: number; tp?: number; pnl: number; comment?: string; magic?: number; tf?: string; market?: string };

const TFS_OK = new Set(["M1", "M3", "M5", "M15", "M30", "H1", "H4", "D1", "MAN"]);
/** "JARVIS AUTO M15", "JARVIS BUY M5 #12", "KANAL BUY PERIOD_M15" -> M15 */
const TF_RE = /(?<![A-Z0-9])(?:PERIOD_)?(M1|M3|M5|M15|M30|H1|H4|D1|MAN)(?![A-Z0-9])/;
type Sig = { symbol: string; side: string; timeframe?: string; price: number; sl?: number; tp?: number; volume?: number; reason?: string; indicators?: Record<string, number | string | boolean>; confidence?: number; auto?: boolean; status?: string; note?: string; market?: string };
const mk = (m?: string) => (m === "crypto" ? "crypto" : "forex");

export async function POST(req: Request) {
  const u = await userFromAgentKey(req.headers.get("x-agent-key"));
  if (!u) return Response.json({ error: "Geçersiz ajan anahtarı" }, { status: 401 });
  const b = await req.json().catch(() => ({}));
  const now = new Date();
  if (b.agent && typeof b.agent === "object")
    setAgentInfo(u.id, {
      version: String(b.agent.version ?? ""), algo: b.agent.algo !== false, tradeAllowed: b.agent.tradeAllowed !== false,
      build: Number(b.agent.build ?? 0) || 0, crypto: !!b.agent.crypto, cryptoLabel: String(b.agent.cryptoLabel ?? ""),
    });
  if (b.crypto !== undefined) setCryptoAccount(u.id, b.crypto && typeof b.crypto === "object" ? (b.crypto as Record<string, unknown>) : null);

  const a = b.account ?? null;
  const accSet = {
    agentLastSeen: now,
    updatedAt: now,
    connected: Boolean(a?.connected ?? false),
    ...(a
      ? {
          server: String(a.server ?? ""),
          login: String(a.login ?? ""),
          balance: Number(a.balance ?? 0),
          equity: Number(a.equity ?? 0),
          margin: Number(a.margin ?? 0),
          freeMargin: Number(a.freeMargin ?? 0),
          currency: String(a.currency ?? "USD"),
          leverage: Number(a.leverage ?? 100),
        }
      : {}),
  };
  await db.insert(accountState).values({ userId: u.id, ...accSet }).onConflictDoUpdate({ target: accountState.userId, set: accSet });

  if (Array.isArray(b.positions) && a?.connected) {
    const positions = b.positions as Pos[];
    const tickets = positions.map((p) => String(p.ticket));
    const existing = await db.select().from(trades).where(and(eq(trades.userId, u.id), inArray(trades.status, ["open", "closing"])));
    /**
     * İşlemin açıldığı zaman dilimi (öncelik sırasıyla):
     *  1) ajanın kalıcı kaydı (p.tf) — broker yorumu silse bile doğrudur
     *  2) emir yorumu ("JARVIS AUTO M15", "KANAL BUY PERIOD_M15")
     *  3) bilet numarası -> o bileti açan sinyal ("MT5 bilet #123" notu)
     *  4) yorumdaki #sinyal numarası
     */
    let ticketTf: Map<string, string> | null = null;
    const loadTicketTf = async () => {
      if (ticketTf) return ticketTf;
      ticketTf = new Map();
      const rows = await db
        .select({ tf: signals.timeframe, note: signals.note })
        .from(signals)
        .where(and(eq(signals.userId, u.id), eq(signals.status, "executed"), gt(signals.createdAt, new Date(Date.now() - 30 * 86400000))));
      for (const r of rows) {
        const m = r.note.match(/bilet #(\d+)/);
        if (m && r.tf) ticketTf.set(m[1], r.tf);
      }
      return ticketTf;
    };
    const tfOf = async (p: Pos, comment: string): Promise<string> => {
      const t0 = String(p.tf ?? "").toUpperCase();
      if (TFS_OK.has(t0)) return t0;
      const m = comment.toUpperCase().match(TF_RE);
      if (m) return m[1];
      const byTicket = (await loadTicketTf()).get(String(p.ticket));
      if (byTicket) return byTicket;
      const id = comment.match(/#(\d+)/);
      if (id) {
        const [sg] = await db.select({ tf: signals.timeframe }).from(signals).where(and(eq(signals.id, Number(id[1])), eq(signals.userId, u.id))).limit(1);
        if (sg) return sg.tf;
      }
      return "";
    };
    for (const p of positions) {
      const ex = existing.find((e) => e.ticket === String(p.ticket));
      const vals = { currentPrice: p.currentPrice, pnl: p.pnl, sl: p.sl || null, tp: p.tp || null, volume: p.volume };
      if (ex) {
        // boşsa doldur (elle atanmış ya da bulunmuş değer korunur)
        const tf = ex.timeframe ? "" : await tfOf(p, p.comment || ex.comment || "");
        await db.update(trades).set(tf ? { ...vals, timeframe: tf } : vals).where(eq(trades.id, ex.id));
      } else
        await db.insert(trades).values({
          userId: u.id, ticket: String(p.ticket), symbol: p.symbol, side: p.side, openPrice: p.openPrice,
          comment: p.comment ?? "", source: "agent", timeframe: await tfOf(p, p.comment ?? ""), market: mk(p.market), ...vals,
        });
    }
    for (const e of existing) {
      if (e.source !== "manual" && !tickets.includes(e.ticket) && (e.source === "agent" || e.status === "closing"))
        await db.update(trades).set({ status: "closed", closedAt: now }).where(eq(trades.id, e.id));
    }
  }

  // MT5 geçmişinden gelen gerçekleşmiş K/Z (komisyon + swap dahil)
  if (Array.isArray(b.closed)) {
    for (const c of b.closed.slice(0, 50) as { ticket: string; profit: number; price: number; time: number }[]) {
      if (!c?.ticket || !Number.isFinite(c.profit)) continue;
      await db
        .update(trades)
        .set({ status: "closed", pnl: c.profit, currentPrice: Number.isFinite(c.price) ? c.price : undefined, closedAt: c.time ? new Date(c.time * 1000) : now })
        .where(and(eq(trades.userId, u.id), eq(trades.ticket, String(c.ticket))));
    }
  }

  /** Bildirimde kanal/RSI ayrıntısı için aynı paritenin son tarama kaydı. */
  const scanItemFor = (symbol: string, tf: string) => {
    const it = getScan(u.id)?.items?.find(
      (x) => typeof x === "object" && x !== null && (x as { symbol?: string }).symbol === symbol && (x as { tf?: string }).tf === tf
    );
    return (it ?? null) as never;
  };

  let created = 0;
  if (Array.isArray(b.signals)) {
    for (const s of b.signals as Sig[]) {
      // Otomatik işlem: ajan emri zaten MT5'te uyguladı (ya da denedi) — kayıt olarak eklenir, onay sorulmaz
      if (s.auto) {
        const st = s.status === "executed" ? "executed" : s.status === "failed" ? "failed" : "rejected";
        await db.insert(signals).values({
          userId: u.id, symbol: s.symbol, side: s.side === "SELL" ? "SELL" : "BUY", timeframe: s.timeframe ?? "H1",
          price: s.price, sl: s.sl ?? null, tp: s.tp ?? null, volume: s.volume ?? 0.1, reason: s.reason ?? "",
          indicators: s.indicators ?? {}, confidence: s.confidence ?? 0, source: "auto", status: st, market: mk(s.market),
          note: String(s.note ?? "").slice(0, 500), decidedAt: now,
        });
        created++;
        if (st === "executed")
          void notifyText(u.id, "auto", `${mk(s.market) === "crypto" ? "🪙 KRİPTO" : "💱 FOREX"} · 🤖 <b>${s.symbol} · ${s.timeframe ?? ""}</b> otomatik ${s.side === "BUY" ? "ALIŞ" : "SATIŞ"} açıldı\n${String(s.note ?? "").slice(0, 200)}`);
        else if (st === "failed")
          void notifyText(u.id, "error", `⚠️ <b>${s.symbol}</b> otomatik emir gönderilemedi\n${String(s.note ?? "").slice(0, 250)}`);
        continue;
      }
      const dup = await db
        .select({ id: signals.id })
        .from(signals)
        .where(and(eq(signals.userId, u.id), eq(signals.symbol, s.symbol), eq(signals.side, s.side), eq(signals.timeframe, s.timeframe ?? "H1"), gt(signals.createdAt, new Date(Date.now() - 30 * 60000))))
        .limit(1);
      if (dup.length) continue;
      const tg = { ...s, timeframe: s.timeframe ?? "H1" };
      await db.insert(signals).values({
        userId: u.id, symbol: s.symbol, side: s.side === "SELL" ? "SELL" : "BUY", timeframe: s.timeframe ?? "H1",
        price: s.price, sl: s.sl ?? null, tp: s.tp ?? null, volume: s.volume ?? 0.1, reason: s.reason ?? "",
        indicators: s.indicators ?? {}, confidence: s.confidence ?? 50, source: "agent", market: mk(s.market),
      });
      created++;
      // Telegram: kanal teması / taşması + o anki RSI durumu + onay düğmeleri
      void notifySignal(u.id, tg as never, scanItemFor(s.symbol, tg.timeframe), await panelUrl());
    }
  }

  // Elle (sohbet) verilen ve 5 dk içinde onaylanmayan emirler geçersiz (fiyat değişti)
  await db
    .update(signals)
    .set({ status: "expired", note: "Onay süresi doldu (5 dk) — komutu tekrar verin" })
    .where(and(eq(signals.userId, u.id), eq(signals.status, "pending"), eq(signals.source, "manual"), lt(signals.createdAt, new Date(Date.now() - 5 * 60000))));
  // 30 dk'dan eski bekleyen sinyaller bayattır: süresi dolmuş say (fiyat ve SL/TP artık geçersiz)
  await db
    .update(signals)
    .set({ status: "expired", note: "Süre doldu (30 dk) — yeni sinyal bekleyin" })
    .where(and(eq(signals.userId, u.id), eq(signals.status, "pending"), ne(signals.source, "demo"), lt(signals.createdAt, new Date(Date.now() - 30 * 60000))));
  // Demo/örnek sinyaller gerçek MT5 ajanına ASLA gönderilmez
  const approved = await db.select().from(signals).where(and(eq(signals.userId, u.id), eq(signals.status, "approved"), ne(signals.source, "demo")));
  // Pozisyon komutları (SL/TP değiştir, kapat). v2.9+ ajan uygular; eski ajan yalnızca kapatmayı (closeTickets) bilir.
  const agentVer = String(b.agent?.version ?? "");
  const newAgent = !!agentVer && cmpVersion(agentVer, "2.9.0") >= 0;
  await db
    .update(tradeCommands)
    .set({ status: "failed", note: "Ajandan yanıt gelmedi (60 sn) — ajan penceresini kontrol edin", doneAt: now })
    .where(and(eq(tradeCommands.userId, u.id), eq(tradeCommands.status, "sent"), lt(tradeCommands.createdAt, new Date(Date.now() - 60000))));
  const queuedCmds = await db.select().from(tradeCommands).where(and(eq(tradeCommands.userId, u.id), eq(tradeCommands.status, "queued"))).orderBy(asc(tradeCommands.id));
  let commands: typeof queuedCmds = [];
  const partialOk = !!agentVer && cmpVersion(agentVer, "3.2.0") >= 0;
  if (newAgent && !partialOk) {
    for (const c of queuedCmds.filter((x) => x.type === "partial"))
      await db.update(tradeCommands).set({ status: "failed", note: `Yarı kâr al için ajan v3.2 gerekli (şu an v${agentVer}) — CALISTIR.bat ile yeniden başlatın.`, doneAt: now }).where(eq(tradeCommands.id, c.id));
  }
  if (newAgent) {
    commands = queuedCmds.filter((x) => x.type !== "partial" || partialOk);
    if (commands.length) await db.update(tradeCommands).set({ status: "sent" }).where(inArray(tradeCommands.id, commands.map((c) => c.id)));
  } else {
    for (const c of queuedCmds)
      await db
        .update(tradeCommands)
        .set(c.type === "close"
          ? { status: "done", note: "Kapatma isteği iletildi (eski ajan)", doneAt: now }
          : { status: "failed", note: `Ajan eski sürüm (${agentVer ? "v" + agentVer : "bilinmiyor"}) — SL/TP değiştirmek için ajanı CALISTIR.bat ile yeniden başlatın (otomatik güncellenir).`, doneAt: now })
        .where(eq(tradeCommands.id, c.id));
  }
  const closeReq = newAgent ? [] : await db.select({ ticket: trades.ticket }).from(trades).where(and(eq(trades.userId, u.id), eq(trades.status, "closing")));
  const queued = await db
    .select({ job: compileJobs, strategy: strategies })
    .from(compileJobs)
    .innerJoin(strategies, eq(strategies.id, compileJobs.strategyId))
    .where(and(eq(compileJobs.userId, u.id), eq(compileJobs.status, "queued")))
    .orderBy(asc(compileJobs.createdAt));
  if (queued.length) {
    await db.update(compileJobs).set({ status: "running" }).where(inArray(compileJobs.id, queued.map((q) => q.job.id)));
    await db.update(strategies).set({ status: "compiling" }).where(inArray(strategies.id, queued.map((q) => q.strategy.id)));
  }
  const pending = await db.select().from(signals).where(and(eq(signals.userId, u.id), eq(signals.status, "pending"), ne(signals.source, "demo")));
  const allRules = await db.select().from(watchRules).where(eq(watchRules.userId, u.id));
  const rules = expandRules(allRules.filter((r) => r.enabled)); // her zaman dilimi ayrı kural
  const kanal = await ensureKanal(u.id);
  const watchlist = expandRules(allRules).map((r) => ({ symbol: r.symbol, timeframe: r.timeframe }));
  // Takip listesindeki pariteler de grafik / fiyat için izlenir (KANAL zaman dilimlerinde)
  const wl: { symbol: string; timeframe: string; market?: string }[] = watchlist;
  for (const sym of kanal.symbols)
    for (const tf of kanal.timeframes.split(",").filter(Boolean))
      if (!wl.some((w) => w.symbol.toUpperCase() === sym && w.timeframe === tf)) wl.push({ symbol: sym, timeframe: tf, market: "forex" });
  for (const sym of kanal.cryptoSymbols)
    for (const tf of kanal.timeframes.split(",").filter(Boolean))
      if (!wl.some((w) => w.symbol.toUpperCase() === sym && w.timeframe === tf && w.market === "crypto")) wl.push({ symbol: sym, timeframe: tf, market: "crypto" });
  if (typeof a?.ping === "number") setPing(u.id, a.ping);
  const provider = await getActiveProvider(u.id);

  return Response.json({
    createdSignals: created,
    approvedSignals: approved,
    pendingSignals: pending,
    closeTickets: closeReq.map((c) => c.ticket),
    commands: commands.map((c) => ({ id: c.id, type: c.type, ticket: c.ticket, symbol: c.symbol, sl: c.sl, tp: c.tp, fraction: c.fraction, market: c.market })),
    crypto: await (async () => {
      const c = await cryptoCfg(u.id);
      return c.enabled ? { enabled: true, exchange: c.exchange, apiKey: c.apiKey, secret: c.secret, password: c.password, demo: c.demo, leverage: c.leverage, marginMode: c.marginMode, orderUsdt: c.orderUsdt } : { enabled: false };
    })(),
    compileJobs: queued.map((q) => ({
      jobId: q.job.id, strategyId: q.strategy.id, name: q.strategy.name, filePath: q.strategy.filePath,
      code: q.strategy.code, autoFix: q.job.autoFix, maxAttempts: q.job.maxAttempts,
    })),
    rules,
    watchlist,
    kanal,
    telegram: (await tgCfg(u.id)).enabled
      ? { enabled: true, botToken: (await tgCfg(u.id)).botToken, chatId: (await tgCfg(u.id)).chatId }
      : { enabled: false },
    latestAgent: LATEST_AGENT,
    provider: provider ? { kind: provider.kind, baseUrl: provider.baseUrl, model: provider.model, apiKey: provider.apiKey } : null,
  });
}
