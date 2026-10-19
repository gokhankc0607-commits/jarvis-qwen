"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Badge, Button, Card, Empty, Field, Modal, PageHeader, Skeleton, Spinner, api, cx, timeAgo, useList, useToast } from "./ui";
import { JobBadge } from "./CommandCenter";
import type { CompileJob, Strategy } from "@/lib/types";

const STATUS: Record<string, [string, "cyan" | "green" | "red" | "amber" | "slate" | "violet"]> = {
  draft: ["Taslak", "slate"], queued: ["Kuyrukta", "amber"], compiling: ["Derleniyor", "violet"], compiled: ["Derlendi", "green"], error: ["Hata", "red"],
};

const PRESETS = [
  "RSI aşırı satım bölgesinden çıkışta CCI -100 altındaysa BUY kuralı ekle",
  "SMC: son 20 barda Break of Structure sonrası order block'a dönüşte giriş ekle",
  "Gann 1x1 açısını günlük pivot üzerinden hesapla ve fiyat üzerinde kalırsa BUY filtresi ekle",
  "Trailing stop ve günlük maksimum zarar limiti (%2) ekle",
];

export default function StrategiesView() {
  const toast = useToast();
  const { data, setData, reload } = useList<Strategy>("/api/strategies");
  const [sel, setSel] = useState<number | null>(null);
  const [code, setCode] = useState("");
  const [meta, setMeta] = useState({ name: "", filePath: "", description: "" });
  const [jobs, setJobs] = useState<CompileJob[] | null>(null);
  const [autoFix, setAutoFix] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const [newOpen, setNewOpen] = useState(false);
  const [newForm, setNewForm] = useState({ name: "", description: "" });
  const [aiOpen, setAiOpen] = useState(false);
  const [instruction, setInstruction] = useState("");
  const [aiResult, setAiResult] = useState<string | null>(null);
  const taRef = useRef<HTMLTextAreaElement>(null);
  const gutterRef = useRef<HTMLDivElement>(null);

  const cur = data?.find((s) => s.id === sel) ?? null;
  const dirty = !!cur && (code !== cur.code || meta.name !== cur.name || meta.filePath !== cur.filePath || meta.description !== cur.description);

  useEffect(() => {
    if (data && data.length && sel === null) setSel(data[0].id);
  }, [data, sel]);

  useEffect(() => {
    if (cur) {
      setCode(cur.code);
      setMeta({ name: cur.name, filePath: cur.filePath, description: cur.description });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cur?.id, cur?.version]);

  const loadJobs = useCallback(() => {
    if (sel) api<CompileJob[]>(`/api/compile-jobs?strategyId=${sel}`).then(setJobs).catch(() => {});
  }, [sel]);
  useEffect(() => { setJobs(null); loadJobs(); }, [loadJobs]);

  const running = jobs?.some((j) => j.status === "queued" || j.status === "running");
  useEffect(() => {
    if (!running) return;
    const iv = setInterval(() => { loadJobs(); reload(); }, 2500);
    return () => clearInterval(iv);
  }, [running, loadJobs, reload]);

  const save = async () => {
    if (!cur) return;
    setBusy("save");
    try {
      const r = await api<Strategy>(`/api/strategies/${cur.id}`, { method: "PATCH", body: { ...meta, code } });
      setData((d) => d?.map((x) => (x.id === r.id ? r : x)) ?? d);
      toast(`Kaydedildi · v${r.version}`);
    } catch (e) { toast((e as Error).message, "err"); }
    setBusy(null);
  };

  const compile = async () => {
    if (!cur) return;
    if (dirty) await save();
    setBusy("compile");
    setData((d) => d?.map((x) => (x.id === cur.id ? { ...x, status: "compiling" } : x)) ?? d);
    try {
      const j = await api<CompileJob>(`/api/strategies/${cur.id}/compile`, { body: { autoFix } });
      toast(j.status === "queued" ? "MetaEditor kuyruğuna alındı" : j.status === "success" ? "Derleme başarılı ✓" : `Derleme hatası: ${j.errors} hata`, j.status === "failed" ? "err" : "ok");
      reload();
      loadJobs();
    } catch (e) { toast((e as Error).message, "err"); reload(); }
    setBusy(null);
  };

  const remove = async () => {
    if (!cur || !confirm(`${cur.name} silinsin mi?`)) return;
    const prev = data;
    setData((d) => d?.filter((x) => x.id !== cur.id) ?? d);
    setSel(null);
    try { await api(`/api/strategies/${cur.id}`, { method: "DELETE" }); toast("Strateji silindi"); } catch (e) { setData(prev); toast((e as Error).message, "err"); }
  };

  const create = async () => {
    setBusy("new");
    try {
      const r = await api<Strategy>("/api/strategies", { body: newForm });
      setData((d) => [r, ...(d ?? [])]);
      setSel(r.id);
      setNewOpen(false);
      setNewForm({ name: "", description: "" });
      toast("Strateji oluşturuldu");
    } catch (e) { toast((e as Error).message, "err"); }
    setBusy(null);
  };

  const runAi = async () => {
    if (!cur) return;
    setBusy("ai");
    setAiResult(null);
    try {
      const r = await api<{ code: string; provider: string }>(`/api/strategies/${cur.id}/ai-edit`, { body: { instruction } });
      setAiResult(r.code);
      toast(`${r.provider} kodu güncelledi`);
    } catch (e) { toast((e as Error).message, "err"); }
    setBusy(null);
  };

  const jumpTo = (line: number) => {
    const ta = taRef.current;
    if (!ta) return;
    const lines = code.split("\n");
    const start = lines.slice(0, line - 1).join("\n").length + (line > 1 ? 1 : 0);
    ta.focus();
    ta.setSelectionRange(start, start + (lines[line - 1]?.length ?? 0));
    ta.scrollTop = (line - 5) * 19.5;
  };

  const lineCount = code.split("\n").length;
  const errLines = new Set(
    (jobs?.[0]?.log ?? "").split("\n").flatMap((l) => { const m = l.match(/\((\d+),\d+\)\s*:\s*error/); return m ? [Number(m[1])] : []; })
  );

  return (
    <div>
      <PageHeader title="MQL5 STRATEJİLERİ" sub="Kodu düzenleyin, yerel LLM ile kural ekleyin, metaeditor64.exe ile derleyin. Hata çıkarsa JARVIS kendi düzeltir." right={<Button onClick={() => setNewOpen(true)}>+ Yeni Strateji</Button>} />
      <div className="grid gap-4 xl:grid-cols-[280px_minmax(0,1fr)]">
        <Card title="Kaynak Dosyalar" icon="⌘">
          {!data ? <Skeleton rows={4} /> : data.length === 0 ? (
            <Empty icon="⌘" title="Strateji yok" action={<Button size="sm" onClick={() => setNewOpen(true)}>+ Oluştur</Button>} />
          ) : (
            <div className="space-y-1.5">
              {data.map((s) => (
                <button key={s.id} onClick={() => { if (dirty && !confirm("Kaydedilmemiş değişiklikler kaybolacak. Devam?")) return; setSel(s.id); }}
                  className={cx("w-full rounded-xl border px-3 py-2.5 text-left transition", s.id === sel ? "border-cyan-400/50 bg-cyan-400/10" : "border-transparent hover:border-cyan-400/20 hover:bg-cyan-400/5")}>
                  <div className="flex items-center justify-between gap-2">
                    <span className="truncate font-semibold text-slate-100">{s.name}</span>
                    <Badge tone={STATUS[s.status]?.[1] ?? "slate"}>{STATUS[s.status]?.[0] ?? s.status}</Badge>
                  </div>
                  <div className="truncate text-[11px] text-slate-500" style={{ fontFamily: "JetBrains Mono" }}>{s.filePath.split(/[\\/]/).pop()} · v{s.version}</div>
                </button>
              ))}
            </div>
          )}
        </Card>

        {!cur ? (
          <Card>{!data ? <Skeleton rows={8} /> : <Empty icon="⌘" title="Bir strateji seçin" />}</Card>
        ) : (
          <div className="min-w-0 space-y-4">
            <Card>
              <div className="grid gap-3 md:grid-cols-3">
                <Field label="Ad"><input className="input" value={meta.name} onChange={(e) => setMeta({ ...meta, name: e.target.value })} /></Field>
                <Field label="Dosya yolu (MQL5 klasörüne göre)"><input className="input" style={{ fontFamily: "JetBrains Mono" }} value={meta.filePath} onChange={(e) => setMeta({ ...meta, filePath: e.target.value })} /></Field>
                <Field label="Açıklama"><input className="input" value={meta.description} onChange={(e) => setMeta({ ...meta, description: e.target.value })} /></Field>
              </div>
              <div className="mt-3 flex flex-wrap items-center gap-2">
                <Button onClick={save} loading={busy === "save"} disabled={!dirty} variant="ghost">💾 Kaydet{dirty && " •"}</Button>
                <Button onClick={() => { setAiOpen(true); setAiResult(null); }} variant="primary">✦ AI ile Düzenle</Button>
                <Button onClick={compile} loading={busy === "compile" || !!running} variant="success">⚙ Derle (.ex5)</Button>
                <label className="flex items-center gap-2 text-sm text-slate-300"><input type="checkbox" className="accent-cyan-400" checked={autoFix} onChange={(e) => setAutoFix(e.target.checked)} /> Otonom hata ayıklama</label>
                <div className="ml-auto flex items-center gap-2 text-xs text-slate-500">
                  {cur.lastCompiledAt && <span>son derleme {timeAgo(cur.lastCompiledAt)}</span>}
                  <Button size="sm" variant="danger" onClick={remove}>Sil</Button>
                </div>
              </div>
            </Card>
            <div className="glass hud-corner overflow-hidden rounded-2xl">
              <div className="flex items-center justify-between border-b border-cyan-400/10 px-4 py-2 text-xs text-slate-400">
                <span style={{ fontFamily: "JetBrains Mono" }}>{meta.filePath}</span>
                <span>{lineCount} satır · v{cur.version}</span>
              </div>
              <div className="flex h-[480px] text-[13px] leading-[19.5px]" style={{ fontFamily: "JetBrains Mono" }}>
                <div ref={gutterRef} className="select-none overflow-hidden bg-black/30 px-2 py-3 text-right text-slate-600">
                  {Array.from({ length: lineCount }, (_, i) => (
                    <div key={i} className={cx(errLines.has(i + 1) && "bg-rose-500/20 text-rose-300")}>{i + 1}</div>
                  ))}
                </div>
                <textarea
                  ref={taRef}
                  value={code}
                  spellCheck={false}
                  onChange={(e) => setCode(e.target.value)}
                  onScroll={(e) => { if (gutterRef.current) gutterRef.current.scrollTop = e.currentTarget.scrollTop; }}
                  onKeyDown={(e) => {
                    if (e.key === "Tab") { e.preventDefault(); const t = e.currentTarget; const s = t.selectionStart; setCode(code.slice(0, s) + "   " + code.slice(t.selectionEnd)); requestAnimationFrame(() => t.setSelectionRange(s + 3, s + 3)); }
                    if ((e.ctrlKey || e.metaKey) && e.key === "s") { e.preventDefault(); save(); }
                  }}
                  className="scroll-thin flex-1 resize-none whitespace-pre bg-transparent px-3 py-3 text-cyan-50 outline-none"
                />
              </div>
            </div>
            <Card title="Derleme Geçmişi" icon="▤" right={running ? <span className="flex items-center gap-2 text-xs text-violet-300"><Spinner /> ajan derliyor…</span> : null}>
              {!jobs ? <Skeleton rows={2} /> : jobs.length === 0 ? <Empty icon="▤" title="Henüz derlenmedi" hint="⚙ Derle butonuna basın." /> : (
                <div className="space-y-2">
                  {jobs.slice(0, 6).map((j) => (
                    <details key={j.id} open={j.id === jobs[0].id} className="rounded-xl border border-slate-500/15 bg-black/30 p-3">
                      <summary className="flex cursor-pointer items-center gap-2 text-sm">
                        <JobBadge s={j.status} />
                        <span className="text-slate-300">{j.errors} hata · {j.warnings} uyarı · {j.attempt}. deneme</span>
                        <Badge tone={j.source === "agent" ? "cyan" : "amber"}>{j.source === "agent" ? "MetaEditor" : "Demo"}</Badge>
                        <span className="ml-auto text-xs text-slate-500">{timeAgo(j.createdAt)}</span>
                      </summary>
                      <pre className="scroll-thin mt-2 max-h-56 overflow-auto whitespace-pre-wrap text-[11px] leading-relaxed" style={{ fontFamily: "JetBrains Mono" }}>
                        {j.log.split("\n").map((l, i) => {
                          const m = l.match(/\((\d+),\d+\)/);
                          return (
                            <div key={i} onClick={() => m && jumpTo(Number(m[1]))} className={cx(/error/i.test(l) ? "cursor-pointer text-rose-300 hover:underline" : /warning/i.test(l) ? "text-amber-300" : /Otonom|LLM/.test(l) ? "text-violet-300" : /0 errors|oluşturuldu/.test(l) ? "text-emerald-300" : "text-slate-400")}>{l}</div>
                          );
                        })}
                      </pre>
                    </details>
                  ))}
                </div>
              )}
            </Card>
          </div>
        )}
      </div>

      <Modal open={newOpen} onClose={() => setNewOpen(false)} title="Yeni MQL5 Stratejisi">
        <div className="space-y-3">
          <Field label="Ad"><input className="input" value={newForm.name} onChange={(e) => setNewForm({ ...newForm, name: e.target.value })} placeholder="Jarvis Stoch Scalper" /></Field>
          <Field label="Açıklama"><input className="input" value={newForm.description} onChange={(e) => setNewForm({ ...newForm, description: e.target.value })} /></Field>
          <div className="flex justify-end gap-2"><Button variant="ghost" onClick={() => setNewOpen(false)}>İptal</Button><Button loading={busy === "new"} onClick={create} disabled={!newForm.name.trim()}>Oluştur</Button></div>
        </div>
      </Modal>
      <Modal open={aiOpen} onClose={() => setAiOpen(false)} title="AI ile Strateji Güncelle" wide>
        <div className="space-y-3">
          <Field label="Talimat" hint="Aktif LLM sağlayıcısı kullanılır (varsayılan: Ollama yerel).">
            <textarea className="input min-h-24" value={instruction} onChange={(e) => setInstruction(e.target.value)} placeholder="Stratejiye ... kuralını ekle" />
          </Field>
          <div className="flex flex-wrap gap-1.5">
            {PRESETS.map((p) => <button key={p} onClick={() => setInstruction(p)} className="rounded-lg border border-cyan-400/20 px-2 py-1 text-left text-xs text-cyan-200 hover:border-cyan-400/50">{p}</button>)}
          </div>
          <div className="flex justify-end"><Button loading={busy === "ai"} disabled={!instruction.trim()} onClick={runAi}>✦ Kodu Üret</Button></div>
          {busy === "ai" && <div className="skeleton h-40" />}
          {aiResult && (
            <>
              <pre className="scroll-thin max-h-72 overflow-auto rounded-xl border border-cyan-400/20 bg-black/40 p-3 text-[11px] text-cyan-50" style={{ fontFamily: "JetBrains Mono" }}>{aiResult}</pre>
              <div className="flex justify-end gap-2">
                <Button variant="ghost" onClick={() => setAiResult(null)}>Reddet</Button>
                <Button variant="success" onClick={() => { setCode(aiResult); setAiOpen(false); toast("Kod editöre aktarıldı · Kaydet ve Derle", "info"); }}>Editöre Uygula</Button>
              </div>
            </>
          )}
        </div>
      </Modal>
    </div>
  );
}
