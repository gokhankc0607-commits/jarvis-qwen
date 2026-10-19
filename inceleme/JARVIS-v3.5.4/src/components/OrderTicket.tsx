"use client";

import { useEffect, useMemo, useState } from "react";
import { Badge, Button, Field, Modal, api, cx, fmtPrice } from "./ui";
import { FlashNum } from "./hud";
import { pipSize } from "@/lib/sim";
import { categoryOf } from "@/lib/tf";
import type { MarketT, QuoteT, Signal } from "@/lib/types";

const DEF: Record<string, [number, number]> = { forex: [30, 60], metals: [150, 300], crypto: [300, 600], indices: [40, 90], commodities: [60, 120], stocks: [50, 100] };

type Result = { state: "sending" | "waiting" | "ok" | "fail"; text: string };

/** Hızlı Emir: güncel fiyatla AL/SAT. İki adımlı: özet → "Emri gönder" (açık onay). Ajan gönderimden önce yeniden doğrular. */
export default function OrderTicket({ open, onClose, defaultSymbol, algoOff }: { open: boolean; onClose: () => void; defaultSymbol?: string; algoOff?: boolean }) {
  const [quotes, setQuotes] = useState<QuoteT[]>([]);
  const [live, setLive] = useState(false);
  const [symbol, setSymbol] = useState(defaultSymbol ?? "");
  const [side, setSide] = useState<"BUY" | "SELL">("BUY");
  const [lot, setLot] = useState("0.10");
  const [mode, setMode] = useState<"pips" | "price">("pips");
  const [slPips, setSlPips] = useState("30");
  const [tpPips, setTpPips] = useState("60");
  const [slPx, setSlPx] = useState("");
  const [tpPx, setTpPx] = useState("");
  const [step, setStep] = useState<"form" | "confirm">("form");
  const [res, setRes] = useState<Result | null>(null);
  const [err, setErr] = useState("");

  useEffect(() => {
    if (!open) return;
    setStep("form"); setRes(null); setErr("");
    let dead = false;
    const load = () => api<MarketT>("/api/market").then((m) => { if (!dead) { setQuotes(m.quotes); setLive(m.live); } }).catch(() => {});
    load();
    const iv = setInterval(load, 1500);
    return () => { dead = true; clearInterval(iv); };
  }, [open]);

  useEffect(() => { if (open && defaultSymbol) setSymbol(defaultSymbol); }, [open, defaultSymbol]);
  useEffect(() => { if (open && !symbol && quotes.length) setSymbol(quotes[0].symbol); }, [open, symbol, quotes]);
  useEffect(() => {
    const d = DEF[categoryOf(symbol || "EURUSD")] ?? DEF.forex;
    setSlPips(String(d[0])); setTpPips(String(d[1]));
  }, [symbol]);

  const q = quotes.find((x) => x.symbol === symbol.toUpperCase());
  const price = q ? (side === "BUY" ? q.ask ?? q.price : q.bid ?? q.price) : null;
  const pip = pipSize(symbol || "EURUSD");
  const dg = q?.digits ?? (price && price > 1000 ? 2 : price && price > 50 ? 3 : 5);

  const calc = useMemo(() => {
    if (price === null) return { sl: null as number | null, tp: null as number | null };
    if (mode === "pips") {
      const s = Number(slPips), t = Number(tpPips);
      return {
        sl: s > 0 ? (side === "BUY" ? price - s * pip : price + s * pip) : null,
        tp: t > 0 ? (side === "BUY" ? price + t * pip : price - t * pip) : null,
      };
    }
    return { sl: Number(slPx) > 0 ? Number(slPx) : null, tp: Number(tpPx) > 0 ? Number(tpPx) : null };
  }, [price, mode, slPips, tpPips, slPx, tpPx, side, pip]);

  const warn: string[] = [];
  if (price !== null) {
    const bad = (v: number | null, kind: "SL" | "TP") => v !== null && (kind === "SL" ? (side === "BUY" ? v >= price : v <= price) : side === "BUY" ? v <= price : v >= price);
    if (bad(calc.sl, "SL")) warn.push(`SL yanlış tarafta: ${side === "BUY" ? "AL" : "SAT"} emrinde SL fiyatın ${side === "BUY" ? "altında" : "üstünde"} olmalı.`);
    if (bad(calc.tp, "TP")) warn.push(`TP yanlış tarafta: ${side === "BUY" ? "AL" : "SAT"} emrinde TP fiyatın ${side === "BUY" ? "üstünde" : "altında"} olmalı.`);
    if (q?.minDist != null) {
      if (calc.sl !== null && Math.abs(price - calc.sl) < q.minDist) warn.push(`SL, brokerın minimum mesafesinden (${q.minDist.toFixed(dg)}) yakın — ajan otomatik uzatır.`);
      if (calc.tp !== null && Math.abs(price - calc.tp) < q.minDist) warn.push(`TP, brokerın minimum mesafesinden (${q.minDist.toFixed(dg)}) yakın — ajan otomatik uzatır.`);
    }
  }
  const hardErr = warn.some((w) => w.includes("yanlış tarafta"));
  const rr = calc.sl && calc.tp && price ? Math.abs(calc.tp - price) / Math.abs(price - calc.sl) : null;
  const noPrice = live && (!q || q.bid === null);
  const stale = q && q.stale > 120;

  const send = async () => {
    setRes({ state: "sending", text: "Emir hazırlanıyor…" });
    try {
      const body = { symbol, side, volume: Number(lot), ...(mode === "pips" ? { slPips: Number(slPips) || undefined, tpPips: Number(tpPips) || undefined } : { sl: Number(slPx) || undefined, tp: Number(tpPx) || undefined }) };
      const out = await api<Signal & { live: boolean }>("/api/orders", { body });
      if (out.status === "executed") return setRes({ state: "ok", text: `✓ ${out.note || "Demo emir açıldı"}` });
      setRes({ state: "waiting", text: "Ajana iletildi — MT5 yanıtı bekleniyor…" });
      for (let i = 0; i < 25; i++) {
        await new Promise((r) => setTimeout(r, 1000));
        const list = await api<Signal[]>("/api/signals");
        const me = list.find((x) => x.id === out.id);
        if (me?.status === "executed") return setRes({ state: "ok", text: `✓ ${me.note}` });
        if (me?.status === "failed") return setRes({ state: "fail", text: `✗ ${me.note}` });
      }
      setRes({ state: "fail", text: "Ajandan yanıt gelmedi (25 sn). Ajan penceresi açık mı, hangi sürümde? Signals sayfasından durumu görebilirsiniz." });
    } catch (e) {
      setRes({ state: "fail", text: (e as Error).message });
    }
  };

  const reset = () => { setStep("form"); setRes(null); setErr(""); };
  const f = (v: number | null) => (v === null ? "—" : v.toFixed(dg));

  return (
    <Modal open={open} onClose={onClose} title="Hızlı Emir">
      <div className="space-y-3">
        {algoOff && <div className="rounded-lg border border-rose-400/40 bg-rose-500/10 p-2.5 text-xs text-rose-200">MT5&apos;te <b>Algo Trading KAPALI</b> — emir gönderilemez. Üst çubuktaki Algo Trading düğmesini yeşil yapın.</div>}
        {!live && <div className="rounded-lg border border-amber-400/30 bg-amber-400/5 p-2.5 text-xs text-amber-200">Demo modu: emir <b>simüle</b> edilir, gerçek hesapta işlem açılmaz.</div>}

        {step === "form" && (
          <>
            <Field label="Parite">
              <input className="input !text-base font-bold" list="oq" value={symbol} onChange={(e) => setSymbol(e.target.value.toUpperCase())} />
              <datalist id="oq">{quotes.map((x) => <option key={x.symbol} value={x.symbol} />)}</datalist>
            </Field>
            <div className="grid grid-cols-2 gap-2">
              {(["SELL", "BUY"] as const).map((sd) => {
                const px = q ? (sd === "BUY" ? q.ask ?? q.price : q.bid ?? q.price) : null;
                return (
                  <button key={sd} onClick={() => setSide(sd)} className={cx("rounded-xl border p-3 text-center transition", side === sd ? (sd === "BUY" ? "border-emerald-400 bg-emerald-400/20 shadow-[0_0_20px_-4px_rgba(52,211,153,0.8)]" : "border-rose-400 bg-rose-400/20 shadow-[0_0_20px_-4px_rgba(251,113,133,0.8)]") : "border-slate-600/40 opacity-70 hover:opacity-100")}>
                    <div className={cx("text-xs font-black tracking-widest", sd === "BUY" ? "text-emerald-300" : "text-rose-300")}>{sd === "BUY" ? "AL · ASK" : "SAT · BID"}</div>
                    <FlashNum value={px} className="num block text-xl font-bold text-white">{px === null ? "—" : fmtPrice(px)}</FlashNum>
                  </button>
                );
              })}
            </div>
            {noPrice && <div className="rounded-lg bg-amber-400/10 p-2 text-xs text-amber-200">Bu parite için canlı fiyat yok. Sembol MT5 Piyasa Gözlemi&apos;nde olmalı ve ajan çalışmalı.</div>}
            {stale && <div className="rounded-lg bg-amber-400/10 p-2 text-xs text-amber-200">Fiyat {Math.round(q!.stale)} sn&apos;dir değişmiyor — piyasa kapalı olabilir; emir reddedilebilir.</div>}

            <div className="grid grid-cols-[1fr_auto] items-end gap-2">
              <Field label="Lot"><input className="input" value={lot} onChange={(e) => setLot(e.target.value)} /></Field>
              <div className="flex gap-1 pb-0.5">{["0.01", "0.05", "0.10", "0.50"].map((v) => <button key={v} onClick={() => setLot(v)} className="rounded-md border border-slate-600/40 px-2 py-2 text-xs text-slate-300 hover:text-cyan-200">{v}</button>)}</div>
            </div>

            <div className="flex gap-1.5 text-xs">
              {(["pips", "price"] as const).map((m) => <button key={m} onClick={() => setMode(m)} className={cx("rounded-md border px-2.5 py-1 font-bold", mode === m ? "border-cyan-400/60 bg-cyan-400/15 text-cyan-100" : "border-slate-600/40 text-slate-400")}>{m === "pips" ? "SL/TP mesafe (pip)" : "SL/TP fiyat"}</button>)}
              <span className="ml-auto self-center text-slate-500">1 pip = {pip}</span>
            </div>
            <div className="grid grid-cols-2 gap-2">
              {mode === "pips" ? (
                <>
                  <Field label="SL (pip)"><input className="input" value={slPips} onChange={(e) => setSlPips(e.target.value)} /></Field>
                  <Field label="TP (pip)"><input className="input" value={tpPips} onChange={(e) => setTpPips(e.target.value)} /></Field>
                </>
              ) : (
                <>
                  <Field label="SL fiyatı"><input className="input" value={slPx} onChange={(e) => setSlPx(e.target.value)} /></Field>
                  <Field label="TP fiyatı"><input className="input" value={tpPx} onChange={(e) => setTpPx(e.target.value)} /></Field>
                </>
              )}
            </div>
            <div className="num flex flex-wrap gap-x-4 gap-y-1 rounded-lg bg-black/30 px-3 py-2 text-xs text-slate-300">
              <span>Giriş ≈ <b className="text-white">{f(price)}</b></span><span>SL <b className="text-rose-300">{f(calc.sl)}</b></span><span>TP <b className="text-emerald-300">{f(calc.tp)}</b></span>
              {rr !== null && <span>R:R <b className="text-cyan-200">1:{rr.toFixed(1)}</b></span>}
            </div>
            {warn.map((w) => <div key={w} className={cx("rounded-lg p-2 text-xs", w.includes("yanlış") ? "bg-rose-500/10 text-rose-200" : "bg-amber-400/10 text-amber-200")}>{w}</div>)}
            {err && <div className="rounded-lg bg-rose-500/10 p-2 text-xs text-rose-200">{err}</div>}
            <div className="flex justify-end gap-2">
              <Button variant="ghost" onClick={onClose}>Vazgeç</Button>
              <Button disabled={!symbol || price === null || hardErr || !(Number(lot) > 0) || noPrice || !!algoOff} onClick={() => setStep("confirm")}>Özete geç →</Button>
            </div>
          </>
        )}

        {step === "confirm" && (
          <>
            <div className={cx("rounded-xl border p-4", side === "BUY" ? "border-emerald-400/40 bg-emerald-400/5" : "border-rose-400/40 bg-rose-400/5")}>
              <div className="text-xs font-bold tracking-widest text-slate-400">EMİR ÖZETİ</div>
              <div className="mt-1 text-2xl font-black"><span className={side === "BUY" ? "text-emerald-300" : "text-rose-300"}>{side === "BUY" ? "AL" : "SAT"}</span> {symbol} <span className="num text-lg text-slate-200">{Number(lot).toFixed(2)} lot</span></div>
              <div className="num mt-2 grid grid-cols-3 gap-2 text-sm"><div><div className="text-[10px] text-slate-500">GİRİŞ (≈)</div>{f(price)}</div><div><div className="text-[10px] text-slate-500">SL</div><span className="text-rose-300">{f(calc.sl)}</span></div><div><div className="text-[10px] text-slate-500">TP</div><span className="text-emerald-300">{f(calc.tp)}</span></div></div>
            </div>
            <div className="rounded-lg bg-black/30 p-2.5 text-xs text-slate-300">
              {live ? <>Bu emir <b className="text-amber-200">gerçek hesabınızda</b> (MT5) işlem açar. Fiyat/SL/TP gönderimden hemen önce MT5&apos;ten yeniden doğrulanır.</> : "Demo: yalnızca simüle edilir."}
              <br />“Emri gönder”e basmanız açık onayınızdır.
            </div>
            {res && (
              <div className={cx("rounded-lg border p-3 text-sm", res.state === "ok" ? "border-emerald-400/40 bg-emerald-400/10 text-emerald-200" : res.state === "fail" ? "border-rose-400/40 bg-rose-500/10 text-rose-200" : "border-cyan-400/30 bg-cyan-400/5 text-cyan-100")}>{res.text}</div>
            )}
            <div className="flex justify-end gap-2">
              {res?.state === "ok" ? <Button onClick={onClose}>Kapat</Button> : (
                <>
                  <Button variant="ghost" onClick={reset} disabled={res?.state === "sending" || res?.state === "waiting"}>← Geri</Button>
                  <Button variant={side === "BUY" ? "success" : "danger"} loading={res?.state === "sending" || res?.state === "waiting"} onClick={send}>{res?.state === "fail" ? "↻ Tekrar dene" : "Emri gönder"}</Button>
                </>
              )}
            </div>
          </>
        )}
      </div>
    </Modal>
  );
}
