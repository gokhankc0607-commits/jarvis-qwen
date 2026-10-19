"use client";

import { useState } from "react";
import { Badge, Button, Card, Empty, Field, Modal, PageHeader, Skeleton, api, cx, useList, useToast } from "./ui";
import { SymbolIcon } from "./hud";
import { TFS, categoryOf, joinTfs, parseTfs } from "@/lib/tf";
import type { Rule } from "@/lib/types";

const POPULAR = ["EURUSD", "GBPUSD", "USDJPY", "XAUUSD", "BTCUSD", "ETHUSD", "US30", "US100", "GER40", "GBPJPY"];
const TF_LABEL: Record<string, string> = { M1: "1dk", M5: "5dk", M15: "15dk", M30: "30dk", H1: "1sa", H4: "4sa", D1: "Günlük" };

function TfChips({ value, onChange, size = "md" }: { value: string[]; onChange: (v: string[]) => void; size?: "sm" | "md" }) {
  return (
    <div className="flex flex-wrap gap-1.5">
      {TFS.map((tf) => {
        const on = value.includes(tf);
        return (
          <button
            key={tf}
            type="button"
            onClick={() => {
              if (on && value.length === 1) return; // en az bir zaman dilimi
              onChange(on ? value.filter((x) => x !== tf) : [...value, tf]);
            }}
            title={TF_LABEL[tf]}
            className={cx(
              "rounded-lg border font-bold transition",
              size === "sm" ? "px-2.5 py-1 text-xs" : "px-3 py-1.5 text-sm",
              on ? "border-cyan-400/70 bg-cyan-400/20 text-cyan-100 shadow-[0_0_14px_-3px_rgba(34,211,238,0.8)]" : "border-slate-600/40 text-slate-400 hover:border-cyan-400/40 hover:text-cyan-200"
            )}
          >
            {tf}
          </button>
        );
      })}
    </div>
  );
}

type Adv = Pick<Rule, "rsiPeriod" | "rsiOverbought" | "rsiOversold" | "cciPeriod" | "cciLevel" | "lotSize" | "slPips" | "tpPips" | "stochEnabled" | "useDivergence">;
const ADV_DEFAULT: Adv = { rsiPeriod: 14, rsiOverbought: 70, rsiOversold: 30, cciPeriod: 20, cciLevel: 100, lotSize: 0.1, slPips: 30, tpPips: 60, stochEnabled: true, useDivergence: true };

export default function RulesView() {
  const toast = useToast();
  const { data, setData } = useList<Rule>("/api/rules");
  const [symbol, setSymbol] = useState("");
  const [tfs, setTfs] = useState<string[]>(["M15", "H1"]);
  const [lot, setLot] = useState("0.1");
  const [adding, setAdding] = useState(false);
  const [edit, setEdit] = useState<(Adv & { id: number; symbol: string }) | null>(null);
  const [saving, setSaving] = useState(false);

  const add = async () => {
    const sym = symbol.trim().toUpperCase();
    if (!sym) return toast("Parite adı yazın (örn. EURUSD)", "err");
    setAdding(true);
    try {
      const r = await api<Rule>("/api/rules", { body: { symbol: sym, timeframes: tfs, lotSize: Number(lot) || 0.1 } });
      setData((d) => [...(d ?? []), r]);
      setSymbol("");
      toast(`${sym} izlemeye alındı · ${tfs.join(", ")}`);
    } catch (e) { toast((e as Error).message, "err"); }
    setAdding(false);
  };

  const patch = async (r: Rule, body: Record<string, unknown>, optimistic: Partial<Rule>) => {
    const prev = data;
    setData((d) => d?.map((x) => (x.id === r.id ? { ...x, ...optimistic } : x)) ?? d);
    try {
      const res = await api<Rule>(`/api/rules/${r.id}`, { method: "PATCH", body });
      setData((d) => d?.map((x) => (x.id === r.id ? res : x)) ?? d);
    } catch (e) { setData(prev); toast((e as Error).message, "err"); }
  };

  const del = async (r: Rule) => {
    if (!confirm(`${r.symbol} izlemeden çıkarılsın mı?`)) return;
    const prev = data;
    setData((d) => d?.filter((x) => x.id !== r.id) ?? d);
    try { await api(`/api/rules/${r.id}`, { method: "DELETE" }); toast("Silindi"); } catch (e) { setData(prev); toast((e as Error).message, "err"); }
  };

  const saveEdit = async () => {
    if (!edit) return;
    setSaving(true);
    try {
      const { id, symbol: _s, ...body } = edit;
      void _s;
      const r = await api<Rule>(`/api/rules/${id}`, { method: "PATCH", body });
      setData((d) => d?.map((x) => (x.id === r.id ? r : x)) ?? d);
      setEdit(null);
      toast("Ayarlar kaydedildi");
    } catch (e) { toast((e as Error).message, "err"); }
    setSaving(false);
  };

  const n = (k: keyof Adv) => (
    <input className="input" type="number" step="any" value={String(edit?.[k] ?? "")} onChange={(e) => setEdit((f) => (f ? { ...f, [k]: Number(e.target.value) } : f))} />
  );
  const chk = (k: "stochEnabled" | "useDivergence", label: string) => (
    <label className="flex items-center gap-2 text-sm text-slate-300">
      <input type="checkbox" className="accent-cyan-400" checked={!!edit?.[k]} onChange={(e) => setEdit((f) => (f ? { ...f, [k]: e.target.checked } : f))} /> {label}
    </label>
  );

  return (
    <div>
      <PageHeader title="İZLEME KURALLARI" sub="Bir parite ekle, izlemek istediğin zaman dilimlerini işaretle. JARVIS RSI/CCI'yı hepsinde tarar, grafikte ve radarda gösterir." />

      {/* Hızlı ekleme */}
      <Card title="Parite Ekle" icon="＋" className="mb-5">
        <div className="grid gap-4 md:grid-cols-[minmax(0,260px)_minmax(0,1fr)_110px_auto] md:items-end">
          <Field label="Parite">
            <input className="input !text-base font-bold" list="pairs" value={symbol} onChange={(e) => setSymbol(e.target.value.toUpperCase())} placeholder="EURUSD" onKeyDown={(e) => e.key === "Enter" && add()} />
            <datalist id="pairs">{POPULAR.map((p) => <option key={p} value={p} />)}</datalist>
          </Field>
          <Field label="Zaman dilimleri (birden fazla seçebilirsin)"><TfChips value={tfs} onChange={setTfs} /></Field>
          <Field label="Lot"><input className="input" value={lot} onChange={(e) => setLot(e.target.value)} /></Field>
          <Button onClick={add} loading={adding} className="h-[38px]">+ Ekle</Button>
        </div>
        <div className="mt-3 flex flex-wrap items-center gap-1.5 text-xs text-slate-500">
          hızlı seç:
          {POPULAR.map((p) => (
            <button key={p} onClick={() => setSymbol(p)} className={cx("rounded-md border px-2 py-0.5 font-semibold", symbol === p ? "border-cyan-400/60 text-cyan-200" : "border-slate-600/40 text-slate-400 hover:text-cyan-200")}>{p}</button>
          ))}
        </div>
      </Card>

      {!data ? <Card><Skeleton rows={4} /></Card> : data.length === 0 ? (
        <Card><Empty icon="◈" title="Henüz izlenen parite yok" hint="Yukarıdan bir parite yazın, zaman dilimlerini seçin ve Ekle'ye basın." /></Card>
      ) : (
        <div className="grid gap-3 md:grid-cols-2 2xl:grid-cols-3">
          {data.map((r) => {
            const list = parseTfs(r.timeframe);
            return (
              <div key={r.id} className={cx("glass glass-hover fade-up rounded-2xl p-4 transition", !r.enabled && "opacity-60")}>
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2.5">
                    <SymbolIcon symbol={r.symbol} category={categoryOf(r.symbol)} size={30} />
                    <div>
                      <div className="text-xl font-bold leading-none" style={{ fontFamily: "JetBrains Mono" }}>{r.symbol}</div>
                      <div className="mt-1 text-[11px] text-slate-500">{list.length} zaman dilimi izleniyor</div>
                    </div>
                  </div>
                  <button onClick={() => patch(r, { enabled: !r.enabled }, { enabled: !r.enabled })} title={r.enabled ? "Sinyal taramasını durdur" : "Sinyal taramasını başlat"}
                    className={cx("relative h-6 w-11 rounded-full border transition", r.enabled ? "border-cyan-400/60 bg-cyan-400/30" : "border-slate-600 bg-slate-800")}>
                    <span className={cx("absolute top-0.5 h-[18px] w-[18px] rounded-full transition-all", r.enabled ? "left-[22px] bg-cyan-200 shadow-[0_0_10px_rgba(34,211,238,0.9)]" : "left-0.5 bg-slate-400")} />
                  </button>
                </div>

                <div className="mt-3">
                  <TfChips size="sm" value={list} onChange={(v) => patch(r, { timeframes: v }, { timeframe: joinTfs(v) })} />
                </div>

                <div className="mt-3 flex flex-wrap gap-1.5 text-[11px]">
                  <Badge tone="violet">RSI {r.rsiOversold}/{r.rsiOverbought}</Badge>
                  <Badge tone="cyan">CCI ±{r.cciLevel}</Badge>
                  <Badge tone="slate">Lot {r.lotSize}</Badge>
                  <Badge tone="slate">SL {r.slPips} · TP {r.tpPips}</Badge>
                </div>

                <div className="mt-3 flex justify-end gap-2">
                  <Button size="sm" variant="ghost" onClick={() => setEdit({ id: r.id, symbol: r.symbol, rsiPeriod: r.rsiPeriod, rsiOverbought: r.rsiOverbought, rsiOversold: r.rsiOversold, cciPeriod: r.cciPeriod, cciLevel: r.cciLevel, lotSize: r.lotSize, slPips: r.slPips, tpPips: r.tpPips, stochEnabled: r.stochEnabled, useDivergence: r.useDivergence })}>⚙ Gelişmiş</Button>
                  <Button size="sm" variant="ghost" onClick={() => del(r)}>🗑</Button>
                </div>
              </div>
            );
          })}
        </div>
      )}

      <Modal open={!!edit} onClose={() => setEdit(null)} title={`${edit?.symbol ?? ""} · Gelişmiş Ayarlar`}>
        {edit && (
          <div className="space-y-4">
            <p className="text-xs text-slate-400">Çoğu zaman varsayılanlar yeterlidir. Eşikleri değiştirirsen grafik, radar ve sinyaller bu değerleri kullanır.</p>
            <div className="grid grid-cols-3 gap-3">
              <Field label="RSI periyot">{n("rsiPeriod")}</Field>
              <Field label="Aşırı satım">{n("rsiOversold")}</Field>
              <Field label="Aşırı alım">{n("rsiOverbought")}</Field>
              <Field label="CCI periyot">{n("cciPeriod")}</Field>
              <Field label="CCI seviye (±)">{n("cciLevel")}</Field>
              <Field label="Lot">{n("lotSize")}</Field>
              <Field label="SL (pip)">{n("slPips")}</Field>
              <Field label="TP (pip)">{n("tpPips")}</Field>
            </div>
            <div className="flex flex-wrap gap-4">{chk("stochEnabled", "Stochastic onayı")}{chk("useDivergence", "Uyumsuzluk tespiti")}</div>
            <div className="flex justify-between gap-2">
              <Button variant="ghost" onClick={() => setEdit((f) => (f ? { ...f, ...ADV_DEFAULT } : f))}>Varsayılana dön</Button>
              <div className="flex gap-2"><Button variant="ghost" onClick={() => setEdit(null)}>İptal</Button><Button loading={saving} onClick={saveEdit}>Kaydet</Button></div>
            </div>
          </div>
        )}
      </Modal>
    </div>
  );
}
