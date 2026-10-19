import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { accountState, signals, trades, strategies, compileJobs } from "@/db/schema";
import { agentOnline, demoCompile } from "./sim";
import { callLLM, extractCode, getActiveProvider } from "./llm";

export async function isAgentOnline(userId: number) {
  const [a] = await db.select().from(accountState).where(eq(accountState.userId, userId)).limit(1);
  return agentOnline(a?.agentLastSeen);
}

/** KESİN KURAL: işlem yalnızca kullanıcı açıkça onayladığında açılır. (Panelden "Evet", sesli "Evet" ya da elle emir onayı.) */
export async function decideSignal(userId: number, signalId: number, approve: boolean) {
  const [s] = await db
    .select()
    .from(signals)
    .where(and(eq(signals.id, signalId), eq(signals.userId, userId)))
    .limit(1);
  if (!s) throw new Error("Sinyal bulunamadı");
  if (approve && s.status === "pending" && s.source === "manual" && s.timeframe === "MAN" && Date.now() - new Date(s.createdAt).getTime() > 5 * 60000) {
    await db.update(signals).set({ status: "expired", note: "Onay süresi doldu (5 dk)" }).where(eq(signals.id, s.id));
    throw new Error("Bu emrin onay süresi doldu (5 dk, fiyat değişti). Komutu tekrar verin.");
  }
  const retry = approve && s.status === "failed";
  if (s.status !== "pending" && !retry) return s;
  const online = await isAgentOnline(userId);

  if (!approve) {
    const [r] = await db
      .update(signals)
      .set({ status: "rejected", decidedAt: new Date() })
      .where(eq(signals.id, s.id))
      .returning();
    return r;
  }

  if (retry && (!online || s.source === "demo")) throw new Error("Yeniden deneme için MT5 ajanı çevrimiçi olmalı");
  if (retry && Date.now() - new Date(s.createdAt).getTime() > 45 * 60000)
    throw new Error("Sinyal çok eski (45 dk+). Yeni sinyal bekleyin ya da Hızlı Emir ile güncel fiyattan emir verin.");

  if (online && s.source !== "demo") {
    // Python ajanı bir sonraki senkronizasyonda (≤2 sn) MT5 üzerinde emri gönderir.
    const [r] = await db
      .update(signals)
      .set({ status: "approved", decidedAt: new Date(), note: retry ? "Tekrar denendi — MT5 ajanına iletildi" : "Onaylandı — MT5 ajanına iletildi" })
      .where(eq(signals.id, s.id))
      .returning();
    return r;
  }

  // Demo modu / demo sinyal: simüle yürütme (gerçek MT5'e emir GİTMEZ)
  await db.insert(trades).values({
    userId,
    ticket: String(100480000 + Math.floor(Math.random() * 99999)),
    symbol: s.symbol,
    side: s.side,
    volume: s.volume,
    openPrice: s.price,
    currentPrice: s.price,
    sl: s.sl,
    tp: s.tp,
    pnl: 0,
    source: "demo",
    timeframe: s.timeframe,
    comment: `JARVIS ${s.side} ${s.timeframe} (demo)`,
  });
  const [r] = await db
    .update(signals)
    .set({ status: "executed", decidedAt: new Date(), note: online ? "Demo sinyal — simüle edildi, MT5'e emir gönderilmedi" : "Demo modunda simüle edildi (ajan çevrimdışı)" })
    .where(eq(signals.id, s.id))
    .returning();
  return r;
}

export async function compileStrategy(userId: number, strategyId: number, autoFix = true) {
  const [st] = await db
    .select()
    .from(strategies)
    .where(and(eq(strategies.id, strategyId), eq(strategies.userId, userId)))
    .limit(1);
  if (!st) throw new Error("Strateji bulunamadı");

  if (await isAgentOnline(userId)) {
    const [job] = await db
      .insert(compileJobs)
      .values({ userId, strategyId, autoFix, status: "queued", source: "agent", log: "Ajan kuyruğuna alındı: metaeditor64.exe /compile bekleniyor..." })
      .returning();
    await db.update(strategies).set({ status: "queued" }).where(eq(strategies.id, strategyId));
    return job;
  }

  const fileName = st.filePath.split(/[\\/]/).pop() || "strategy.mq5";
  const provider = autoFix ? await getActiveProvider(userId) : null;
  let code = st.code;
  const log: string[] = ["[DEMO] Ajan çevrimdışı - statik sözdizimi denetimi çalıştırılıyor (gerçek derleme Python ajanında)."];
  let result = demoCompile(fileName, code);
  let attempt = 1;
  const maxAttempts = 3;
  log.push(`[Deneme ${attempt}]`, ...result.errors, ...result.warnings, `Result: ${result.errors.length} errors, ${result.warnings.length} warnings`);

  while (result.errors.length && autoFix && attempt < maxAttempts) {
    if (!provider) {
      log.push("[Otonom düzeltme] Aktif LLM sağlayıcısı yok - atlandı.");
      break;
    }
    try {
      log.push(`[Otonom düzeltme] ${provider.name} (${provider.model}) çağrılıyor...`);
      const out = await callLLM(provider, [
        { role: "system", content: "Sen uzman bir MQL5 geliştiricisisin. Sadece düzeltilmiş TAM .mq5 kodunu tek bir ```mql5 kod bloğu içinde döndür." },
        { role: "user", content: `Derleme hataları:\n${result.errors.join("\n")}\n\nKod:\n\`\`\`mql5\n${code}\n\`\`\`` },
      ], 45000);
      const fixed = extractCode(out);
      if (!fixed || fixed.length < 30) throw new Error("LLM boş kod döndürdü");
      code = fixed;
      attempt++;
      result = demoCompile(fileName, code);
      log.push(`[Deneme ${attempt}]`, ...result.errors, ...result.warnings, `Result: ${result.errors.length} errors, ${result.warnings.length} warnings`);
    } catch (e) {
      log.push(`[Otonom düzeltme] LLM erişilemedi: ${(e as Error).message.slice(0, 160)}`);
      break;
    }
  }

  const ok = result.errors.length === 0;
  if (ok) log.push(`${fileName.replace(/\.mq5$/i, ".ex5")} oluşturuldu (simülasyon).`);
  const [job] = await db
    .insert(compileJobs)
    .values({
      userId,
      strategyId,
      autoFix,
      status: ok ? "success" : "failed",
      attempt,
      maxAttempts,
      errors: result.errors.length,
      warnings: result.warnings.length,
      source: "demo",
      log: log.join("\n"),
      finishedAt: new Date(),
    })
    .returning();
  await db
    .update(strategies)
    .set({
      status: ok ? "compiled" : "error",
      lastCompiledAt: new Date(),
      code,
      version: code !== st.code ? st.version + 1 : st.version,
      updatedAt: new Date(),
    })
    .where(eq(strategies.id, strategyId));
  return job;
}
