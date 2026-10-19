"use client";

import { useCallback, useEffect, useState } from "react";
import { Badge, Button, Card, Field, PageHeader, Skeleton, api, cx, useToast } from "./ui";
import type { TgCfg } from "@/lib/telegram";

type Chat = { id: number; name: string };

const NOTIF: { key: "onSignal" | "onAuto" | "onProfit" | "onError"; label: string; desc: string }[] = [
  { key: "onSignal", label: "⚡ Sinyal", desc: "KANAL sinyali: kanal teması/taşması, o anki RSI durumu, giriş/SL/TP ve onay düğmeleri" },
  { key: "onAuto", label: "🤖 Otomatik işlem", desc: "Otomatik mod açıksa sormadan girilen işlemler ve sonuçları" },
  { key: "onProfit", label: "🛡 Kâr yönetimi", desc: "SL girişe çekme, yarı kâr alma ve kapatma" },
  { key: "onError", label: "⚠️ Hatalar", desc: "Reddedilen emirler, bağlantı hataları, Algo Trading kapalı" },
];

export default function TelegramView() {
  const toast = useToast();
  const [cfg, setCfg] = useState<TgCfg | null>(null);
  const [token, setToken] = useState("");
  const [chat, setChat] = useState("");
  const [chats, setChats] = useState<Chat[]>([]);
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [finding, setFinding] = useState(false);

  const load = useCallback(async () => {
    try {
      const c = await api<TgCfg>("/api/telegram");
      setCfg(c);
      if (c.botToken.startsWith("••••")) setToken("");
    } catch {}
  }, []);
  useEffect(() => { load(); }, [load]);

  const patch = async (body: Record<string, unknown>, okMsg?: string) => {
    setSaving(true);
    try {
      const c = await api<TgCfg>("/api/telegram", { method: "PATCH", body });
      setCfg(c);
      if (okMsg) toast(okMsg);
    } catch (e) { toast((e as Error).message, "err"); }
    setSaving(false);
  };

  const findChats = async () => {
    setFinding(true);
    try {
      const r = await api<{ chats: Chat[] }>("/api/telegram/test");
      setChats(r.chats ?? []);
      if (r.chats?.length === 1) { setChat(String(r.chats[0].id)); await patch({ chatId: String(r.chats[0].id) }, `Chat bulundu: ${r.chats[0].id}`); }
      else if (!r.chats?.length) toast("Bot'a henüz mesaj yok. Telegram'da botunuzu açıp /start yazın, sonra tekrar deneyin.", "info");
      else toast(`${r.chats.length} sohbet bulundu — birini seçin.`, "info");
    } catch (e) { toast((e as Error).message, "err"); }
    setFinding(false);
  };

  const test = async () => {
    setTesting(true);
    try {
      const r = await api<{ ok: boolean; error?: string; bot?: string }>("/api/telegram/test", { body: {} });
      toast(r.ok ? `✓ Test mesajı gönderildi (@${r.bot})` : `✗ ${r.error}`, r.ok ? "ok" : "err");
      if (!r.ok && r.error === "Chat ID boş") findChats();
    } catch (e) { toast((e as Error).message, "err"); }
    setTesting(false);
  };

  if (!cfg) return <Card><Skeleton rows={6} /></Card>;
  const quiet = cfg.quietUntil && new Date(cfg.quietUntil).getTime() > Date.now();

  return (
    <div className="max-w-4xl">
      <PageHeader
        title="TELEGRAM BOT"
        sub="Sinyal geldiğinde telefonuna bildirim gelsin: kanal teması / taşması, o anki RSI durumu, seviyeler ve onay düğmeleri."
        right={<Badge tone={cfg.enabled ? (quiet ? "amber" : "green") : "slate"}>{cfg.enabled ? (quiet ? "Susturuldu" : "Açık") : "Kapalı"}</Badge>}
      />

      <Card title="Bağlantı" icon="✈" className="mb-4">
        <ol className="mb-4 list-decimal space-y-1 pl-5 text-sm text-slate-300">
          <li>Telegram&apos;da <a className="text-cyan-300 underline" href="https://t.me/BotFather" target="_blank" rel="noreferrer">@BotFather</a> &rarr; <code>/newbot</code> &rarr; botuna bir ad ver. BotFather sana <b>token</b> verecek (örn. <code className="text-slate-400">8123…:AAF…</code>).</li>
          <li>Token&apos;ı aşağıya yapıştır, <b>Kaydet</b>.</li>
          <li><b>Chat ID&apos;yi bul</b>&apos;a bas — Telegram&apos;da botunu açıp <code>/start</code> yaz (butona basmadan önce).</li>
          <li><b>Test gönder</b> ile bildirimi doğrula, sonra <b>aç</b>.</li>
        </ol>
        <div className="grid gap-3 md:grid-cols-2">
          <Field label="Bot token">
            <input className="input num" placeholder="8123456789:AAF…" value={token} onChange={(e) => setToken(e.target.value)} onBlur={() => token && patch({ botToken: token }, "Token kaydedildi")} />
          </Field>
          <Field label="Chat ID" hint="Test düğmesi bulabilir ya da elle yazabilirsin">
            <div className="flex gap-2">
              <input className="input num" placeholder="123456789" value={chat} onChange={(e) => setChat(e.target.value)} onBlur={() => chat && patch({ chatId: chat }, "Chat ID kaydedildi")} />
              <Button variant="ghost" loading={finding} onClick={findChats}>Bul</Button>
            </div>
          </Field>
        </div>
        {chats.length > 0 && (
          <div className="mt-2 flex flex-wrap gap-1.5">
            {chats.map((c) => (
              <button key={c.id} onClick={() => { setChat(String(c.id)); patch({ chatId: String(c.id) }, `Chat seçildi: ${c.id}`); }}
                className={cx("rounded-lg border px-2.5 py-1 text-sm", String(c.id) === chat ? "border-cyan-400/60 bg-cyan-400/15 text-cyan-100" : "border-slate-600/40 text-slate-400")}>
                {c.name || "sohbet"} · <span className="num">{c.id}</span>
              </button>
            ))}
          </div>
        )}
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <Button variant="success" loading={testing} onClick={test}>Test mesajı gönder</Button>
          <Button loading={saving} onClick={() => patch({ enabled: !cfg.enabled }, cfg.enabled ? "Bildirimler kapatıldı" : "Bildirimler açıldı")}>
            {cfg.enabled ? "Kapat" : "Aç"}
          </Button>
          {quiet && <Button variant="ghost" onClick={() => patch({ quietMinutes: 0 }, "Sessizlik kaldırıldı")}>Sessizliği kaldır</Button>}
          {quiet && <span className="text-xs text-amber-300">{new Date(cfg.quietUntil!).toLocaleTimeString("tr-TR")}&apos;ne kadar sessizde</span>}
        </div>
      </Card>

      <Card title="Hangi bildirimler?" icon="◔" className="mb-4">
        <div className="space-y-2">
          {NOTIF.map((n) => (
            <label key={n.key} className="flex cursor-pointer items-start gap-3 rounded-xl border border-slate-600/25 bg-black/20 p-3">
              <input type="checkbox" className="mt-0.5 accent-cyan-400" checked={cfg[n.key]} onChange={(e) => patch({ [n.key]: e.target.checked })} />
              <span><span className="font-bold text-slate-100">{n.label}</span><span className="block text-xs text-slate-400">{n.desc}</span></span>
            </label>
          ))}
        </div>
        <div className="mt-3 grid gap-3 md:grid-cols-2">
          <Field label="Sinyal bildirimi için alt güven eşiği (%)" hint="Bu eşiğin altındaki sinyaller bildirilmez">
            <input className="input" type="number" min={30} max={99} value={cfg.minConf} onChange={(e) => patch({ minConf: Number(e.target.value) })} />
          </Field>
          <Field label="Bildirime düğme ekle" hint="✅ Evet gir / ❌ Hayır / 📊 Panelde aç / 🔕 30 dk sessiz">
            <label className="flex h-[38px] items-center gap-2 text-sm text-slate-300">
              <input type="checkbox" className="accent-cyan-400" checked={cfg.buttons} onChange={(e) => patch({ buttons: e.target.checked })} /> düğmeleri göster
            </label>
          </Field>
        </div>
      </Card>

      <Card title="Bildirim ne içerir?" icon="✉">
        <pre className="whitespace-pre-wrap rounded-xl bg-black/40 p-3 text-[12px] leading-relaxed text-slate-200" style={{ fontFamily: "JetBrains Mono" }}>{`⚡ EURUSD · M15 — ▲ ALIŞ fırsatı · güven %86
Kanal: fiyat tüm alt bantların dışında kapanış yaptı ve şimdi bantların içine döndü
Merkez 1.08700 · Üst 1.09120 · Alt 1.08280 · dışta 2.41 ATR
RSI durumu: 28.4 (30 altı · aşırı satım ✓) · CCI -134 / mor çizgi -112
Giriş 1.08560 · SL 1.08200 · TP 1.08700 · R:R 1:1.4 · 0.1 lot

⏳ Onay bekliyor. JARVIS açık bir "Evet" demeden işlem açmaz — buradan da onaylayabilirsiniz.
[✅ Evet, gir] [❌ Hayır]
[📊 Panelde aç]
[🔕 30 dk sessiz]`}</pre>
        <ul className="mt-3 list-disc space-y-1 pl-5 text-sm text-slate-400">
          <li><b>“Kanal”</b> satırı: fiyatın hangi bandı (üst / alt / tümü) aşıp nerede kapandığını ve içeri dönüşü yazar.</li>
          <li><b>“RSI durumu”</b>: o anki RSI değeri ve aşırı alım/satım notu; CCI ile mor çizgi de yazılır.</li>
          <li><b>Düğmeler</b>: “✅ Evet, gir” / “❌ Hayır” sinyali o anda onaylar/reddeder (işlem kuralları aynen uygulanır). “🔕 30 dk sessiz” bildirimleri kısa süre durdurur.</li>
          <li>Düğmelerin çalışması için <b>JARVIS ajanı (CALISTIR.bat)</b> açık olmalı — ajan düğme tıklamalarını dinler.</li>
        </ul>
      </Card>
    </div>
  );
}
