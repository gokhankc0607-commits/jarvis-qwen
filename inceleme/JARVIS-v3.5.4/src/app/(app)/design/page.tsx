import { PageHeader } from "@/components/ui";

/** Tasarım önizlemeleri (AI ile üretilmiş maketler) — uygulanan arayüz bu maketleri temel alır. */
export default function DesignPage() {
  const items = [
    { src: "/design/center-connections.png", title: "1 · Komuta Merkezi — MT5 ve Kripto bağlantı kutuları yan yana", desc: "Orb'un altında iki kart: MT5 (AKTİF · sunucu, ping, hesap, Algo) ve Kripto Borsası (BINANCE DEMO · cüzdan, varlık, kaldıraç). Altında 5 gezinme düğmesi." },
    { src: "/design/market-crypto-tab.png", title: "2 · Piyasa & Grafik — FOREX / KRİPTO sekmeleri + grafik altında işlem paneli", desc: "Üstte iki sekme (Forex MT5 / Kripto Binance). Solda seçili piyasanın takip listesi, ortada grafik (bantlar + RSI + CCI), altında AÇIK İŞLEMLER: her satırda ½ Kapat · SL→Giriş · ✎ SL/TP · Kapat." },
  ];
  return (
    <div className="max-w-6xl">
      <PageHeader title="TASARIM ÖNİZLEME" sub="İstediğin değişikliklerin görsel maketleri. Uygulanan ekranlar bu maketlere göre yapıldı; farklı olmasını istediğin yerleri söyle." />
      <div className="space-y-6">
        {items.map((it) => (
          <section key={it.src} className="glass hud-corner rounded-2xl p-4">
            <h3 className="text-sm font-bold text-cyan-200" style={{ fontFamily: "Orbitron" }}>{it.title}</h3>
            <p className="mb-3 mt-1 text-sm text-slate-400">{it.desc}</p>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={it.src} alt={it.title} className="w-full rounded-xl border border-cyan-400/20" />
          </section>
        ))}
      </div>
    </div>
  );
}
