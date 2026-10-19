"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { Badge, Button, Card, Field, PageHeader, Skeleton, api, cx, fmtNum, useToast } from "./ui";

type Cfg = {
  enabled: boolean; exchange: string; apiKey: string; secret: string; password: string; demo: boolean;
  leverage: number; marginMode: "isolated" | "cross"; orderUsdt: number;
  agentConnected: boolean; agentLabel: string; account: Record<string, unknown> | null; marketWatch: string[];
};
const EXCH = [
  ["binance", "Binance (USDⓈ-M vadeli) — demo destekli"], ["bybit", "Bybit"], ["okx", "OKX"], ["mexc", "MEXC"], ["bitget", "Bitget"], ["gateio", "Gate.io"], ["kucoinfutures", "KuCoin Futures"],
];

export default function CryptoView() {
  const toast = useToast();
  const [cfg, setCfg] = useState<Cfg | null>(null);
  const [key, setKey] = useState(""); const [sec, setSec] = useState(""); const [pwd, setPwd] = useState("");
  const [saving, setSaving] = useState(false);

  const load = useCallback(() => api<Cfg>("/api/crypto").then(setCfg).catch(() => {}), []);
  useEffect(() => { load(); const iv = setInterval(load, 4000); return () => clearInterval(iv); }, [load]);

  const patch = async (body: Record<string, unknown>, msg?: string) => {
    setSaving(true);
    try { const c = await api<Cfg>("/api/crypto", { method: "PATCH", body }); setCfg((o) => ({ ...(o as Cfg), ...c })); if (msg) toast(msg); }
    catch (e) { toast((e as Error).message, "err"); }
    setSaving(false);
  };
  const saveKeys = () => patch({ ...(key ? { apiKey: key } : {}), ...(sec ? { secret: sec } : {}), ...(pwd ? { password: pwd } : {}) }, "Anahtarlar kaydedildi — ajan yeniden bağlanacak");

  if (!cfg) return <Card><Skeleton rows={6} /></Card>;
  const acc = cfg.account as { connected?: boolean; balance?: number; equity?: number; freeMargin?: number; currency?: string } | null;

  return (
    <div className="max-w-5xl">
      <PageHeader
        title="KRİPTO BORSASI"
        sub="Binance vadeli (USDⓈ-M) — varsayılan DEMO (test ağı). Aynı KANAL stratejisi, aynı onay kuralları; sinyaller ve Telegram bildirimleri “KRİPTO” etiketiyle gelir."
        right={<Badge tone={cfg.enabled ? (cfg.agentConnected ? "green" : "amber") : "slate"}>{!cfg.enabled ? "Kapalı" : cfg.agentConnected ? `Bağlı · ${cfg.agentLabel}` : "Açık · ajan bağlanıyor"}</Badge>}
      />

      <div className={cx("mb-4 rounded-xl border px-4 py-3 text-sm", cfg.demo ? "border-emerald-400/40 bg-emerald-400/10 text-emerald-100" : "border-rose-400/50 bg-rose-500/10 text-rose-100")}>
        {cfg.demo ? <>🧪 <b>DEMO modu:</b> emirler Binance <b>Demo Trading</b> (test ağı) hesabına gider, gerçek para kullanılmaz. Test anahtarları: <a className="underline" href="https://demo.binance.com/en/my/settings/api-management" target="_blank" rel="noreferrer">demo.binance.com → API Management</a> (önce demo hesabı açın, sanal bakiye otomatik gelir).</>
          : <>⚠️ <b>CANLI mod:</b> emirler GERÇEK hesabınıza gider. Anahtarı yalnızca “Futures işlem” izniyle oluşturun; <b>para çekme iznini kapatın</b>.</>}
      </div>

      <Card title="Bağlantı" icon="🪙" className="mb-4">
        <div className="grid gap-3 md:grid-cols-2">
          <Field label="Borsa">
            <select className="input" value={cfg.exchange} onChange={(e) => patch({ exchange: e.target.value })}>
              {EXCH.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
            </select>
          </Field>
          <Field label="Ortam">
            <div className="flex gap-1.5">
              <button onClick={() => patch({ demo: true }, "Demo (test ağı)")} className={cx("flex-1 rounded-lg border py-2 text-sm font-bold", cfg.demo ? "border-emerald-400/70 bg-emerald-400/20 text-emerald-100" : "border-slate-600/40 text-slate-400")}>🧪 Demo / test ağı</button>
              <button onClick={() => { if (confirm("CANLI moda geçilsin mi? Emirler gerçek hesabınıza gider.")) patch({ demo: false }, "CANLI mod"); }} className={cx("flex-1 rounded-lg border py-2 text-sm font-bold", !cfg.demo ? "border-rose-400/70 bg-rose-400/20 text-rose-100" : "border-slate-600/40 text-slate-400")}>⚠️ Canlı</button>
            </div>
          </Field>
          <Field label={`API Key ${cfg.apiKey ? `(kayıtlı ${cfg.apiKey})` : ""}`}><input className="input num" value={key} onChange={(e) => setKey(e.target.value)} placeholder={cfg.apiKey || "API key"} /></Field>
          <Field label={`Secret ${cfg.secret ? "(kayıtlı)" : ""}`}><input className="input num" type="password" value={sec} onChange={(e) => setSec(e.target.value)} placeholder={cfg.secret ? "••••" : "secret"} /></Field>
          {["okx", "kucoinfutures", "bitget"].includes(cfg.exchange) && <Field label="Passphrase"><input className="input" type="password" value={pwd} onChange={(e) => setPwd(e.target.value)} /></Field>}
        </div>
        <div className="mt-3 flex flex-wrap gap-2">
          <Button loading={saving} onClick={saveKeys} disabled={!key && !sec && !pwd}>Anahtarları kaydet</Button>
          <Button variant={cfg.enabled ? "danger" : "success"} loading={saving} onClick={() => patch({ enabled: !cfg.enabled }, cfg.enabled ? "Kripto kapatıldı" : "Kripto açıldı — ajan bağlanıyor")}>{cfg.enabled ? "Kapat" : "Aç"}</Button>
        </div>
        <p className="mt-2 text-[11px] text-slate-500">Anahtarlar panelde saklanır ve yalnızca sizin ajanınıza gider; ajan borsaya bilgisayarınızdan bağlanır. Ajan v3.4 gerekir (CALISTIR.bat kendini günceller; ilk açılışta <code>ccxt</code> paketini kurar).</p>
      </Card>

      <div className="grid gap-4 md:grid-cols-2">
        <Card title="İşlem büyüklüğü" icon="⚖">
          <div className="grid grid-cols-2 gap-3">
            <Field label="İşlem başına teminat (USDT)" hint="Lot yerine tutar: miktar = tutar × kaldıraç / fiyat"><input className="input" type="number" min={5} value={cfg.orderUsdt} onChange={(e) => setCfg({ ...cfg, orderUsdt: Number(e.target.value) })} onBlur={() => patch({ orderUsdt: cfg.orderUsdt })} /></Field>
            <Field label="Kaldıraç" hint="Demo'da da geçerli"><input className="input" type="number" min={1} max={125} value={cfg.leverage} onChange={(e) => setCfg({ ...cfg, leverage: Number(e.target.value) })} onBlur={() => patch({ leverage: cfg.leverage })} /></Field>
            <Field label="Teminat modu">
              <select className="input" value={cfg.marginMode} onChange={(e) => patch({ marginMode: e.target.value })}><option value="isolated">İzole (önerilen)</option><option value="cross">Çapraz</option></select>
            </Field>
            <div className="rounded-lg bg-black/30 p-2 text-[11px] text-slate-400">Örnek: 50 USDT × 5x = 250 USDT&apos;lik pozisyon. SL/TP borsada ayrı koruma emirleri olarak konur; %30&apos;da girişe çekme ve %50&apos;de yarı kâr aynen çalışır.</div>
          </div>
        </Card>
        <Card title="Hesap" icon="◆">
          {!cfg.enabled ? <p className="text-sm text-slate-400">Kapalı.</p> : !acc ? <p className="text-sm text-slate-400">Ajan bağlanınca bakiye burada görünür. Ajan açık mı? (CALISTIR.bat)</p> : (
            <div className="grid grid-cols-2 gap-2 text-sm">
              <Stat l="Cüzdan" v={`${fmtNum(acc.balance ?? 0)} ${acc.currency ?? "USDT"}`} /><Stat l="Varlık" v={fmtNum(acc.equity ?? 0)} /><Stat l="Serbest" v={fmtNum(acc.freeMargin ?? 0)} /><Stat l="Durum" v={acc.connected ? "bağlı" : "bağlı değil"} />
            </div>
          )}
          <p className="mt-3 text-xs text-slate-400">Kripto pariteleri <Link href="/watchlist" className="text-cyan-300 underline">Takip Listesi</Link> → “Kripto” bölümünden seçilir; KANAL stratejisi onları borsa mumlarıyla tarar. Sohbette: “btc kripto al”, “eth kripto sat 100 usdt”. Piyasa belirtmezseniz JARVIS sorar.</p>
        </Card>
      </div>
    </div>
  );
}

function Stat({ l, v }: { l: string; v: string }) {
  return <div className="rounded-lg bg-black/30 p-2"><div className="text-[10px] uppercase tracking-wider text-slate-500">{l}</div><div className="num font-bold text-cyan-100">{v}</div></div>;
}
