"use client";

import { useState } from "react";
import { Badge, Button, Empty, Field, Modal, api, cx, fmtNum, fmtPrice, timeAgo, useToast } from "./ui";
import { MarketBadge, TfBadge } from "./hud";
import type { Trade } from "@/lib/types";

type TradeX = Trade & { commandId?: number; queued?: boolean };

/**
 * Açık işlemler paneli (ortak): ½ Kapat · SL→Giriş · ✎ SL/TP · Kapat.
 * Canlıda komutlar MT5 / borsaya gider; sonuç bildirim olarak gösterilir.
 */
export default function OpenTradesPanel({
  trades, onChanged, highlightSymbol, market, compact = false,
}: { trades: Trade[]; onChanged: () => void; highlightSymbol?: string | null; market?: "forex" | "crypto" | "all"; compact?: boolean }) {
  const toast = useToast();
  const [edit, setEdit] = useState<Trade | null>(null);
  const [busy, setBusy] = useState<number | null>(null);
  const list = trades.filter((t) => t.status !== "closed" && (!market || market === "all" || (t.market ?? "forex") === market));
  const floating = list.reduce((s, t) => s + t.pnl, 0);

  const follow = async (commandId: number | undefined, okText: string) => {
    if (!commandId) { toast(okText); onChanged(); return; }
    toast("MT5 / borsaya gönderildi…", "info");
    for (let i = 0; i < 20; i++) {
      await new Promise((r) => setTimeout(r, 1000));
      const c = await api<{ status: string; note: string }>(`/api/commands/${commandId}`).catch(() => null);
      if (c?.status === "done") { toast(`✓ ${okText} · ${c.note}`); onChanged(); return; }
      if (c?.status === "failed") { toast(`✗ ${c.note}`, "err"); onChanged(); return; }
    }
    toast("Yanıt gelmedi — ajan penceresini kontrol edin", "err");
    onChanged();
  };
  const act = async (t: Trade, body: Record<string, unknown>, okText: string, confirmText?: string) => {
    if (confirmText && !confirm(confirmText)) return;
    setBusy(t.id);
    try {
      const r = await api<TradeX>(`/api/trades/${t.id}`, { method: "PATCH", body });
      await follow(r.queued ? r.commandId : undefined, okText);
    } catch (e) { toast((e as Error).message, "err"); }
    setBusy(null);
  };
  const saveEdit = async () => {
    if (!edit) return;
    const t = edit;
    setEdit(null);
    await act(t, { sl: t.sl, tp: t.tp }, `${t.symbol} SL/TP güncellendi`);
  };

  return (
    <div>
      <div className="mb-2 flex items-center justify-between text-xs text-slate-400">
        <span>{list.length} açık işlem{market && market !== "all" ? ` · ${market === "crypto" ? "🪙 kripto" : "💱 forex"}` : ""}</span>
        <span className={cx("num text-sm font-bold", floating >= 0 ? "text-emerald-300" : "text-rose-300")}>Toplam {floating >= 0 ? "+" : ""}{fmtNum(floating)}</span>
      </div>
      {list.length === 0 ? <Empty icon="⇅" title="Açık işlem yok" hint="Onayladığın sinyaller ve verdiğin emirler burada görünür." /> : (
        <div className="scroll-thin overflow-x-auto">
          <table className="w-full min-w-[980px] text-[12.5px]">
            <thead>
              <tr className="text-left text-[10px] uppercase tracking-widest text-slate-500">
                <th className="pb-1.5">Sembol</th><th>Piyasa</th><th>TF</th><th>Yön</th><th className="text-right">Miktar</th><th className="text-right">Giriş</th><th className="text-right">Güncel</th><th className="text-right">SL</th><th className="text-right">TP</th><th className="text-right">K/Z</th>{!compact && <th>Açılış</th>}<th className="text-right">İşlem</th>
              </tr>
            </thead>
            <tbody className="num">
              {list.map((t) => {
                const hl = highlightSymbol && t.symbol.toUpperCase() === highlightSymbol.toUpperCase();
                const prog = t.tp && t.openPrice !== t.tp ? ((t.side === "BUY" ? t.currentPrice - t.openPrice : t.openPrice - t.currentPrice) / Math.abs(t.tp - t.openPrice)) * 100 : null;
                const atBe = !!t.sl && (t.side === "BUY" ? t.sl >= t.openPrice : t.sl <= t.openPrice);
                return (
                  <tr key={t.id} className={cx("border-t border-slate-700/30 hover:bg-cyan-400/5", hl && "bg-cyan-400/10")}>
                    <td className="py-1.5 font-bold" style={{ fontFamily: "Rajdhani" }}>{t.symbol}{t.status === "closing" && <Badge tone="violet">kapatılıyor</Badge>}</td>
                    <td><MarketBadge market={t.market} /></td>
                    <td><TfBadge tf={t.timeframe} comment={t.comment} /></td>
                    <td><Badge tone={t.side === "BUY" ? "green" : "red"}>{t.side}</Badge></td>
                    <td className="text-right">{t.volume}</td>
                    <td className="text-right">{fmtPrice(t.openPrice)}</td>
                    <td className="text-right text-cyan-200">{fmtPrice(t.currentPrice)}</td>
                    <td className={cx("text-right", atBe ? "text-emerald-300" : "text-slate-400")} title={atBe ? "SL girişte (risksiz)" : ""}>{fmtPrice(t.sl)}{atBe && " 🛡"}</td>
                    <td className="text-right text-slate-400">{fmtPrice(t.tp)}{prog !== null && <span className="ml-1 text-[10px] text-slate-500">%{Math.max(-99, Math.min(199, Math.round(prog)))}</span>}</td>
                    <td className={cx("text-right font-bold", t.pnl >= 0 ? "text-emerald-300" : "text-rose-300")}>{t.pnl >= 0 ? "+" : ""}{fmtNum(t.pnl)}</td>
                    {!compact && <td className="text-xs text-slate-500" style={{ fontFamily: "Rajdhani" }}>{timeAgo(t.openedAt)}</td>}
                    <td className="whitespace-nowrap text-right">
                      {t.status === "open" ? (
                        <span className="inline-flex gap-1">
                          <Button size="sm" variant="ghost" title="Yarı kâr al: miktarın yarısını kapat" loading={busy === t.id} onClick={() => act(t, { action: "partial", fraction: 0.5 }, `${t.symbol} yarı kâr alındı`, `${t.symbol}: ${t.volume} miktarın YARISI kapatılsın mı?`)}>½ Kapat</Button>
                          <Button size="sm" variant="ghost" title="SL'yi giriş fiyatına çek (risksiz)" disabled={atBe} loading={busy === t.id} onClick={() => act(t, { action: "breakeven" }, `${t.symbol} SL girişe çekildi`)}>SL→Giriş</Button>
                          <Button size="sm" variant="ghost" title="SL / TP düzenle" onClick={() => setEdit({ ...t })}>✎ SL/TP</Button>
                          <Button size="sm" variant="danger" title="Pozisyonu kapat" loading={busy === t.id} onClick={() => act(t, { action: "close" }, `${t.symbol} kapatıldı`, `#${t.ticket} ${t.symbol} kapatılsın mı?`)}>Kapat</Button>
                        </span>
                      ) : <span className="text-xs text-slate-500">…</span>}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
      <Modal open={!!edit} onClose={() => setEdit(null)} title={`#${edit?.ticket ?? ""} ${edit?.symbol ?? ""} · SL / TP (MT5 / borsaya gönderilir)`}>
        {edit && (
          <div className="grid grid-cols-2 gap-3">
            <Field label="Stop Loss" hint={edit.side === "BUY" ? "Fiyatın altında olmalı" : "Fiyatın üstünde olmalı"}><input className="input num" value={edit.sl ?? ""} onChange={(e) => setEdit({ ...edit, sl: e.target.value === "" ? null : Number(e.target.value) })} /></Field>
            <Field label="Take Profit" hint={edit.side === "BUY" ? "Fiyatın üstünde olmalı" : "Fiyatın altında olmalı"}><input className="input num" value={edit.tp ?? ""} onChange={(e) => setEdit({ ...edit, tp: e.target.value === "" ? null : Number(e.target.value) })} /></Field>
            <div className="col-span-2 text-xs text-slate-400">Güncel fiyat <b className="num text-slate-200">{fmtPrice(edit.currentPrice)}</b> · giriş <b className="num text-slate-200">{fmtPrice(edit.openPrice)}</b> · boş bırakmak = kaldır</div>
            <div className="col-span-2 flex justify-end gap-2"><Button variant="ghost" onClick={() => setEdit(null)}>İptal</Button><Button onClick={saveEdit}>Gönder</Button></div>
          </div>
        )}
      </Modal>
    </div>
  );
}
