"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import PriceChart, { type ChartInfo } from "./PriceChart";
import KanalTable from "./KanalTable";
import OpenTradesPanel from "./OpenTradesPanel";
import { SymbolIcon } from "./hud";
import Link from "next/link";
import { Badge, Card, Empty, PageHeader, Skeleton, api, cx, fmtPrice } from "./ui";
import { KANAL_TFS } from "@/lib/kanal";
import type { MarketT, StateT } from "@/lib/types";

type MarketFilter = "all" | "forex" | "crypto";

export default function MarketView() {
  const [market, setMarket] = useState<MarketT | null>(null);
  const [state, setState] = useState<StateT | null>(null);
  const [sel, setSel] = useState<{ symbol: string; tf: string; market: "forex" | "crypto" } | null>(null);
  const [chartTf, setChartTf] = useState<string | null>(null);
  const [radarTf, setRadarTf] = useState<string>("all");
  const [marketFilter, setMarketFilter] = useState<MarketFilter>("all");
  const [onlyCandidates, setOnlyCandidates] = useState(true);
  const [minConfirmations, setMinConfirmations] = useState<2 | 3>(2);
  const [query, setQuery] = useState("");
  const [info, setInfo] = useState<ChartInfo | null>(null);

  // Grafik zaman dilimi: yalnızca grafik başlığından değişir; radarın TF filtresi ayrıdır.
  useEffect(() => {
    const q = new URLSearchParams(window.location.search);
    const requestedTf = q.get("tf");
    if (requestedTf && KANAL_TFS.includes(requestedTf as (typeof KANAL_TFS)[number])) {
      setChartTf(requestedTf);
      try { localStorage.setItem("jarvis_market_tf", requestedTf); } catch {}
    } else {
      try {
        const saved = localStorage.getItem("jarvis_market_tf");
        setChartTf(saved && KANAL_TFS.includes(saved as (typeof KANAL_TFS)[number]) ? saved : null);
      } catch {}
    }
  }, []);

  const pickChartTf = (tf: string) => {
    setChartTf(tf);
    setSel((prev) => prev ? { ...prev, tf } : prev);
    try { localStorage.setItem("jarvis_market_tf", tf); } catch {}
  };

  const load = useCallback(() => {
    // Her çağrıda tüm kayıtlı parite/TF'leri alırız; radar filtresi tamamen istemci tarafındadır.
    api<MarketT>("/api/market").then(setMarket).catch(() => {});
    api<StateT>("/api/state").then(setState).catch(() => {});
  }, []);

  useEffect(() => {
    load();
    const iv = setInterval(load, 3000);
    return () => clearInterval(iv);
  }, [load]);

  useEffect(() => {
    const quotes = market?.quotes ?? [];
    if (!quotes.length) return;
    const params = new URLSearchParams(window.location.search);
    const wantSymbol = params.get("symbol")?.toUpperCase();
    const wantMarket = params.get("market") === "crypto" ? "crypto" : "forex";
    const currentQuote = sel ? quotes.find((q) => q.symbol === sel.symbol && q.market === sel.market) : undefined;
    if (currentQuote && sel) {
      if (chartTf && currentQuote.tfs.includes(chartTf) && sel.tf !== chartTf) setSel({ ...sel, tf: chartTf });
      else if (!currentQuote.tfs.includes(sel.tf)) {
        const fallback = currentQuote.tfs.find((t) => KANAL_TFS.includes(t as (typeof KANAL_TFS)[number])) ?? KANAL_TFS[0];
        setSel({ ...sel, tf: fallback });
        setChartTf(fallback);
      }
      return;
    }
    const q = quotes.find((x) => x.symbol === wantSymbol && x.market === wantMarket)
      ?? quotes.find((x) => x.symbol === wantSymbol)
      ?? quotes[0];
    if (!q) return;
    const available = q.tfs.find((t) => KANAL_TFS.includes(t as (typeof KANAL_TFS)[number]));
    const chosenTf = chartTf && q.tfs.includes(chartTf) ? chartTf : available ?? KANAL_TFS[0];
    setSel({ symbol: q.symbol, tf: chosenTf, market: q.market });
    if (!chartTf || !q.tfs.includes(chartTf)) setChartTf(chosenTf);
  }, [market, sel, chartTf]);

  useEffect(() => { setInfo(null); }, [sel?.symbol, sel?.tf, sel?.market]);

  const allQuotes = market?.quotes ?? [];
  const allRows = market?.kanal ?? [];
  const selQuote = allQuotes.find((q) => q.symbol === sel?.symbol && q.market === sel?.market);
  const shownRows = useMemo(() => allRows.filter((r) => {
    if (marketFilter !== "all" && r.market !== marketFilter) return false;
    if (radarTf !== "all" && r.tf !== radarTf) return false;
    if (onlyCandidates && (r.stage < minConfirmations || !r.side)) return false;
    if (query.trim() && !r.symbol.toLowerCase().includes(query.trim().toLowerCase())) return false;
    return true;
  }), [allRows, marketFilter, radarTf, onlyCandidates, minConfirmations, query]);
  const nCandidates = allRows.filter((r) => r.stage >= 2 && r.side).length;
  const nFullSignals = allRows.filter((r) => r.stage === 5 && r.armed).length;
  const marketBadge = market?.live ? "CANLI · MT5 / BORSA" : "DEMO VERİ";

  const chooseRow = (symbol: string, tf: string) => {
    const row = allRows.find((r) => r.symbol === symbol && r.tf === tf);
    if (!row) return;
    setSel({ symbol, tf, market: row.market });
    setChartTf(tf);
    try { localStorage.setItem("jarvis_market_tf", tf); } catch {}
  };

  return (
    <div>
      <PageHeader
        title="PİYASA & GRAFİK"
        sub="Grafik üstte; tüm paritelerin sıralı KANAL adayları ve filtreleri alttaki RADAR'da."
        right={market && <Badge tone={market.live ? "green" : "amber"}>{marketBadge}</Badge>}
      />

      {!market ? <Card><Skeleton rows={6} /></Card> : (
        <>
          {allQuotes.length === 0 && allRows.length === 0 ? (
            <Card>
              <Empty icon="◭" title="Henüz takip edilen parite yok" hint="Takip Listesi veya KANAL Strateji sayfasından Forex/Kripto pariteleri ekleyin."
                action={<div className="flex gap-2"><Link href="/watchlist" className="rounded-lg border border-cyan-400/50 bg-cyan-400/10 px-3 py-1.5 text-sm font-bold text-cyan-100">Takip Listesi →</Link><Link href="/kanal" className="rounded-lg border border-violet-400/40 bg-violet-400/10 px-3 py-1.5 text-sm font-bold text-violet-100">KANAL ayarları →</Link></div>} />
            </Card>
          ) : (
            <>
              {/* Grafik alanı korunur: sadece TF düğmeleri sembol başlığının yanına alınmıştır. */}
              <Card className="mb-4">
                <div className="mb-2 flex flex-wrap items-center justify-between gap-3">
                  <div className="flex flex-wrap items-center gap-3">
                    {selQuote && <SymbolIcon symbol={selQuote.symbol} category={selQuote.category} size={34} />}
                    <div>
                      <div className="text-2xl font-black leading-none">{sel?.symbol ?? "Parite seçin"}</div>
                      <div className="mt-1 flex flex-wrap gap-1">
                        {KANAL_TFS.map((t) => {
                          const available = !selQuote?.tfs?.length || selQuote.tfs.includes(t);
                          return <button key={t} disabled={!available} onClick={() => pickChartTf(t)}
                            title={available ? `Grafiği ${t} zaman dilimine geçir` : `${t} verisi ajan tarafından gönderilmiyor`}
                            className={cx("rounded-md px-2.5 py-1 text-xs font-bold transition", (sel?.tf ?? chartTf) === t ? "bg-cyan-400/25 text-cyan-100" : "text-slate-400 hover:text-cyan-200", !available && "cursor-not-allowed opacity-30")}>
                            {t}
                          </button>;
                        })}
                      </div>
                    </div>
                  </div>
                  <div className="flex items-center gap-5">
                    <Metric label="RSI" value={info?.rsi?.toFixed(1) ?? "—"} tone={info?.rsi != null && info.rsi <= 30 ? "g" : info?.rsi != null && info.rsi >= 70 ? "r" : undefined} />
                    <Metric label="CCI" value={info?.cci?.toFixed(0) ?? "—"} tone={info?.cci != null && info.cci <= -100 ? "g" : info?.cci != null && info.cci >= 100 ? "r" : undefined} />
                    <div className="text-right">
                      <div className="num text-3xl font-bold leading-none">{fmtPrice(info?.price)}</div>
                      {info && <div className={cx("num text-sm font-semibold", info.change >= 0 ? "text-emerald-300" : "text-rose-300")}>{info.change >= 0 ? "+" : ""}{info.changePct.toFixed(2)}%</div>}
                    </div>
                  </div>
                </div>
                {sel && <PriceChart symbol={sel.symbol} tf={sel.tf} market={sel.market} height={560} osc onInfo={setInfo} />}
                <p className="mt-1 text-[11px] text-slate-500">RSI ve CCI korunur; üçüncü alt panelde GMMA OSC ve sinyal çizgisi eklenmiştir. TF seçimi sembol başlığının yanındadır; radar filtresi alttan bağımsız seçilir.</p>
              </Card>

              <Card title="RADAR · Tüm pariteler" icon="◎" className="mb-4"
                right={<div className="flex flex-wrap items-center gap-2 text-xs">
                  <Badge tone={market.live ? "green" : "amber"}>{market.live ? "CANLI" : "DEMO"}</Badge>
                  <Badge tone="slate">{allQuotes.length} parite</Badge>
                  <Badge tone={nCandidates ? "amber" : "slate"}>{nCandidates} aday · 2+ onay</Badge>
                  <Badge tone={nFullSignals ? "green" : "slate"}>{nFullSignals} tam 5/5</Badge>
                </div>}>
                <div className="mb-3 flex flex-wrap items-center gap-3 rounded-xl border border-slate-700/40 bg-black/20 p-2.5">
                  <div className="flex flex-wrap items-center gap-1.5">
                    <span className="mr-1 text-[10px] font-bold uppercase tracking-widest text-slate-500">TF</span>
                    {["all", ...KANAL_TFS].map((t) => <button key={t} onClick={() => setRadarTf(t)}
                      className={cx("rounded-md border px-2.5 py-1.5 text-[11px] font-bold", radarTf === t ? "border-cyan-400/60 bg-cyan-400/15 text-cyan-100" : "border-slate-600/30 text-slate-400 hover:text-cyan-200")}>
                      {t === "all" ? "Tümü" : t}
                    </button>)}
                  </div>
                  <div className="flex flex-wrap items-center gap-1.5">
                    <span className="mr-1 text-[10px] font-bold uppercase tracking-widest text-slate-500">Piyasa</span>
                    {([ ["all", "Tümü"], ["forex", "Forex"], ["crypto", "Kripto"] ] as [MarketFilter, string][]).map(([key, label]) => <button key={key} onClick={() => setMarketFilter(key)}
                      className={cx("rounded-md border px-2.5 py-1.5 text-[11px] font-bold", marketFilter === key ? key === "crypto" ? "border-amber-400/50 bg-amber-400/10 text-amber-100" : "border-emerald-400/40 bg-emerald-400/10 text-emerald-100" : "border-slate-600/30 text-slate-400 hover:text-cyan-200")}>
                      {label}{key === "forex" ? ` · ${allQuotes.filter((q) => q.market === "forex").length}` : key === "crypto" ? ` · ${allQuotes.filter((q) => q.market === "crypto").length}` : ""}
                    </button>)}
                  </div>
                  <label className="flex cursor-pointer items-center gap-2 rounded-md border border-cyan-400/20 bg-cyan-400/5 px-2.5 py-1.5 text-[11px] font-semibold text-slate-200">
                    <input type="checkbox" checked={onlyCandidates} onChange={(e) => setOnlyCandidates(e.target.checked)} className="accent-cyan-400" />
                    Sadece sinyal adayları
                  </label>
                  <div className="flex items-center gap-1.5">
                    <span className="text-[10px] font-bold uppercase tracking-widest text-slate-500">Onay</span>
                    {([2, 3] as const).map((count) => <button key={count} onClick={() => setMinConfirmations(count)}
                      className={cx("rounded-md border px-2.5 py-1.5 text-[11px] font-bold", minConfirmations === count ? "border-amber-400/50 bg-amber-400/10 text-amber-100" : "border-slate-600/30 text-slate-400 hover:text-amber-100")}>
                      {count}+ onay
                    </button>)}
                  </div>
                  <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Parite ara…" className="input ml-auto min-w-[145px] max-w-[200px] !py-1.5 text-xs" />
                </div>
                <div className="mb-2 flex flex-wrap items-center justify-between gap-2 text-[11px] text-slate-500">
                  <span>{onlyCandidates ? `En az ${minConfirmations} onayı olan adaylar gösteriliyor.` : "Tüm tarama satırları gösteriliyor."} Aday rozeti işlem sinyali değildir.</span>
                  <span><b className="text-slate-300">5/5</b> koşul sağlanınca AL/SAT sinyali oluşur. Satıra tıklayınca grafik parite ve TF'ye geçer.</span>
                </div>
                <KanalTable items={shownRows} onlyActive={false} showMarket onSelect={chooseRow} />
              </Card>

              <Card title={`Açık İşlemler · ${sel?.market === "crypto" ? "Kripto" : "Forex"}`} icon="⇅" right={<Link href="/trades" className="text-xs text-cyan-400 hover:underline">tüm işlemler →</Link>}>
                {!state ? <Skeleton rows={2} /> : <OpenTradesPanel trades={state.openTrades} onChanged={load} highlightSymbol={sel?.symbol} market={sel?.market ?? "forex"} compact />}
              </Card>
            </>
          )}
        </>
      )}
    </div>
  );
}

function Metric({ label, value, tone }: { label: string; value: string; tone?: "g" | "r" }) {
  return <div className="text-center"><div className="text-[10px] uppercase tracking-widest text-slate-500">{label}</div><div className={cx("num text-xl font-bold", tone === "g" ? "text-emerald-300" : tone === "r" ? "text-rose-300" : "text-violet-200")}>{value}</div></div>;
}
