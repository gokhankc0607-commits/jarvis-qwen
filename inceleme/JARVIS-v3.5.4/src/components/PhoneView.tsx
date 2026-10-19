"use client";

import { useCallback, useEffect, useState } from "react";
import { Button, Card, PageHeader, Skeleton, Spinner, api, cx, useToast } from "./ui";

type PhoneUrl = { label: string; base: string; link: string; qr: string };
type Resp = { urls: PhoneUrl[]; expiresAt: string; local: boolean; port: string };

export default function PhoneView() {
  const toast = useToast();
  const [data, setData] = useState<Resp | null>(null);
  const [idx, setIdx] = useState(0);
  const [busy, setBusy] = useState(false);
  const [left, setLeft] = useState(0);

  const load = useCallback(async () => {
    setBusy(true);
    try {
      const r = await api<Resp>("/api/phone");
      setData(r);
      setIdx(0);
    } catch (e) {
      toast((e as Error).message, "err");
    }
    setBusy(false);
  }, [toast]);

  useEffect(() => { load(); }, [load]);
  useEffect(() => {
    if (!data) return;
    const tick = () => setLeft(Math.max(0, Math.floor((new Date(data.expiresAt).getTime() - Date.now()) / 1000)));
    tick();
    const iv = setInterval(tick, 1000);
    return () => clearInterval(iv);
  }, [data]);

  const cur = data?.urls[idx];
  const mm = String(Math.floor(left / 60)).padStart(2, "0");
  const ss = String(left % 60).padStart(2, "0");

  return (
    <div className="max-w-5xl">
      <PageHeader title="TELEFON BAĞLANTISI" sub="QR kodu telefonunun kamerasıyla okut — giriş yapmadan komuta merkezi telefonunda açılır." />
      <div className="grid gap-4 md:grid-cols-[380px_minmax(0,1fr)]">
        <Card title="QR ile Bağlan" icon="▯">
          {!data ? <Skeleton rows={5} /> : !cur ? (
            <div className="rounded-xl border border-dashed border-amber-400/30 p-4 text-sm text-amber-200">
              Bilgisayarın yerel ağ (Wi-Fi/Ethernet) adresi bulunamadı. Bilgisayarın ağa bağlı olduğundan emin olup yenileyin.
            </div>
          ) : (
            <div className="flex flex-col items-center gap-3">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={cur.qr} alt="QR" className={cx("h-[290px] w-[290px] rounded-2xl border-4 border-white bg-white shadow-[0_0_40px_-6px_rgba(34,211,238,0.8)]", left === 0 && "opacity-20 blur-sm")} />
              <div className="text-center">
                <div className="num break-all text-sm text-cyan-200">{cur.base}</div>
                <div className={cx("mt-1 text-xs", left === 0 ? "text-rose-300" : "text-slate-400")}>
                  {left === 0 ? "Süre doldu — yenileyin" : `Tek kullanımlık · ${mm}:${ss} geçerli`}
                </div>
              </div>
              {data.urls.length > 1 && (
                <div className="flex flex-wrap justify-center gap-1.5">
                  {data.urls.map((u, i) => (
                    <button key={u.base} onClick={() => setIdx(i)} className={cx("rounded-lg border px-2 py-1 text-xs", i === idx ? "border-cyan-400/60 bg-cyan-400/15 text-cyan-100" : "border-slate-600/40 text-slate-400")}>
                      {u.base.replace("http://", "")}
                    </button>
                  ))}
                </div>
              )}
              <Button onClick={load} loading={busy} variant="ghost">↻ Yeni QR üret</Button>
            </div>
          )}
          {busy && !data && <div className="mt-2 flex justify-center"><Spinner /></div>}
        </Card>

        <div className="space-y-4">
          <Card title="Nasıl Çalışır?" icon="◈">
            <ol className="list-decimal space-y-2 pl-5 text-sm text-slate-300">
              <li>Telefon ve bilgisayar <b>aynı Wi-Fi ağında</b> olmalı.</li>
              <li>Bilgisayarda panel açık kalmalı (<code className="text-cyan-200">PANEL_BASLAT.bat</code> penceresi).</li>
              <li>Telefon kamerasını QR&apos;a tutun ve çıkan bağlantıya dokunun → komuta merkezi açılır, oturum otomatik açılır.</li>
              <li>Tarayıcı menüsünden <b>“Ana ekrana ekle”</b> derseniz uygulama gibi tek dokunuşla açılır.</li>
            </ol>
          </Card>
          <Card title="Çalışmazsa" icon="!">
            <ul className="list-disc space-y-2 pl-5 text-sm text-slate-300">
              <li><b>Sayfa açılmıyor:</b> Windows Güvenlik Duvarı engelliyor olabilir. İlk açılışta çıkan “Node.js — erişime izin ver” penceresinde <b>Özel ağlar</b>&apos;ı işaretleyin. Kaçırdıysanız yönetici PowerShell:
                <pre className="num mt-1 overflow-x-auto rounded-lg bg-black/40 p-2 text-[11px] text-cyan-100">netsh advfirewall firewall add rule name=&quot;JARVIS Panel&quot; dir=in action=allow protocol=TCP localport={data?.port ?? "3000"} profile=private</pre>
              </li>
              <li><b>QR süresi doldu / “expired”:</b> “Yeni QR üret” — her QR yalnızca bir kez kullanılır.</li>
              <li><b>Birden fazla adres var:</b> 192.168.x.x ile başlayan Wi-Fi adresini seçin.</li>
              <li><b>Telefonda mikrofon:</b> tarayıcılar mikrofonu yalnızca <b>https</b> adreslerde açar; yerel ağda (http) yazarak komut verebilir, JARVIS&apos;in sesli yanıtlarını duyabilirsiniz. Sesli komutlar için bilgisayardaki ajan (faster-whisper) kullanılır.</li>
              <li><b>Güvenlik:</b> QR yalnızca aynı ağdaki cihazlarda çalışır. Paneli internete açmayın; uzaktan erişim için VPN (ör. Tailscale) kullanın.</li>
            </ul>
          </Card>
        </div>
      </div>
    </div>
  );
}
