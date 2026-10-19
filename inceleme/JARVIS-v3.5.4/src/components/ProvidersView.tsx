"use client";

import { useState } from "react";
import { Badge, Button, Card, Empty, Field, Modal, PageHeader, Skeleton, api, cx, useList, useToast } from "./ui";
import type { ProviderT } from "@/lib/types";

const PRESETS = [
  { name: "Ollama (yerel)", kind: "ollama", baseUrl: "http://localhost:11434", model: "qwen2.5-coder:14b", local: true },
  { name: "LM Studio", kind: "openai_compat", baseUrl: "http://localhost:1234/v1", model: "hermes-3-llama-3.1-8b", local: true },
  { name: "OmniRoute / Hermes", kind: "openai_compat", baseUrl: "http://localhost:20128/v1", model: "auto", local: true },
  { name: "llama.cpp server", kind: "openai_compat", baseUrl: "http://localhost:8080/v1", model: "local", local: true },
  { name: "OpenAI", kind: "openai_compat", baseUrl: "https://api.openai.com/v1", model: "gpt-4o-mini", local: false },
  { name: "Anthropic Claude", kind: "anthropic", baseUrl: "https://api.anthropic.com", model: "claude-sonnet-4-5", local: false },
  { name: "Google Gemini", kind: "gemini", baseUrl: "https://generativelanguage.googleapis.com", model: "gemini-2.0-flash", local: false },
  { name: "Groq", kind: "openai_compat", baseUrl: "https://api.groq.com/openai/v1", model: "llama-3.3-70b-versatile", local: false },
  { name: "OpenRouter", kind: "openai_compat", baseUrl: "https://openrouter.ai/api/v1", model: "meta-llama/llama-3.3-70b-instruct", local: false },
];
const KIND_LABEL: Record<string, string> = { ollama: "Ollama API", openai_compat: "OpenAI uyumlu", anthropic: "Anthropic", gemini: "Gemini" };

type Form = { id?: number; name: string; kind: string; baseUrl: string; model: string; apiKey: string };

export default function ProvidersView() {
  const toast = useToast();
  const { data, setData } = useList<ProviderT>("/api/providers");
  const [form, setForm] = useState<Form | null>(null);
  const [busy, setBusy] = useState(false);
  const [testing, setTesting] = useState<number | null>(null);
  const [results, setResults] = useState<Record<number, { ok: boolean; text: string }>>({});

  const save = async () => {
    if (!form) return;
    setBusy(true);
    try {
      if (form.id) {
        const r = await api<ProviderT>(`/api/providers/${form.id}`, { method: "PATCH", body: form });
        setData((d) => d?.map((x) => (x.id === r.id ? r : x)) ?? d);
      } else {
        const r = await api<ProviderT>("/api/providers", { body: form });
        setData((d) => [...(d ?? []), r]);
      }
      setForm(null);
      toast("Sağlayıcı kaydedildi");
    } catch (e) { toast((e as Error).message, "err"); }
    setBusy(false);
  };
  const activate = async (p: ProviderT) => {
    const prev = data;
    setData((d) => d?.map((x) => ({ ...x, isActive: x.id === p.id })) ?? d);
    try { await api(`/api/providers/${p.id}`, { method: "PATCH", body: { isActive: true } }); toast(`${p.name} aktif zekâ çekirdeği`); }
    catch (e) { setData(prev); toast((e as Error).message, "err"); }
  };
  const del = async (p: ProviderT) => {
    if (!confirm(`${p.name} silinsin mi?`)) return;
    const prev = data;
    setData((d) => d?.filter((x) => x.id !== p.id) ?? d);
    try { await api(`/api/providers/${p.id}`, { method: "DELETE" }); toast("Silindi"); } catch (e) { setData(prev); toast((e as Error).message, "err"); }
  };
  const test = async (p: ProviderT) => {
    setTesting(p.id);
    try {
      const r = await api<{ ok: boolean; ms: number; reply?: string; error?: string }>(`/api/providers/${p.id}/test`, { body: {} });
      setResults((s) => ({ ...s, [p.id]: { ok: r.ok, text: r.ok ? `${r.ms} ms · ${r.reply}` : r.error ?? "hata" } }));
    } catch (e) { setResults((s) => ({ ...s, [p.id]: { ok: false, text: (e as Error).message } })); }
    setTesting(null);
  };

  return (
    <div>
      <PageHeader title="AI SAĞLAYICILARI" sub="Varsayılan: tamamen yerel (Ollama / LM Studio / OmniRoute). İsterseniz bulut sağlayıcıları da bağlayabilirsiniz." right={<Button onClick={() => setForm({ name: "", kind: "ollama", baseUrl: "http://localhost:11434", model: "", apiKey: "" })}>+ Sağlayıcı Ekle</Button>} />
      <div className="mb-5 rounded-xl border border-amber-400/25 bg-amber-400/5 p-3 text-sm text-amber-100/90">
        ⚠ Not: Bu panel sunucuda çalışır. Panel sizin bilgisayarınızda (localhost) çalışıyorsa yerel LLM'e doğrudan ulaşır. Python ajanı ise aktif sağlayıcıyı senkronizasyonda alır ve LLM'i <b>sizin makinenizden</b> çağırır (otonom MQL5 düzeltme ve sesli sohbet ajanda tamamen yerel çalışır).
      </div>
      {!data ? <Card><Skeleton rows={3} /></Card> : data.length === 0 ? (
        <Card><Empty icon="✦" title="Sağlayıcı yok" hint="Aşağıdaki hazır ayarlardan birini seçin." /></Card>
      ) : (
        <div className="grid gap-3 md:grid-cols-2 2xl:grid-cols-3">
          {data.map((p) => (
            <div key={p.id} className={cx("glass glass-hover fade-up rounded-2xl p-4 transition", p.isActive && "border-cyan-400/60 shadow-[0_0_30px_-8px_rgba(34,211,238,0.7)]")}>
              <div className="flex items-start justify-between gap-2">
                <div>
                  <div className="font-bold text-slate-100">{p.name}</div>
                  <div className="mt-1 flex flex-wrap gap-1.5"><Badge tone={p.isLocal ? "cyan" : "violet"}>{p.isLocal ? "Yerel" : "Bulut"}</Badge><Badge tone="slate">{KIND_LABEL[p.kind] ?? p.kind}</Badge>{p.isActive && <Badge tone="green">Aktif</Badge>}</div>
                </div>
              </div>
              <div className="mt-3 space-y-1 text-xs" style={{ fontFamily: "JetBrains Mono" }}>
                <div className="truncate text-slate-400">{p.baseUrl}</div>
                <div className="text-cyan-200">{p.model}</div>
                {p.apiKey && <div className="text-slate-500">anahtar {p.apiKey}</div>}
              </div>
              {results[p.id] && <div className={cx("mt-2 rounded-lg px-2 py-1.5 text-xs", results[p.id].ok ? "bg-emerald-500/10 text-emerald-300" : "bg-rose-500/10 text-rose-300")}>{results[p.id].text}</div>}
              <div className="mt-3 flex flex-wrap gap-2">
                {!p.isActive && <Button size="sm" onClick={() => activate(p)}>Aktif yap</Button>}
                <Button size="sm" variant="ghost" loading={testing === p.id} onClick={() => test(p)}>Test et</Button>
                <Button size="sm" variant="ghost" onClick={() => setForm({ id: p.id, name: p.name, kind: p.kind, baseUrl: p.baseUrl, model: p.model, apiKey: p.apiKey })}>✎</Button>
                <Button size="sm" variant="ghost" onClick={() => del(p)}>🗑</Button>
              </div>
            </div>
          ))}
        </div>
      )}
      <h2 className="mb-3 mt-8 text-xs font-bold uppercase tracking-[0.3em] text-cyan-300/80" style={{ fontFamily: "Orbitron" }}>Hazır Ayarlar</h2>
      <div className="grid grid-cols-2 gap-2 md:grid-cols-3 xl:grid-cols-5">
        {PRESETS.map((p) => (
          <button key={p.name} onClick={() => setForm({ name: p.name, kind: p.kind, baseUrl: p.baseUrl, model: p.model, apiKey: "" })} className="glass glass-hover rounded-xl p-3 text-left transition">
            <div className="text-sm font-semibold text-slate-100">{p.name}</div>
            <div className="mt-1"><Badge tone={p.local ? "cyan" : "violet"}>{p.local ? "Yerel" : "Bulut"}</Badge></div>
          </button>
        ))}
      </div>
      <Modal open={!!form} onClose={() => setForm(null)} title={form?.id ? "Sağlayıcıyı Düzenle" : "Yeni Sağlayıcı"}>
        {form && (
          <div className="space-y-3">
            <Field label="Ad"><input className="input" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} /></Field>
            <Field label="API tipi"><select className="input" value={form.kind} onChange={(e) => setForm({ ...form, kind: e.target.value })}>{Object.entries(KIND_LABEL).map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select></Field>
            <Field label="Base URL"><input className="input" style={{ fontFamily: "JetBrains Mono" }} value={form.baseUrl} onChange={(e) => setForm({ ...form, baseUrl: e.target.value })} /></Field>
            <Field label="Model"><input className="input" style={{ fontFamily: "JetBrains Mono" }} value={form.model} onChange={(e) => setForm({ ...form, model: e.target.value })} /></Field>
            <Field label="API anahtarı (yerel için boş bırakın)"><input className="input" type="password" value={form.apiKey} onChange={(e) => setForm({ ...form, apiKey: e.target.value })} /></Field>
            <div className="flex justify-end gap-2"><Button variant="ghost" onClick={() => setForm(null)}>İptal</Button><Button loading={busy} onClick={save}>Kaydet</Button></div>
          </div>
        )}
      </Modal>
    </div>
  );
}
