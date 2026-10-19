"use client";

import { Badge, cx, fmtPrice } from "./ui";
import { RsiGauge, SymbolIcon } from "./hud";
import { categoryOf } from "@/lib/tf";
import type { RadarRowT } from "@/lib/types";

/** RSI · CCI radarı: hangi paritede RSI ve CCI birlikte (aşırı bölge / kesişim) sinyal veriyor. */
export default function RadarTable({
  rows, onSelect, selected, onlyActive = false, limit,
}: { rows: RadarRowT[]; onSelect?: (symbol: string, tf: string) => void; selected?: string; onlyActive?: boolean; limit?: number }) {
  let list = onlyActive ? rows.filter((r) => r.signal || r.tags.length) : rows;
  if (limit) list = list.slice(0, limit);
  if (!list.length)
    return (
      <div className="rounded-xl border border-dashed border-cyan-400/20 py-6 text-center text-sm text-slate-400">
        Şu an RSI / CCI uyumu veya kesişimi olan parite yok. İzlemeye devam ediyorum…
      </div>
    );
  return (
    <div className="scroll-thin overflow-x-auto">
      <table className="w-full min-w-[640px] text-sm">
        <thead>
          <tr className="text-left text-[10px] uppercase tracking-widest text-slate-500">
            <th className="pb-1.5">Parite</th><th>TF</th><th className="text-right">Fiyat</th><th>RSI</th><th>CCI</th><th>Durum</th><th className="text-right">Sinyal</th>
          </tr>
        </thead>
        <tbody>
          {list.map((r) => {
            const k = `${r.symbol}|${r.tf}`;
            return (
              <tr key={k} onClick={() => onSelect?.(r.symbol, r.tf)}
                className={cx("hud-row border-t border-slate-700/30", onSelect && "cursor-pointer", selected === k && "bg-cyan-400/10")}>
                <td className="py-1.5">
                  <span className="flex items-center gap-2 font-bold"><SymbolIcon symbol={r.symbol} category={categoryOf(r.symbol)} size={20} />{r.symbol}</span>
                </td>
                <td><Badge tone="slate">{r.tf}</Badge></td>
                <td className="num text-right text-slate-200">{fmtPrice(r.price)}</td>
                <td><RsiGauge value={r.rsi} os={r.cfg.os} ob={r.cfg.ob} /></td>
                <td className={cx("num font-bold", r.cciZone === "os" ? "text-emerald-300" : r.cciZone === "ob" ? "text-rose-300" : "text-slate-200")}>
                  {r.cci === null ? "—" : r.cci.toFixed(0)}
                </td>
                <td>
                  <div className="flex flex-wrap gap-1">
                    {r.tags.length ? r.tags.map((t) => <Badge key={t} tone={t.includes("altı") || t.includes("yukarı") ? "green" : "red"}>{t}</Badge>) : <span className="text-xs text-slate-500">nötr</span>}
                  </div>
                </td>
                <td className="text-right">
                  {r.signal ? (
                    <span className={cx("inline-flex items-center gap-1 rounded-md border px-2 py-0.5 text-xs font-black",
                      r.signal === "BUY" ? "border-emerald-400/50 bg-emerald-400/15 text-emerald-200" : "border-rose-400/50 bg-rose-400/15 text-rose-200")}>
                      {r.signal === "BUY" ? "▲ AL" : "▼ SAT"} <span className="text-[10px] opacity-70">{"●".repeat(Math.min(4, r.strength))}</span>
                    </span>
                  ) : <span className="text-xs text-slate-600">—</span>}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
