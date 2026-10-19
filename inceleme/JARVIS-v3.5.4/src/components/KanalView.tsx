"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import KanalTable from "./KanalTable";
import { Badge, Button, Card, Field, PageHeader, Skeleton, api, cx, timeAgo, useToast } from "./ui";
import { parseTfs } from "@/lib/tf";
import { KANAL_DEFAULTS, KANAL_TFS, type KanalItem, type KanalParams } from "@/lib/kanal";

type AutoCfg = { enabled: boolean; minConf: number; maxPositions: number; beAtPct: number; beAll: boolean; partialAtPct: number; partialPct: number };
type Cfg = { enabled: boolean; timeframes: string; scanMode: "list" | "marketwatch"; symbols: string[]; lot: number; params: KanalParams; auto: AutoCfg };
type Resp = { settings: Cfg; live: boolean; items: KanalItem[]; watch: string[]; at: number; ruleSymbols: string[]; agentVersion?: string | null };

export default function KanalView() {
  const toast = useToast();
  const [data, setData] = useState<Resp | null>(null);
  const [form, setForm] = useState<Cfg | null>(null);
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [only, setOnly] = useState(false);
  const [adv, setAdv] = useState(false);

  const load = useCallback(async () => {
    try {
      const r = await api<Resp>("/api/kanal");
      setData(r);
      setForm((f) => (f && dirty ? f : r.settings));
    } catch {}
  }, [dirty]);

  useEffect(() => {
    load();
    const iv = setInterval(load, 4000);
    return () => clearInterval(iv);
  }, [load]);

  const patch = (p: Partial<Cfg>, pp?: Partial<KanalParams>) => {
    setForm((f) => (f ? { ...f, ...p, params: { ...f.params, ...pp } } : f));
    setDirty(true);
  };

  const save = async (override?: Partial<Cfg>) => {
    if (!form) return;
    setSaving(true);
    const body = { ...form, ...override };
    try {
      const s = await api<Cfg>("/api/kanal", { method: "PATCH", body });
      setForm(s);
      setDirty(false);
      toast("Strateji ayarları kaydedildi · ajan bir sonraki senkronda uygular");
      load();
    } catch (e) { toast((e as Error).message, "err"); }
    setSaving(false);
  };

  const toggle = async () => {
    if (!form) return;
    const enabled = !form.enabled;
    setForm({ ...form, enabled });
    try { await api("/api/kanal", { method: "PATCH", body: { enabled } }); toast(enabled ? "KANAL stratejisi açık" : "KANAL stratejisi kapalı (eski RSI/CCI taraması)"); }
    catch (e) { setForm({ ...form, enabled: !enabled }); toast((e as Error).message, "err"); }
  };

  const setAuto = async (patchA: Partial<AutoCfg>, confirmText?: string) => {
    if (!form) return;
    if (confirmText && !confirm(confirmText)) return;
    const auto = { ...form.auto, ...patchA };
    setForm({ ...form, auto });
    try {
      const s = await api<Cfg>("/api/kanal", { method: "PATCH", body: { auto } });
      setForm((f) => (f ? { ...f, auto: s.auto } : f));
      if (patchA.enabled !== undefined) toast(patchA.enabled ? "🤖 Otomatik işlem AÇIK" : "Otomatik işlem kapalı — sinyaller onayınıza sorulur", patchA.enabled ? "info" : "ok");
    } catch (e) { toast((e as Error).message, "err"); load(); }
  };

  const addChart = async (symbol: string) => {
    try {
      await api("/api/rules", { body: { symbol, timeframes: parseTfs(form?.timeframes) } });
      toast(`${symbol} grafik/izleme listesine eklendi`);
      load();
    } catch (e) { toast((e as Error).message, "err"); }
  };

  const p = form?.params;
  const tfs = parseTfs(form?.timeframes);
  const num = (k: keyof KanalParams, step = "1") => (
    <input className="input" type="number" step={step} value={String(p?.[k] ?? "")} onChange={(e) => patch({}, { [k]: Number(e.target.value) } as Partial<KanalParams>)} />
  );
  const items = data?.items ?? [];
  const armed = items.filter((i) => i.armed).length;
  const fresh = items.filter((i) => i.fire).length;
  const near = items.filter((i) => i.stage >= 1).length;

  return (
    <div>
      <PageHeader
        title="KANAL STRATEJİ"
        sub="5 aşamalı sıralı kurulum · güvenli dönüş ≥0.10 ATR · TF bazlı zaman aşımı · R:R kapısı · Piyasa Gözlemi pariteleri."
        right={data && (
          <div className="flex items-center gap-2">
            <Badge tone={data.live ? "green" : "amber"}>{data.live ? "CANLI · MT5 Piyasa Gözlemi" : "DEMO VERİ"}</Badge>
            <button onClick={toggle} className={cx("relative h-7 w-14 rounded-full border transition", form?.enabled ? "border-cyan-400/60 bg-cyan-400/30" : "border-slate-600 bg-slate-800")} title="Stratejiyi aç/kapat">
              <span className={cx("absolute top-[3px] h-5 w-5 rounded-full transition-all", form?.enabled ? "left-[31px] bg-cyan-200 shadow-[0_0_10px_rgba(34,211,238,0.9)]" : "left-[3px] bg-slate-400")} />
            </button>
          </div>
        )}
      />

      <div className="mb-4 grid gap-4 xl:grid-cols-2">
        <Card title="Strateji Kuralları" icon="◈">
          <div className="grid gap-3 text-sm md:grid-cols-2">
            <div className="rounded-xl border border-emerald-400/30 bg-emerald-400/5 p-3">
              <div className="mb-1 font-black text-emerald-300">▲ ALIŞ</div>
              <ol className="list-decimal space-y-1 pl-4 text-slate-300">
                <li>Mum <b>TÜM alt bantların dışında</b> (en dış bant) <b>kapanır</b> — fitil yetmez</li>
                <li>RSI <b>{p?.rsiOs ?? 30}&apos;un altında</b> kapanmıştır</li>
                <li>Fiyat <b>güvenli döner</b>: mum en dış bandın içine en az <b>0.10 ATR(14)</b> girerek kapanır</li>
                <li>RSI <b>{p?.rsiOs ?? 30}&apos;u yukarı</b> keser</li>
                <li>CCI, mor çizgiyi (CCI MA) <b>yukarı</b> keser</li>
              </ol>
            </div>
            <div className="rounded-xl border border-rose-400/30 bg-rose-400/5 p-3">
              <div className="mb-1 font-black text-rose-300">▼ SATIŞ</div>
              <ol className="list-decimal space-y-1 pl-4 text-slate-300">
                <li>Mum <b>TÜM üst bantların dışında</b> (en dış bant) <b>kapanır</b> — fitil yetmez</li>
                <li>RSI <b>{p?.rsiOb ?? 70}&apos;in üstünde</b> kapanmıştır</li>
                <li>Fiyat <b>güvenli döner</b>: mum en dış bandın içine en az <b>0.10 ATR(14)</b> girerek kapanır</li>
                <li>RSI <b>{p?.rsiOb ?? 70}&apos;i aşağı</b> keser</li>
                <li>CCI, mor çizgiyi (CCI MA) <b>aşağı</b> keser</li>
              </ol>
            </div>
          </div>
          <div className="mt-3 grid gap-2 text-xs text-slate-300 md:grid-cols-2">
            <div className="rounded-lg bg-black/30 p-2.5"><b className="text-cyan-200">Stop loss</b> · M0 kurulumundan RSI teyidine kadarki dönüş öncesi ekstrem dip/tepe.</div>
            <div className="rounded-lg bg-black/30 p-2.5"><b className="text-cyan-200">Take profit</b> · KANAL3BAND <b>merkez çizgisi</b>.</div>
          </div>
          <p className="mt-2 text-xs text-slate-400">
            M0 mumunda hem dış bant kapanışı hem RSI bölgesi şarttır; ardından sırasıyla 0.10 ATR güvenli dönüş, RSI kesişimi ve CCI/MA kesişimi aranır. Kurulum ömrü M3/M5: 10, M15: 8, H1: 6 kapanmış mumdur. Güncel RSI ve CCI teyit tarafında kalmalı; R:R 1:1 altındaysa sinyal bloke edilir. SL, kurulum ekstremine; TP, KANAL3BAND merkez çizgisine göre hesaplanır.
            {form?.auto.enabled ? <> <b className="text-amber-200">Otomatik işlem açık:</b> güven ≥ %{form.auto.minConf} ise sormadan girer, altındaysa sorar.</> : <> Otomatik işlem kapalı: JARVIS sorar, <b>“Evet”</b> ile emir gider.</>}
          </p>
        </Card>

        <Card title="Ayarlar" icon="⚙" right={dirty ? <Badge tone="amber">kaydedilmedi</Badge> : undefined}>
          {!form ? <Skeleton rows={5} /> : (
            <div className="space-y-4">
              <Field label="Zaman dilimleri — hangilerinde işlem aransın? (birden fazla seçebilirsin)">
                <div className="flex flex-wrap gap-1.5">
                  {KANAL_TFS.map((tf) => {
                    const on = tfs.includes(tf);
                    return (
                      <button key={tf} type="button" onClick={() => { if (on && tfs.length === 1) return; patch({ timeframes: (on ? tfs.filter((x) => x !== tf) : [...tfs, tf]).join(",") }); }}
                        className={cx("rounded-lg border px-4 py-2 text-sm font-bold transition", on ? "border-cyan-400/70 bg-cyan-400/20 text-cyan-100 shadow-[0_0_14px_-3px_rgba(34,211,238,0.8)]" : "border-slate-600/40 text-slate-400 hover:text-cyan-200")}>
                        {tf}<span className="ml-1 text-[10px] font-normal opacity-70">{({ M3: "3dk", M5: "5dk", M15: "15dk", H1: "1sa" } as Record<string, string>)[tf]}</span>
                      </button>
                    );
                  })}
                </div>
              </Field>
              <div className="grid grid-cols-2 gap-3">
                <Field label="Lot"><input className="input" type="number" step="0.01" value={form.lot} onChange={(e) => patch({ lot: Number(e.target.value) })} /></Field>
                <Field label="Take profit"><div className="input !bg-transparent text-slate-300">KANAL3BAND merkez çizgisi</div></Field>
              </div>
              <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-cyan-400/20 bg-black/20 px-3 py-2 text-sm">
                <span className="text-slate-300">
                  Taranan pariteler: <b className="text-cyan-100">{form.scanMode === "marketwatch" ? "Piyasa Gözlemi'nin tamamı" : form.symbols.length ? `Takip listem (${form.symbols.length})` : "Takip listem boş → İzleme Kuralları"}</b>
                  {form.scanMode !== "marketwatch" && form.symbols.length > 0 && <span className="ml-1 text-xs text-slate-500">{form.symbols.slice(0, 6).join(", ")}{form.symbols.length > 6 ? "…" : ""}</span>}
                </span>
                <Link href="/watchlist" className="rounded-lg border border-cyan-400/40 px-2.5 py-1 text-xs font-bold text-cyan-200 hover:bg-cyan-400/10">☰ Takip Listesi&apos;ni düzenle</Link>
              </div>

              <button onClick={() => setAdv(!adv)} className="text-xs font-bold text-cyan-400 hover:underline">{adv ? "▾" : "▸"} Gelişmiş ayarlar</button>
              {adv && p && (
                <div className="space-y-3 rounded-xl border border-slate-600/30 bg-black/20 p-3">
                  <label className="flex items-start gap-2 rounded-lg border border-emerald-400/25 bg-emerald-400/5 p-2.5 text-sm text-slate-300">
                    <input type="checkbox" className="mt-0.5 accent-emerald-400" checked={p.guppyConfirm} onChange={(e) => patch({}, { guppyConfirm: e.target.checked })} />
                    <span><b className="text-emerald-300">Guppy GMMA OSC teyidi</b> — 5 koşul tamamlandığında sinyal, son kapanmış mumda GMMA osilatörünün sinyal çizgisini doğru yönde gösteriyorsa açılır (ALIŞ: OSC &gt; sinyal, SATIŞ: OSC &lt; sinyal). Teyit gelmezse sinyal bloke edilir ve güven 10 puan düşer. Kapalıyken davranış v3.5.3 ile birebir aynıdır. Açık pozisyonda OSC yönü tersine keserse radar satırında “GUPPY ÇIKIŞ” rozeti çıkar.</span>
                  </label>
                  {p.guppyConfirm && (
                    <div className="grid grid-cols-3 gap-3">
                      <Field label="GMMA seti">
                        <select className="input" value={p.guppySet} onChange={(e) => patch({}, { guppySet: e.target.value as KanalParams["guppySet"] })}>
                          <option value="Guppy">Guppy (6+6 EMA)</option>
                          <option value="SuperGuppy">SuperGuppy (12 + 16)</option>
                        </select>
                      </Field>
                      <Field label="OSC yumuşatma (SMA)">{num("guppySmoothLen")}</Field>
                      <Field label="Sinyal EMA periyodu">{num("guppySignalLen")}</Field>
                    </div>
                  )}
                  <div className="grid grid-cols-3 gap-3">
                    <Field label="Kurulum ömrü"><div className="input !bg-transparent text-slate-300">M3/M5: 10 · M15: 8 · H1: 6 mum</div></Field>
                    <Field label="Güvenli dönüş derinliği"><div className="input !bg-transparent text-slate-300">0.10 × ATR(14)</div></Field>
                    <Field label="Kripto max spread (%)">{num("cryptoSpreadMaxPct", "0.01")}</Field>
                    <Field label="Kripto min 24s hacim (USDT)">{num("cryptoMinVolume24h", "100000")}</Field>
                    <Field label="Funding ceza eşiği (%)">{num("fundingPenaltyThresholdPct", "0.01")}</Field>
                    <Field label="RSI periyot">{num("rsiPeriod")}</Field>
                    <Field label="RSI üst / alt">
                      <div className="flex gap-1">{num("rsiOb")}{num("rsiOs")}</div>
                    </Field>
                    <Field label="CCI periyot">{num("cciPeriod")}</Field>
                    <Field label="CCI MA (mor çizgi)">{num("cciMaPeriod")}</Field>
                    <Field label="Half period">{num("halfLength")}</Field>
                    <Field label="ATR periyot">{num("atrPeriod")}</Field>
                    <Field label="Çarpan 1 / 2 / 3">
                      <div className="flex gap-1">{num("atrMult1", "0.1")}{num("atrMult2", "0.1")}{num("atrMult3", "0.1")}</div>
                    </Field>
                  </div>
                  <Button size="sm" variant="ghost" onClick={() => patch({}, KANAL_DEFAULTS)}>Varsayılana dön</Button>
                </div>
              )}
              <div className="flex justify-end"><Button loading={saving} disabled={!dirty} onClick={() => save()}>Kaydet</Button></div>
            </div>
          )}
        </Card>
      </div>

      <Card title="Otomatik İşlem" icon="🤖" className={cx("mb-4", form?.auto.enabled && "border-amber-400/50 shadow-[0_0_30px_-10px_rgba(251,191,36,0.6)]")}
        right={form && (
          <button onClick={() => form.auto.enabled ? setAuto({ enabled: false }) : setAuto({ enabled: true }, `OTOMATİK İŞLEM AÇILSIN MI?\n\nKoşullar 5/5 sağlandığında ve güven ≥ %${form.auto.minConf} olduğunda JARVIS size SORMADAN gerçek MT5 hesabınızda işlem açacak (lot ${form.lot}, en fazla ${form.auto.maxPositions} otomatik pozisyon).\n\nOnaylıyor musunuz?`)}
            className={cx("relative h-7 w-14 rounded-full border transition", form.auto.enabled ? "border-amber-400/70 bg-amber-400/30" : "border-slate-600 bg-slate-800")} title="Otomatik işlemi aç/kapat">
            <span className={cx("absolute top-[3px] h-5 w-5 rounded-full transition-all", form.auto.enabled ? "left-[31px] bg-amber-200 shadow-[0_0_10px_rgba(251,191,36,0.9)]" : "left-[3px] bg-slate-400")} />
          </button>
        )}>
        {!form ? <Skeleton rows={2} /> : (
          <div className="space-y-3">
            <div className={cx("rounded-xl border p-3 text-sm", form.auto.enabled ? "border-amber-400/40 bg-amber-400/10 text-amber-100" : "border-slate-600/30 bg-black/20 text-slate-300")}>
              {form.auto.enabled ? (
                <>🤖 <b>AÇIK</b> — bant dışı kapanış → içeri dönüş + RSI + CCI onayı (5/5) ve güven <b>≥ %{form.auto.minConf}</b> ise JARVIS <b>sormadan</b> işleme girer, size sesli ve panelde bildirir. Eşiğin altındaki sinyaller yine onayınıza sorulur.</>
              ) : (
                <>Kapalı — her sinyal için JARVIS size sorar, yalnızca <b>“Evet”</b> ile emir gider.</>
              )}
              {data?.agentVersion && data.agentVersion < "3.0.0" && form.auto.enabled && <div className="mt-1 text-rose-200">⚠ Ajan v{data.agentVersion}: otomatik işlem için ajan v3.0 gerekli (CALISTIR.bat ile yeniden başlatın).</div>}
            </div>
            <div className="grid gap-3 md:grid-cols-4">
              <Field label={`Minimum güven: %${form.auto.minConf}`} hint="Güven = band kırılımı + RSI + CCI gücü + risk/ödül">
                <input type="range" min={60} max={95} step={1} value={form.auto.minConf} onChange={(e) => setForm({ ...form, auto: { ...form.auto, minConf: Number(e.target.value) } })}
                  onMouseUp={() => setAuto({ minConf: form.auto.minConf })} onTouchEnd={() => setAuto({ minConf: form.auto.minConf })} className="w-full accent-amber-400" />
              </Field>
              <Field label="En fazla otomatik pozisyon">
                <input className="input" type="number" min={1} max={20} value={form.auto.maxPositions} onChange={(e) => setForm({ ...form, auto: { ...form.auto, maxPositions: Number(e.target.value) } })} onBlur={() => setAuto({ maxPositions: form.auto.maxPositions })} />
              </Field>
              <Field label="SL'yi girişe çek (TP yolunun %)" hint="0 = kapalı">
                <input className="input" type="number" min={0} max={95} value={form.auto.beAtPct} onChange={(e) => setForm({ ...form, auto: { ...form.auto, beAtPct: Number(e.target.value) } })} onBlur={() => setAuto({ beAtPct: form.auto.beAtPct })} />
              </Field>
              <Field label="Lot (otomatik)"><div className="input !bg-transparent text-slate-300">{form.lot} <span className="text-[11px] text-slate-500">· yukarıdaki Ayarlar&apos;dan</span></div></Field>
            </div>
            <div className="rounded-xl border border-emerald-400/25 bg-emerald-400/5 p-3">
              <div className="mb-2 text-xs font-bold uppercase tracking-widest text-emerald-300">🛡 Kâr yönetimi (TP yolunun yüzdesi)</div>
              <div className="grid gap-3 md:grid-cols-3">
                <Field label="Yarı kâr al: TP yolunun %" hint="0 = kapalı · fiyat bu kadar kâra geçince">
                  <input className="input" type="number" min={0} max={95} value={form.auto.partialAtPct} onChange={(e) => setForm({ ...form, auto: { ...form.auto, partialAtPct: Number(e.target.value) } })} onBlur={() => setAuto({ partialAtPct: form.auto.partialAtPct })} />
                </Field>
                <Field label="Kapatılacak oran (%)" hint="50 = işlemin yarısı">
                  <input className="input" type="number" min={10} max={90} value={form.auto.partialPct} onChange={(e) => setForm({ ...form, auto: { ...form.auto, partialPct: Number(e.target.value) } })} onBlur={() => setAuto({ partialPct: form.auto.partialPct })} />
                </Field>
                <div className="text-[11px] leading-relaxed text-slate-400">
                  Örnek: ALIŞ 1.1000, TP 1.1100 → fiyat <b>1.1030</b>&apos;da SL girişe çekilir, <b>1.1050</b>&apos;de lotun <b>%{form.auto.partialPct}</b>&apos;i kapatılır, kalanı TP&apos;ye gider.
                </div>
              </div>
              <label className="mt-2 flex items-center gap-2 text-sm text-slate-300">
                <input type="checkbox" className="accent-emerald-400" checked={form.auto.beAll} onChange={(e) => setAuto({ beAll: e.target.checked })} />
                Kâr yönetimini <b>MT5&apos;te elle açtığım işlemlere de</b> uygula (kapalıysa yalnızca JARVIS&apos;in açtıkları: sinyal onayı, hızlı emir, otomatik)
              </label>
            </div>
            <p className="text-[11px] text-slate-500">
              Güvenlik: aynı paritede açık pozisyon varsa yeni otomatik işlem açılmaz · otomatik pozisyonlar ayrı “magic” numarası ve “JARVIS AUTO &lt;zaman dilimi&gt;” yorumuyla açılır ·
              kâr yönetimi otomatik işlem kapalıyken de JARVIS&apos;in açtığı işlemlerde çalışır · Yarı kâr her işlemde bir kez yapılır; 0.01 lot gibi bölünemeyen işlemler atlanır · Yalnızca MT5 ajanı çalışırken (demoda yok).
            </p>
          </div>
        )}
      </Card>

      <Card
        title={`Tarama${data ? ` · ${data.watch.length} parite × ${tfs.length} TF` : ""}`}
        icon="◎"
        right={
          <span className="flex items-center gap-3 text-xs">
            {fresh > 0 && <Badge tone="amber">{fresh} yeni sinyal</Badge>}
            <Badge tone={armed ? "green" : "slate"}>{armed} tam koşul</Badge>
            <Badge tone="cyan">{near} yaklaşan</Badge>
            <label className="flex cursor-pointer items-center gap-1.5 text-slate-300"><input type="checkbox" className="accent-cyan-400" checked={only} onChange={(e) => setOnly(e.target.checked)} />yalnızca yaklaşanlar</label>
          </span>
        }
      >
        {!data ? <Skeleton rows={5} /> : (
          <>
            {data.live && data.at > 0 && Date.now() - data.at > 30000 && <div className="mb-2 rounded-lg bg-amber-400/10 px-3 py-1.5 text-xs text-amber-200">Son tarama {timeAgo(new Date(data.at))} — ajan kapalı olabilir.</div>}
            {data.live && data.items.length === 0 && (
              <div className="mb-2 rounded-lg border border-cyan-400/20 bg-cyan-400/5 px-3 py-2 text-xs text-slate-300">
                Ajan bağlı ama henüz tarama verisi gelmedi. Ajanı güncelleyin (<Link href="/agent" className="text-cyan-300 underline">Yerel Ajan</Link>: app.py, mt5_engine.py, kanal_strategy.py) ve yeniden başlatın.
              </div>
            )}
            <KanalTable items={data.items} onlyActive={only} rsiOb={p?.rsiOb} rsiOs={p?.rsiOs} minConf={form?.auto.minConf} autoOn={form?.auto.enabled} ruleSymbols={data.ruleSymbols} onAdd={(s) => addChart(s)}
              onSelect={(s, selectedTf) => {
                const row = data.items.find((x) => x.symbol === s && x.tf === selectedTf);
                const market = (row as (KanalItem & { market?: string }) | undefined)?.market ?? "forex";
                window.location.href = `/market?symbol=${encodeURIComponent(s)}&tf=${encodeURIComponent(selectedTf)}&market=${market}`;
              }} />
          </>
        )}
        <p className="mt-3 text-[11px] text-slate-500">
          Koşullar sırasıyla ve M0&apos;dan itibaren: <b>Bant dışı kapanış + RSI bölgesi</b> → <b>≥0.10 ATR güvenli dönüş</b> → <b>RSI kesişimi</b> → <b>CCI/MA kesişimi</b>. 5/5 ve R:R ≥1:1 ise sinyal; satıra tıklayınca grafik parite/TF&apos;ye geçer ve M0, MR, RSI, CCI mumlarını etiketler.
          {!data?.live && " Demo modunda sentetik veri taranır; gerçek pariteler için ajanı çalıştırın."}
        </p>
      </Card>

      <Card title="MQL5 dosyaları" icon="⌘" className="mt-4">
        <p className="text-sm text-slate-300">
          Üç gösterge ve strateji EA&apos;sı <Link href="/strategies" className="text-cyan-300 underline">MQL5 Stratejileri</Link> sayfasında kayıtlı; &quot;Derle&quot; ile ajan MetaEditor&apos;da derler.
          <b> KANAL Strateji EA</b> bir grafiğe takılınca Piyasa Gözlemi&apos;ndeki tüm pariteleri tarar ve <u>varsayılan olarak yalnızca uyarı verir</u> (otomatik emir kapalı). Gösterge dosyaları: KANAL3BAND, KANAL-CCI, KANAL-RSI-PANEL.
        </p>
      </Card>
    </div>
  );
}
