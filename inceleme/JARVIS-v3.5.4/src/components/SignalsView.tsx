"use client";

import { useEffect, useState } from "react";
import { Badge, Button, Card, Empty, Field, Modal, PageHeader, Skeleton, api, cx, fmtPrice, timeAgo, useList, useToast } from "./ui";
import { StatusBadge } from "./CommandCenter";
import { MarketBadge } from "./hud";
import type { Signal } from "@/lib/types";

const FILTERS = [
  ["all", "Tümü"], ["pending", "Bekleyen"], ["executed", "Açılan"], ["approved", "Onaylı"], ["rejected", "Reddedilen"], ["failed", "Hatalı"],
] as const;

const blank = { symbol: "", side: "BUY", timeframe: "H1", price: "", sl: "", tp: "", volume: "0.1", reason: "", confidence: "60" };

export default function SignalsView() {
  const toast = useToast();
  const { data, setData, reload } = useList<Signal>("/api/signals");
  const [filter, setFilter] = useState<string>("all");
  const [form, setForm] = useState<typeof blank | null>(null);
  const [edit, setEdit] = useState<Signal | null>(null);
  const [saving, setSaving] = useState(false);

  const list = (data ?? []).filter((s) => filter === "all" || s.status === filter);

  const decide = async (s: Signal, approve: boolean) => {
    const prev = data;
    setData((d) => d?.map((x) => (x.id === s.id ? { ...x, status: approve ? "approved" : "rejected" } : x)) ?? d);
    try {
      const r = await api<Signal>(`/api/signals/${s.id}`, { method: "PATCH", body: { decision: approve ? "approve" : "reject" } });
      setData((d) => d?.map((x) => (x.id === s.id ? r : x)) ?? d);
      toast(approve ? "İşlem onaylandı" : "Sinyal reddedildi");
    } catch (e) {
      setData(prev);
      toast((e as Error).message, "err");
    }
  };

  const retry = async (s: Signal) => {
    setData((d) => d?.map((x) => (x.id === s.id ? { ...x, status: "approved", note: "Tekrar deneniyor…" } : x)) ?? d);
    try {
      const r = await api<Signal>(`/api/signals/${s.id}`, { method: "PATCH", body: { decision: "retry" } });
      setData((d) => d?.map((x) => (x.id === s.id ? r : x)) ?? d);
      toast("Emir ajana yeniden iletildi", "info");
    } catch (e) {
      toast((e as Error).message, "err");
      reload();
    }
  };

  useEffect(() => {
    const iv = setInterval(reload, 4000); // ajanın sonucu (gerçekleşti/hata) otomatik görünsün
    return () => clearInterval(iv);
  }, [reload]);

  const del = async (s: Signal) => {
    if (!confirm(`${s.symbol} sinyali silinsin mi?`)) return;
    const prev = data;
    setData((d) => d?.filter((x) => x.id !== s.id) ?? d);
    try {
      await api(`/api/signals/${s.id}`, { method: "DELETE" });
      toast("Silindi");
    } catch (e) {
      setData(prev);
      toast((e as Error).message, "err");
    }
  };

  const create = async () => {
    if (!form) return;
    setSaving(true);
    try {
      const r = await api<Signal>("/api/signals", { body: form });
      setData((d) => [r, ...(d ?? [])]);
      setForm(null);
      toast("Sinyal oluşturuldu · onay bekliyor");
    } catch (e) {
      toast((e as Error).message, "err");
    }
    setSaving(false);
  };

  const saveEdit = async () => {
    if (!edit) return;
    setSaving(true);
    try {
      const r = await api<Signal>(`/api/signals/${edit.id}`, { method: "PATCH", body: { sl: edit.sl, tp: edit.tp, volume: edit.volume, reason: edit.reason } });
      setData((d) => d?.map((x) => (x.id === r.id ? r : x)) ?? d);
      setEdit(null);
      toast("Güncellendi");
    } catch (e) {
      toast((e as Error).message, "err");
    }
    setSaving(false);
  };

  return (
    <div>
      <PageHeader
        title="SİNYALLER"
        sub="Osilatör motorunun ürettiği fırsatlar. Hiçbir sinyal sizin onayınız olmadan işleme dönüşmez."
        right={<div className="flex gap-2"><Button variant="ghost" onClick={reload}>↻</Button><Button onClick={() => setForm({ ...blank })}>+ Manuel Sinyal</Button></div>}
      />
      <div className="mb-4 flex flex-wrap gap-2">
        {FILTERS.map(([k, l]) => (
          <button key={k} onClick={() => setFilter(k)} className={cx("rounded-lg border px-3 py-1 text-sm font-semibold transition", filter === k ? "border-cyan-400/50 bg-cyan-400/10 text-cyan-100" : "border-slate-600/30 text-slate-400 hover:text-cyan-200")}>
            {l}{k !== "all" && data ? <span className="ml-1.5 text-xs text-slate-500">{data.filter((s) => s.status === k).length}</span> : null}
          </button>
        ))}
      </div>
      {!data ? <Card><Skeleton rows={5} /></Card> : list.length === 0 ? (
        <Card><Empty icon="⚡" title="Bu filtrede sinyal yok" hint="Python ajanı çalıştığında RSI/CCI/Stoch ve uyumsuzluk tespitleri burada belirir." action={<Button onClick={() => setForm({ ...blank })}>+ Manuel Sinyal</Button>} /></Card>
      ) : (
        <div className="grid gap-3 md:grid-cols-2 2xl:grid-cols-3">
          {list.map((s) => (
            <div key={s.id} className={cx("glass glass-hover fade-up rounded-2xl p-4 transition", s.status === "pending" && "border-amber-400/40")}>
              <div className="flex items-start justify-between">
                <div>
                  <div className="flex items-center gap-2">
                    <span className="text-lg font-bold" style={{ fontFamily: "JetBrains Mono" }}>{s.symbol}</span>
                    <Badge tone={s.side === "BUY" ? "green" : "red"}>{s.side}</Badge>
                    <Badge tone="slate">{s.timeframe}</Badge>
                    <MarketBadge market={s.market} />
                    {s.source === "demo" && <Badge tone="amber">demo</Badge>}
                    {s.source === "manual" && <Badge tone="violet">elle</Badge>}
                    {s.source === "auto" && <Badge tone="amber">🤖 oto</Badge>}
                  </div>
                  <div className="text-xs text-slate-500">{timeAgo(s.createdAt)}</div>
                </div>
                <StatusBadge s={s.status} />
              </div>
              <p className="mt-2 text-sm text-slate-300">{s.reason}</p>
              <div className="mt-3 grid grid-cols-4 gap-2 text-center text-xs" style={{ fontFamily: "JetBrains Mono" }}>
                <Mini k="Fiyat" v={fmtPrice(s.price)} /><Mini k="SL" v={fmtPrice(s.sl)} /><Mini k="TP" v={fmtPrice(s.tp)} /><Mini k="Lot" v={String(s.volume)} />
              </div>
              {Object.keys(s.indicators ?? {}).length > 0 && (
                <div className="mt-2 flex flex-wrap gap-1.5">
                  {Object.entries(s.indicators).map(([k, v]) => <Badge key={k} tone="cyan">{k}: {String(v)}</Badge>)}
                </div>
              )}
              <div className="mt-3">
                <div className="mb-1 flex justify-between text-[10px] uppercase tracking-wider text-slate-500"><span>Güven</span><span>%{s.confidence}</span></div>
                <div className="h-1.5 rounded-full bg-slate-800"><div className="h-full rounded-full bg-gradient-to-r from-cyan-500 to-blue-500" style={{ width: `${s.confidence}%` }} /></div>
              </div>
              {s.note && <div className={cx("mt-2 text-xs", s.status === "failed" ? "rounded-lg bg-rose-500/10 p-2 text-rose-200" : "text-slate-500")}>{s.note}</div>}
              <div className="mt-3 flex gap-2">
                {s.status === "pending" ? (
                  <>
                    <Button size="sm" variant="success" className="flex-1" onClick={() => decide(s, true)}>✓ Evet</Button>
                    <Button size="sm" variant="danger" className="flex-1" onClick={() => decide(s, false)}>✕ Hayır</Button>
                    <Button size="sm" variant="ghost" onClick={() => setEdit({ ...s })}>✎</Button>
                  </>
                ) : s.status === "failed" && s.source !== "demo" ? (
                  <Button size="sm" variant="primary" className="flex-1" onClick={() => retry(s)}>↻ Tekrar dene</Button>
                ) : <div className="flex-1" />}
                <Button size="sm" variant="ghost" onClick={() => del(s)}>🗑</Button>
              </div>
            </div>
          ))}
        </div>
      )}

      <Modal open={!!form} onClose={() => setForm(null)} title="Manuel Sinyal">
        {form && (
          <div className="grid grid-cols-2 gap-3">
            <Field label="Sembol"><input className="input" value={form.symbol} onChange={(e) => setForm({ ...form, symbol: e.target.value })} placeholder="EURUSD" /></Field>
            <Field label="Yön"><select className="input" value={form.side} onChange={(e) => setForm({ ...form, side: e.target.value })}><option>BUY</option><option>SELL</option></select></Field>
            <Field label="Zaman dilimi"><select className="input" value={form.timeframe} onChange={(e) => setForm({ ...form, timeframe: e.target.value })}>{["M5","M15","M30","H1","H4","D1"].map((t) => <option key={t}>{t}</option>)}</select></Field>
            <Field label="Fiyat"><input className="input" value={form.price} onChange={(e) => setForm({ ...form, price: e.target.value })} /></Field>
            <Field label="Stop Loss"><input className="input" value={form.sl} onChange={(e) => setForm({ ...form, sl: e.target.value })} /></Field>
            <Field label="Take Profit"><input className="input" value={form.tp} onChange={(e) => setForm({ ...form, tp: e.target.value })} /></Field>
            <Field label="Lot"><input className="input" value={form.volume} onChange={(e) => setForm({ ...form, volume: e.target.value })} /></Field>
            <Field label="Güven %"><input className="input" value={form.confidence} onChange={(e) => setForm({ ...form, confidence: e.target.value })} /></Field>
            <div className="col-span-2"><Field label="Gerekçe"><input className="input" value={form.reason} onChange={(e) => setForm({ ...form, reason: e.target.value })} placeholder="RSI 28 + CCI -120" /></Field></div>
            <div className="col-span-2 flex justify-end gap-2"><Button variant="ghost" onClick={() => setForm(null)}>İptal</Button><Button loading={saving} onClick={create}>Oluştur</Button></div>
          </div>
        )}
      </Modal>
      <Modal open={!!edit} onClose={() => setEdit(null)} title="Sinyali Düzenle">
        {edit && (
          <div className="grid grid-cols-3 gap-3">
            <Field label="SL"><input className="input" value={edit.sl ?? ""} onChange={(e) => setEdit({ ...edit, sl: e.target.value === "" ? null : Number(e.target.value) })} /></Field>
            <Field label="TP"><input className="input" value={edit.tp ?? ""} onChange={(e) => setEdit({ ...edit, tp: e.target.value === "" ? null : Number(e.target.value) })} /></Field>
            <Field label="Lot"><input className="input" value={edit.volume} onChange={(e) => setEdit({ ...edit, volume: Number(e.target.value) })} /></Field>
            <div className="col-span-3"><Field label="Gerekçe"><input className="input" value={edit.reason} onChange={(e) => setEdit({ ...edit, reason: e.target.value })} /></Field></div>
            <div className="col-span-3 flex justify-end gap-2"><Button variant="ghost" onClick={() => setEdit(null)}>İptal</Button><Button loading={saving} onClick={saveEdit}>Kaydet</Button></div>
          </div>
        )}
      </Modal>
    </div>
  );
}

function Mini({ k, v }: { k: string; v: string }) {
  return <div className="rounded-lg bg-black/30 py-1.5"><div className="text-[9px] uppercase text-slate-500">{k}</div><div className="text-slate-200">{v}</div></div>;
}
