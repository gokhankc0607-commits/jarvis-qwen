"use client";

import { Badge, cx, fmtPrice } from "./ui";
import { SymbolIcon } from "./hud";
import { categoryOf } from "@/lib/tf";
import type { KanalItem } from "@/lib/kanal";

const checks = [
  ["brk", "BANT"], ["ext", "RSI BÖLGE"], ["ret", "DÖNÜŞ"], ["rsi", "RSI KESİŞİM"], ["cci", "CCI KESİŞİM"],
] as const;
function Step({ ok, label }: { ok: boolean; label: string }) {
  return <span className={cx("inline-flex items-center gap-1 rounded-md border px-1.5 py-0.5 text-[9px] font-black tracking-wide", ok ? "border-emerald-400/30 bg-emerald-400/10 text-emerald-200" : "border-slate-700/60 bg-slate-800/40 text-slate-500")}>
    <span>{ok ? "✓" : "○"}</span>{label}
  </span>;
}
function channelText(i: KanalItem) {
  if (i.checks.ret) return "Bant İçine Döndü";
  if (i.checks.brk && i.pos === "below") return "Alt Dışı Kapanış";
  if (i.checks.brk && i.pos === "above") return "Üst Dışı Kapanış";
  if (i.checks.brk && !i.checks.ret) return "Hâlâ Bant Dışında";
  return "Kanal İçinde / Kurulum Yok";
}
function signalText(i: KanalItem) {
  if (i.blockedReason) return "SİNYAL BLOKE";
  if (i.stage === 5) {
    if (i.rr !== null && i.rr < 1) return "R:R < 1 · BLOKE";
    return i.side === "BUY" ? "▲ AL" : "▼ SAT";
  }
  if (i.stage === 4) return i.side === "BUY" ? "ALIŞ BEKLİYOR · CCI" : "SATIŞ BEKLİYOR · CCI";
  if (i.stage === 3) return "RSI BEKLİYOR";
  if (i.stage === 2) return "DÖNÜŞ BEKLİYOR";
  return "NÖTR";
}

/** 5 aşamalı sıralı kurulum radarı. */
export default function KanalTable({
  items, limit, onlyActive = false, ruleSymbols, onAdd, onSelect,
}: {
  items: (KanalItem & { market?: string })[]; limit?: number; onlyActive?: boolean;
  rsiOb?: number; rsiOs?: number; minConf?: number; autoOn?: boolean;
  ruleSymbols?: string[]; onAdd?: (symbol: string, tf: string) => void; onSelect?: (symbol: string, tf: string) => void; showMarket?: boolean;
}) {
  let list = onlyActive ? items.filter((i) => i.stage >= 2 || i.fire) : items;
  if (limit) list = list.slice(0, limit);
  if (!list.length) return <div className="rounded-xl border border-dashed border-cyan-400/20 py-6 text-center text-sm text-slate-400">{items.length ? "Şu an aktif bir kurulum yok. İzlemeye devam ediyorum…" : "Henüz tarama verisi yok."}</div>;
  return <div className="scroll-thin overflow-x-auto">
    <table className="w-full min-w-[980px] text-sm">
      <thead><tr className="text-left text-[10px] uppercase tracking-widest text-slate-500">
        <th className="pb-2">Parite / TF / Fiyat</th><th>Kanal</th><th>5 aşamalı koşullar</th><th className="text-right">R:R / Güven</th><th className="text-right">Sinyal</th>
      </tr></thead>
      <tbody>{list.map((i) => {
        const inRules = ruleSymbols?.includes(i.symbol.toUpperCase());
        const label = signalText(i);
        const final = i.stage === 5 && !(i.rr !== null && i.rr < 1);
        return <tr key={`${i.symbol}|${i.tf}`} onClick={() => onSelect?.(i.symbol, i.tf)} className={cx("hud-row border-t border-slate-700/30", onSelect && "cursor-pointer", i.fire && "bg-amber-400/5")}>
          <td className="py-2"><div className="flex items-center gap-2 font-bold"><SymbolIcon symbol={i.symbol} category={i.market === "crypto" ? "crypto" : categoryOf(i.symbol)} size={20}/><span>{i.symbol}<span className="ml-2 rounded bg-slate-800 px-1.5 py-0.5 text-[10px] text-slate-300">{i.tf}</span><span className="ml-2 num text-xs text-slate-400">{fmtPrice(i.price)}</span></span></div></td>
          <td><span className={cx("text-xs font-bold", i.checks.brk ? i.side === "SELL" ? "text-rose-300" : "text-emerald-300" : "text-slate-500")}>{channelText(i)}</span></td>
          <td><div className="flex flex-wrap gap-1">{checks.map(([key, title]) => <Step key={key} ok={i.checks[key]} label={title}/>)}</div>
            {i.guppyOk !== null && i.guppyOk !== undefined && <span className={cx("mt-1 inline-flex items-center gap-1 rounded-md border px-1.5 py-0.5 text-[9px] font-black tracking-wide", i.guppyOk ? "border-emerald-400/30 bg-emerald-400/10 text-emerald-200" : "border-rose-400/40 bg-rose-400/10 text-rose-200")} title="Guppy GMMA OSC giriş teyidi (KANAL ayarları → gelişmiş)"><span>{i.guppyOk ? "✓" : "✕"}</span>GUPPY OSC{!i.guppyOk && i.stage === 5 ? " · BLOKE" : ""}</span>}
            {(i.guppyExit === "cross" || i.guppyExit === "zone") && <span className="mt-1 ml-1 inline-flex items-center gap-1 rounded-md border border-amber-400/40 bg-amber-400/10 px-1.5 py-0.5 text-[9px] font-black tracking-wide text-amber-200" title="Guppy GMMA OSC çıkış teyidi: sinyal yönü zayıfladı — açık pozisyonda kapatma düşünülebilir">{i.guppyExit === "cross" ? "↯" : "◌"} GUPPY ÇIKIŞ</span>}
          </td>
          <td className="text-right"><span className="block num text-xs text-slate-300">{i.rr === null ? "—" : `1:${i.rr.toFixed(2)}`}</span><span className="text-[10px] text-slate-500">{i.rr === null ? "" : i.rr < 1.5 ? "Düşük güven" : i.rr < 2 ? "Normal güven" : "Güçlü güven"}{i.confidence ? ` · %${i.confidence}` : ""}</span></td>
          <td className="text-right"><span className={cx("inline-flex rounded-md border px-2 py-1 text-[10px] font-black", final ? i.side === "BUY" ? "border-emerald-400/50 bg-emerald-400/15 text-emerald-200" : "border-rose-400/50 bg-rose-400/15 text-rose-200" : i.stage === 5 ? "border-rose-500/30 bg-rose-500/10 text-rose-300" : i.stage ? "border-slate-600/50 bg-slate-800/50 text-slate-300" : "border-slate-700/30 text-slate-600")}>{label}</span>
            {onAdd && ruleSymbols && !inRules && <button onClick={(e) => { e.stopPropagation(); onAdd(i.symbol, i.tf); }} className="ml-1 rounded border border-cyan-400/30 px-1.5 py-0.5 text-[10px] font-bold text-cyan-300 hover:bg-cyan-400/10" title="Grafik izleme listesine ekle">+ grafik</button>}
          </td>
        </tr>;
      })}</tbody>
    </table>
  </div>;
}
