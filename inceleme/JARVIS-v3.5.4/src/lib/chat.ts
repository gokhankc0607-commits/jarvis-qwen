import { and, desc, eq, ilike, ne } from "drizzle-orm";
import { db } from "@/db";
import { messages, signals, trades, accountState, strategies, watchRules, kanalSettings } from "@/db/schema";
import { callLLM, getActiveProvider, type ChatMsg } from "./llm";
import { compileStrategy, decideSignal } from "./actions";
import { isNo, isYes, normalizeTr } from "./intent";
import { allTicks } from "./live";
import { TRADE_HELP, foldTr, looksLikeTrade, parseTradeCommand, type Market, type TradeCmd } from "./tradeCommand";
import { cryptoCfg } from "./cryptoStore";
import { getAgentInfo } from "./live";
import { cryptoCanon } from "./symbols";
import { createManualOrder, waitSignal } from "./orders";
import { computeModify, getPendingAction, isLive, openTrades, precheck, queueClose, queueModify, queuePartial, setPendingAction, waitCommands, type TradeRow } from "./tradeOps";
import { sameSymbol } from "./symbols";

const fmt = (n: number, d = 2) => n.toLocaleString("tr-TR", { minimumFractionDigits: d, maximumFractionDigits: d });
const sideTr = (s: string) => (s === "BUY" ? "ALIŞ" : "SATIŞ");

export type ChatOut = { reply: string; action: string | null };

/** Sohbet + sesli komut işleyici (panel /api/chat ve ajan /api/agent/command ortak kullanır). */
export async function handleChat(userId: number, input: string, ctx: { symbol?: string | null } = {}): Promise<ChatOut & { message: typeof messages.$inferSelect }> {
  await db.insert(messages).values({ userId, role: "user", content: input });
  const out = await route(userId, input, ctx);
  const [saved] = await db.insert(messages).values({ userId, role: "assistant", content: out.reply }).returning();
  return { ...out, message: saved };
}

async function route(userId: number, input: string, ctx: { symbol?: string | null }): Promise<ChatOut> {
  const live = await isLive(userId);
  const t = normalizeTr(input);
  const [pending] = await db
    .select()
    .from(signals)
    .where(and(eq(signals.userId, userId), eq(signals.status, "pending"), live ? ne(signals.source, "demo") : undefined))
    .orderBy(desc(signals.createdAt))
    .limit(1);
  const pa = getPendingAction(userId);
  const paNewer = pa && (!pending || pa.at > new Date(pending.createdAt).getTime());

  /* ---------- "kripto mu forex mi?" sorusuna cevap ---------- */
  if (pa?.kind === "askMarket") {
    const ans = pickMarketWord(input);
    if (ans) {
      setPendingAction(userId, null);
      const open = await openTrades(userId, live);
      return runTradeCommand(userId, { ...(pa.cmd as unknown as TradeCmd), market: ans } as TradeCmd, live, open, ctx);
    }
    if (isNo(input)) {
      setPendingAction(userId, null);
      return { reply: "Anlaşıldı, emir iptal edildi.", action: "cancelled" };
    }
  }

  /* ---------- EVET / HAYIR ---------- */
  if (isYes(input) && paNewer && pa?.kind === "closeAll") return confirmCloseAll(userId, live, pa.ids);
  if (isNo(input) && paNewer && pa?.kind === "closeAll") {
    setPendingAction(userId, null);
    return { reply: "Anlaşıldı, işlemler kapatılmadı.", action: "cancelled" };
  }
  if (pending && isYes(input)) return approveSignal(userId, pending);
  if (pending && isNo(input)) {
    await decideSignal(userId, pending.id, false);
    return { reply: pending.source === "manual" ? `Anlaşıldı, ${pending.symbol} emri iptal edildi.` : `Anlaşıldı, ${pending.symbol} ${pending.side} fırsatı reddedildi. İzlemeye devam ediyorum.`, action: "signal_rejected" };
  }

  /* ---------- durum / derle ---------- */
  if (/^(durum|bakiye|hesap|rapor)/.test(t)) {
    const [a] = await db.select().from(accountState).where(eq(accountState.userId, userId));
    const open = await openTrades(userId, live);
    const pnl = open.reduce((s, x) => s + x.pnl, 0);
    return { reply: `Bakiye ${fmt(a?.balance ?? 0)} ${a?.currency ?? "USD"}, varlık ${fmt(a?.equity ?? 0)}, serbest teminat ${fmt(a?.freeMargin ?? 0)}. ${open.length} açık işlem, toplam yüzen kâr/zarar ${fmt(pnl)}.${open.length ? " " + open.map((o) => `${o.symbol} ${sideTr(o.side)} ${fmt(o.pnl)}`).join(", ") + "." : ""}`, action: null };
  }
  if (/^derle\b/.test(t)) {
    const q = input.replace(/^derle\s*/i, "").trim();
    const [st] = q
      ? await db.select().from(strategies).where(and(eq(strategies.userId, userId), ilike(strategies.name, `%${q}%`))).limit(1)
      : await db.select().from(strategies).where(eq(strategies.userId, userId)).orderBy(desc(strategies.updatedAt)).limit(1);
    if (!st) return { reply: "Bu isimde bir strateji bulamadım.", action: null };
    const job = await compileStrategy(userId, st.id, true);
    return {
      reply: job.status === "queued" ? `${st.name} derleme kuyruğuna alındı.` : job.status === "success" ? `${st.name} başarıyla derlendi.` : `${st.name} derlemesinde ${job.errors} hata var.`,
      action: "compile",
    };
  }

  /* ---------- işlem komutları ---------- */
  const open = await openTrades(userId, live);
  const rules = await db.select({ symbol: watchRules.symbol }).from(watchRules).where(eq(watchRules.userId, userId));
  const known = [...new Set([...open.map((o) => o.symbol), ...allTicks(userId).map((x) => x.s), ...rules.map((r) => r.symbol)])];
  const cmd = parseTradeCommand(input, known);
  if (cmd) {
    try {
      return await runTradeCommand(userId, cmd, live, open, ctx);
    } catch (e) {
      return { reply: `Yapamadım efendim: ${(e as Error).message}`, action: "error" };
    }
  }
  if (looksLikeTrade(input) && input.length < 80) return { reply: TRADE_HELP, action: null };

  /* ---------- sohbet (LLM) ---------- */
  const p = await getActiveProvider(userId);
  const [a] = await db.select().from(accountState).where(eq(accountState.userId, userId));
  const hist = await db.select().from(messages).where(eq(messages.userId, userId)).orderBy(desc(messages.createdAt)).limit(10);
  const c = `Hesap: bakiye ${a?.balance}, varlık ${a?.equity}. Açık işlemler: ${open.map((o) => `${o.symbol} ${o.side} ${o.volume} lot K/Z ${o.pnl}`).join("; ") || "yok"}.`;
  const msgs: ChatMsg[] = [
    {
      role: "system",
      content: `Sen JARVIS'sin: kullanıcının MT5 algoritmik işlem ve MQL5 asistanı. Türkçe, kısa (en fazla 3 cümle), saygılı ("efendim") konuş. ÖNEMLİ: Emir açma, SL/TP değiştirme ve kapatma ayrı bir modülde işlenir; sen ASLA emir açtığını, değiştirdiğini ya da kapattığını söyleme. Kullanıcı işlem istiyorsa örnek komut ver: "EURUSD 0.1 lot al sl 30 tp 60", "SL girişe çek", "NAS100 kapat". Bağlam: ${c}`,
    },
    ...hist.reverse().map((m) => ({ role: (m.role === "user" ? "user" : "assistant") as "user" | "assistant", content: m.content })),
  ];
  if (!p) return { reply: "Aktif bir AI sağlayıcısı yok efendim. İşlem komutlarını yine de verebilirsiniz (örn. “EURUSD al”, “SL girişe çek”).", action: null };
  try {
    return { reply: await callLLM(p, msgs, 60000), action: null };
  } catch {
    return { reply: `Yerel zekâ çekirdeğine (${p.name}) ulaşamıyorum efendim. İşlem komutları yine çalışır: “EURUSD al sl 30”, “SL girişe çek”, “hepsini kapat”, “durum”.`, action: null };
  }
}

/** Cevaptan piyasa seç: "kripto" / "forex" (mt5, broker). */
function pickMarketWord(input: string): Market | null {
  const t = foldTr(input);
  if (/\b(kripto|crypto|binance|borsa|vadeli|futures)\b/.test(t)) return "crypto";
  if (/\b(forex|mt5|metatrader|broker)\b/.test(t)) return "forex";
  return null;
}

/** Sembol hangi piyasalarda işlem görebilir? (BTC: ikisinde de olabilir; EURUSD: forex; SOLUSDT: kripto) */
async function marketsFor(userId: number, symbol: string, live: boolean): Promise<Market[]> {
  const c = await cryptoCfg(userId);
  const cryptoOn = c.enabled && (!live || !!getAgentInfo(userId)?.crypto);
  const s = symbol.toUpperCase();
  const ticks = allTicks(userId);
  const inFx = ticks.some((t) => t.src !== "crypto" && sameSymbol(t.s, s));
  const inCr = ticks.some((t) => t.src === "crypto" && (t.s === cryptoCanon(s) || sameSymbol(t.s, s)));
  const looksCrypto = /^(BTC|ETH|SOL|XRP|BNB|DOGE|ADA|AVAX|LINK|LTC|DOT|TRX|MATIC|SHIB|PEPE)/.test(s) || /USDT$/.test(s);
  const out: Market[] = [];
  if (live) {
    if (inFx) out.push("forex");
    if (cryptoOn && inCr) out.push("crypto");
    if (!out.length) {
      if (!looksCrypto) out.push("forex");
      if (cryptoOn && looksCrypto) out.push("crypto");
      if (!out.length) out.push("forex");
    }
  } else {
    out.push("forex");
    if (cryptoOn) out.push("crypto");
    if (!cryptoOn && looksCrypto) return ["forex"];
  }
  return out;
}

/* ======================================================================= */
async function approveSignal(userId: number, pending: typeof signals.$inferSelect): Promise<ChatOut> {
  const r = await decideSignal(userId, pending.id, true);
  if (r.status === "executed") return { reply: `Onay alındı. ${pending.symbol} ${sideTr(pending.side)} işlemi demo modunda açıldı (gerçek hesaba gitmedi).`, action: "signal_approved" };
  const done = await waitSignal(pending.id);
  if (done?.status === "executed") return { reply: `✓ ${pending.symbol} ${sideTr(pending.side)} ${pending.volume} lot emri gerçekleşti efendim. ${done.note}`, action: "order_done" };
  if (done?.status === "failed") return { reply: `✗ ${pending.symbol} emri MT5'te reddedildi: ${done.note}`, action: "order_failed" };
  return { reply: `Onay alındı, ${pending.symbol} emri MT5 ajanına iletildi. Sonuç birazdan panelde görünecek.`, action: "signal_approved" };
}

async function confirmCloseAll(userId: number, live: boolean, ids: number[]): Promise<ChatOut> {
  setPendingAction(userId, null);
  const rows = (await openTrades(userId, live)).filter((t) => ids.includes(t.id));
  if (!rows.length) return { reply: "Kapatılacak açık işlem kalmamış.", action: null };
  const cmds = await Promise.all(rows.map((t) => queueClose(userId, t, live)));
  const res = await waitCommands(cmds.map((c) => c.id));
  return { reply: summarize("kapatıldı", rows, res), action: "closed" };
}

function summarize(verb: string, rows: TradeRow[], res: { ticket: string; status: string; note: string }[]) {
  const ok = res.filter((r) => r.status === "done");
  const bad = res.filter((r) => r.status === "failed");
  const wait = res.filter((r) => r.status !== "done" && r.status !== "failed");
  const name = (tk: string) => rows.find((x) => x.ticket === tk)?.symbol ?? `#${tk}`;
  const parts: string[] = [];
  if (ok.length) parts.push(`✓ ${ok.map((r) => name(r.ticket)).join(", ")} ${verb}.`);
  if (bad.length) parts.push(`✗ ${bad.map((r) => `${name(r.ticket)}: ${r.note}`).join(" · ")}`);
  if (wait.length) parts.push(`${wait.length} işlem MT5'e iletildi, yanıt bekleniyor (ajan açık mı?).`);
  return parts.join(" ");
}

function pickTargets(open: TradeRow[], cmd: { symbol: string | null; all: boolean; side?: "BUY" | "SELL" | null }, ctxSymbol?: string | null) {
  let list = open;
  if (cmd.side) list = list.filter((t) => t.side === cmd.side);
  if (cmd.symbol) return { list: list.filter((t) => sameSymbol(t.symbol, cmd.symbol!)), ask: null as string | null };
  if (cmd.all || list.length === 1) return { list, ask: null };
  if (ctxSymbol) {
    const c = list.filter((t) => sameSymbol(t.symbol, ctxSymbol));
    if (c.length) return { list: c, ask: null };
  }
  if (!list.length) return { list, ask: null };
  return { list: [], ask: `Hangi işlem efendim? Açık: ${[...new Set(list.map((t) => t.symbol))].join(", ")}. Örn: “${list[0].symbol} …” ya da hepsi için “hepsinin …”.` };
}

async function runTradeCommand(userId: number, cmd: TradeCmd, live: boolean, open: TradeRow[], ctx: { symbol?: string | null }): Promise<ChatOut> {
  /* ---------- yeni emir: onay sorulur (kesin kural) ---------- */
  if (cmd.kind === "open") {
    const symbol = cmd.symbol ?? ctx.symbol ?? null;
    if (!symbol) return { reply: `Hangi paritede ${sideTr(cmd.side)} yapalım efendim? Örn: “EURUSD ${cmd.side === "BUY" ? "al" : "sat"} 0.1 lot sl 30 tp 60” ya da “btc kripto al”.`, action: null };
    // Piyasa: "kripto" / "forex" denmediyse ve sembol iki piyasada da olabiliyorsa SOR
    let market: Market | null = cmd.market;
    if (!market) {
      const ms = await marketsFor(userId, symbol, live);
      if (ms.length > 1) {
        setPendingAction(userId, { kind: "askMarket", at: Date.now(), cmd: cmd as unknown as Record<string, unknown> });
        return { reply: `${symbol} ${sideTr(cmd.side)} — hangi piyasada efendim: <b>kripto</b> (borsa, vadeli) mi, <b>forex</b> (MT5) mi?`.replace(/<\/?b>/g, ""), action: "ask_market" };
      }
      market = ms[0] ?? "forex";
    }
    const [k] = await db.select({ lot: kanalSettings.lot }).from(kanalSettings).where(eq(kanalSettings.userId, userId)).limit(1);
    const c = market === "crypto" ? await cryptoCfg(userId) : null;
    const volume = cmd.volume ?? k?.lot ?? 0.1;
    const { signal, price, digits } = await createManualOrder(userId, { symbol, side: cmd.side, volume, market, slLevel: cmd.sl, tpLevel: cmd.tp }, false, `Elle emir (sohbet / sesli komut · ${market === "crypto" ? "kripto" : "forex"})`);
    const f = (v: number | null) => (v ? v.toFixed(digits) : "yok");
    const size = market === "crypto" ? `${c?.orderUsdt ?? 50} USDT × ${c?.leverage ?? 5}x` : `${volume} lot`;
    const where = market === "crypto" ? `🪙 KRİPTO (${c?.exchange ?? "binance"} ${c?.demo ? "demo" : "CANLI"} vadeli)` : "💱 FOREX (MT5)";
    return {
      reply: `${where} · ${signal.symbol} ${sideTr(cmd.side)} ${size} · giriş ≈ ${price.toFixed(digits)} · SL ${f(signal.sl)} · TP ${f(signal.tp)}${live ? "" : " (demo)"}. Emri göndereyim mi? “Evet” deyin.`,
      action: "order_pending",
    };
  }

  const { list, ask } = pickTargets(open, cmd, ctx.symbol);
  if (ask) return { reply: ask, action: null };
  if (!list.length) return { reply: cmd.symbol ? `${cmd.symbol} için açık işlem yok efendim.` : "Açık işlem yok efendim.", action: null };

  /* ---------- yarı kâr al (kısmi kapat) ---------- */
  if (cmd.kind === "close" && cmd.fraction) {
    const fr = cmd.fraction;
    const cmds = [];
    const errs: string[] = [];
    for (const t of list) {
      try { cmds.push(await queuePartial(userId, t, fr, live)); } catch (e) { errs.push((e as Error).message); }
    }
    const res = cmds.length ? await waitCommands(cmds.map((c) => c.id)) : [];
    const s = res.length ? summarize(`— %${Math.round(fr * 100)}'i kapatıldı (yarı kâr alındı)`, list, res) : "";
    return { reply: [s, errs.length ? `✗ ${errs.join(" · ")}` : ""].filter(Boolean).join(" ") || "Kapatılacak işlem bulunamadı.", action: "partial" };
  }

  /* ---------- kapat ---------- */
  if (cmd.kind === "close") {
    if (cmd.all && list.length > 1 && !cmd.fraction) {
      setPendingAction(userId, { kind: "closeAll", ids: list.map((t) => t.id), at: Date.now() });
      const pnl = list.reduce((s, t) => s + t.pnl, 0);
      return { reply: `${list.length} işlem kapatılacak (${list.map((t) => t.symbol).join(", ")}), toplam K/Z ${fmt(pnl)}. Onaylıyor musunuz? “Evet” deyin.`, action: "confirm_close_all" };
    }
    const cmds = await Promise.all(list.map((t) => queueClose(userId, t, live)));
    const res = await waitCommands(cmds.map((c) => c.id));
    return { reply: summarize("kapatıldı", list, res), action: "closed" };
  }

  /* ---------- SL / TP değiştir ---------- */
  const plans = list.map((t) => ({ t, ...computeModify(t, { be: cmd.be, sl: cmd.sl, tp: cmd.tp }) }));
  const errs: string[] = [];
  const go = plans.filter((p) => {
    const e = precheck(userId, p.t, p.sl, p.tp);
    if (e) errs.push(e);
    return !e && (p.sl !== null || p.tp !== null);
  });
  if (!go.length) return { reply: errs.length ? `✗ ${errs.join(" · ")}` : "Değiştirilecek SL/TP anlaşılamadı efendim. Örn: “sl 4150 yap”, “tp 60 pip”, “SL girişe çek”.", action: "error" };
  const cmds = await Promise.all(go.map((p) => queueModify(userId, p.t, p.sl, p.tp, live)));
  const res = await waitCommands(cmds.map((c) => c.id));
  const what = cmd.be ? "SL girişe çekildi" : [go[0].sl !== null ? `SL ${go[0].sl || "kaldırıldı"}` : "", go[0].tp !== null ? `TP ${go[0].tp || "kaldırıldı"}` : ""].filter(Boolean).join(", ") + " yapıldı";
  const s = summarize(`— ${what}`, list, res);
  return { reply: [s, errs.length ? `✗ ${errs.join(" · ")}` : ""].filter(Boolean).join(" "), action: "modified" };
}
