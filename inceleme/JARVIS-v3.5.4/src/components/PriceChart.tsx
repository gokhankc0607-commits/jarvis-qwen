"use client";

import { useEffect, useRef, useState } from "react";
import {
  createChart, createSeriesMarkers, CandlestickSeries, LineSeries, HistogramSeries, ColorType, CrosshairMode, LineStyle,
  type IChartApi, type ISeriesApi, type IPriceLine, type ISeriesMarkersPluginApi, type Time, type UTCTimestamp,
} from "lightweight-charts";
import { gmmaOscillator, type Candle, type RadarCfg } from "@/lib/indicators";
import { kanalSeries, kanalAnalyze, KANAL_DEFAULTS, type KanalParams } from "@/lib/kanal";
import { Spinner, cx } from "./ui";

type TradeLine = { side: string; volume: number; openPrice: number; sl: number | null; tp: number | null };
type Resp = { live: boolean; candles: Candle[]; ageMs: number | null; tick: { bid: number; ask: number; age: number; stale: number } | null; cfg: RadarCfg; kp?: KanalParams; trades: TradeLine[] };
export type ChartInfo = { price: number | null; change: number; changePct: number; rsi: number | null; cci: number | null; live: boolean; tickAge: number | null; dataAge: number | null; stale: number };

const T = (n: number) => n as UTCTimestamp;
const UP = "rgba(255,82,82,0.9)";
const DN = "rgba(0,230,118,0.9)";

/** Mum + KANAL3BAND + hacim; osc=true ise RSI, CCI(+MA) ve GMMA OSC alt panelleri. */
export default function PriceChart({
  symbol, tf, market = "forex", height = 260, osc = false, refreshMs = 2000, onInfo,
}: { symbol: string; tf: string; market?: "forex" | "crypto"; height?: number; osc?: boolean; refreshMs?: number; onInfo?: (i: ChartInfo) => void }) {
  const box = useRef<HTMLDivElement>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const S = useRef<{
    candle?: ISeriesApi<"Candlestick">; vol?: ISeriesApi<"Histogram">;
    center?: ISeriesApi<"Line">; up: ISeriesApi<"Line">[]; dn: ISeriesApi<"Line">[];
    rsi?: ISeriesApi<"Line">; cci?: ISeriesApi<"Line">; cciMa?: ISeriesApi<"Line">;
    gmma?: ISeriesApi<"Line">; gmmaSignal?: ISeriesApi<"Line">;
    markers?: ISeriesMarkersPluginApi<Time>;
    lines: IPriceLine[]; ref: { ser: ISeriesApi<"Line">; line: IPriceLine }[]; fitted: string;
  }>({ up: [], dn: [], lines: [], ref: [], fitted: "" });
  const [state, setState] = useState<"loading" | "ok" | "empty">("loading");
  const followRef = useRef(true); // canlı ucu takip et (kullanıcı geriye kaydırınca durur)
  const [following, setFollowing] = useState(true);
  const [freeY, setFreeY] = useState(false); // dikey serbest kaydırma (otomatik ölçek kapalı)
  const lastLen = useRef(0);
  const infoRef = useRef(onInfo);
  infoRef.current = onInfo;

  /* ---- grafiği oluştur ---- */
  useEffect(() => {
    if (!box.current) return;
    const chart = createChart(box.current, {
      autoSize: true,
      layout: { background: { type: ColorType.Solid, color: "transparent" }, textColor: "#7fb4e6", fontSize: 11, panes: { separatorColor: "rgba(56,189,248,0.25)" } },
      grid: { vertLines: { color: "rgba(56,189,248,0.06)" }, horzLines: { color: "rgba(56,189,248,0.08)" } },
      rightPriceScale: { borderColor: "rgba(56,189,248,0.25)" },
      timeScale: { borderColor: "rgba(56,189,248,0.25)", timeVisible: true, secondsVisible: false, rightOffset: 4 },
      crosshair: { mode: CrosshairMode.Normal },
      // sürükle-kaydır (yatay + otomatik ölçek kapalıyken dikey), tekerlek/pinç yakınlaştır, eksenleri sürükleyerek ölçekle
      handleScroll: { mouseWheel: true, pressedMouseMove: true, horzTouchDrag: true, vertTouchDrag: true },
      handleScale: { mouseWheel: true, pinch: true, axisPressedMouseMove: { time: true, price: true }, axisDoubleClickReset: { time: true, price: true } },
      kineticScroll: { mouse: true, touch: true },
    });
    chartRef.current = chart;
    // kullanıcı geçmişe kaydırınca canlı takibi durdur, sağ uca dönünce yeniden başlat
    chart.timeScale().subscribeVisibleLogicalRangeChange(() => {
      const pos = chart.timeScale().scrollPosition();
      const f = pos > -2;
      if (f !== followRef.current) {
        followRef.current = f;
        setFollowing(f);
      }
    });
    const s: typeof S.current = { up: [], dn: [], lines: [], ref: [], fitted: "" };
    S.current = s;
    s.candle = chart.addSeries(CandlestickSeries, {
      upColor: "#34d399", downColor: "#fb7185", wickUpColor: "#34d399", wickDownColor: "#fb7185", borderVisible: false,
    });
    s.markers = createSeriesMarkers(s.candle, []);
    const base = { lineWidth: 1 as const, priceLineVisible: false, lastValueVisible: false, crosshairMarkerVisible: false };
    for (let k = 0; k < 3; k++) {
      s.up.push(chart.addSeries(LineSeries, { ...base, color: UP }));
      s.dn.push(chart.addSeries(LineSeries, { ...base, color: DN }));
    }
    s.center = chart.addSeries(LineSeries, { ...base, color: "#2962ff", lineWidth: 2 });
    s.vol = chart.addSeries(HistogramSeries, { priceFormat: { type: "volume" }, priceScaleId: "vol", lastValueVisible: false, priceLineVisible: false });
    chart.priceScale("vol").applyOptions({ scaleMargins: { top: 0.86, bottom: 0 } });
    if (osc) {
      s.rsi = chart.addSeries(LineSeries, { color: "#a78bfa", lineWidth: 2, priceLineVisible: false, title: "RSI" }, 1);
      s.cci = chart.addSeries(LineSeries, { color: "#38bdf8", lineWidth: 2, priceLineVisible: false, title: "CCI" }, 2);
      s.cciMa = chart.addSeries(LineSeries, { color: "#a855f7", lineWidth: 2, priceLineVisible: false, lastValueVisible: false, title: "MA" }, 2);
      // Üçüncü osilatör: verilen Pine kodundaki Guppy GMMA OSC + EMA(10) sinyal çizgisi.
      s.gmma = chart.addSeries(LineSeries, { color: "#34d399", lineWidth: 2, priceLineVisible: false, title: "GMMA OSC" }, 3);
      s.gmmaSignal = chart.addSeries(LineSeries, { color: "#f59e0b", lineWidth: 1, priceLineVisible: false, lastValueVisible: false, title: "GMMA Signal" }, 3);
      const panes = chart.panes();
      panes[0]?.setStretchFactor(3.2);
      panes[1]?.setStretchFactor(1);
      panes[2]?.setStretchFactor(1);
      panes[3]?.setStretchFactor(1);
    }
    return () => {
      chart.remove();
      chartRef.current = null;
      S.current = { up: [], dn: [], lines: [], ref: [], fitted: "" };
    };
  }, [osc]);

  /** Görünümü sıfırla: son ~150 mum, tüm fiyat eksenlerinde otomatik ölçek, canlı takip açık. */
  const resetView = (n?: number) => {
    const ch = chartRef.current;
    if (!ch) return;
    const len = n ?? lastLen.current;
    ch.priceScale("right").applyOptions({ autoScale: true });
    try {
      // RSI / CCI / GMMA osilatör panellerinin fiyat ölçekleri
      [S.current.rsi, S.current.cci, S.current.gmma].forEach((ser) => ser?.priceScale().applyOptions({ autoScale: true }));
    } catch {}
    ch.timeScale().setVisibleLogicalRange({ from: Math.max(0, len - 150), to: len + 4 });
    followRef.current = true;
    setFollowing(true);
    setFreeY(false);
  };
  const zoom = (k: number) => {
    const ts = chartRef.current?.timeScale();
    const r = ts?.getVisibleLogicalRange();
    if (!ts || !r) return;
    const mid = followRef.current ? r.to : (r.from + r.to) / 2;
    const half = Math.max(10, ((r.to - r.from) * k) / 2);
    ts.setVisibleLogicalRange(followRef.current ? { from: mid - half * 2, to: mid } : { from: mid - half, to: mid + half });
  };
  const toggleFreeY = () => {
    const ch = chartRef.current;
    if (!ch) return;
    const v = !freeY;
    ch.priceScale("right").applyOptions({ autoScale: !v });
    setFreeY(v);
  };

  /* ---- veriyi çek ve çiz ---- */
  useEffect(() => {
    let dead = false;
    setState("loading");
    const load = async () => {
      try {
        const r = await fetch(`/api/market/candles?symbol=${encodeURIComponent(symbol)}&tf=${tf}&market=${market}`, { cache: "no-store" });
        if (r.status === 401) { window.location.href = "/login"; return; }
        const j = (await r.json()) as Resp;
        if (dead || !chartRef.current) return;
        const s = S.current;
        const off = j.live ? 0 : -new Date().getTimezoneOffset() * 60; // demo: yerel saat
        const cs = j.candles;
        if (!cs.length) { setState("empty"); return; }
        const t = (c: Candle) => T(c.time + off);
        // Kullanıcı canlı uçtaysa, yeni mum eklendiğinde görünümü kaydır (aksi halde son fiyat ekran dışında kalır)
        const newBar = cs.length !== lastLen.current;
        lastLen.current = cs.length;
        s.candle?.setData(cs.map((c) => ({ time: t(c), open: c.open, high: c.high, low: c.low, close: c.close })));
        s.vol?.setData(cs.map((c) => ({ time: t(c), value: c.volume, color: c.close >= c.open ? "rgba(52,211,153,0.3)" : "rgba(251,113,133,0.3)" })));
        const toLine = (arr: (number | null)[]) => arr.flatMap((v, i) => (v === null ? [] : [{ time: t(cs[i]), value: v }]));

        const kp = j.kp ?? KANAL_DEFAULTS;
        // Son aktif kurulumun kilometre taşlarını mum grafiğinde etiketle (M0, MR, RSI ve CCI).
        const setup = kanalAnalyze(symbol, tf, cs, kp);
        const ks = kanalSeries(cs, kp);
        const guppyBlockedBar = kp.guppyConfirm && setup?.side && setup.stage === 5 && setup.guppyOk === false ? cs.length - 2 : -1;
        // Son kapanmış mumda OSC yönü tersine döndüyse çıkış rozeti ekle.
        const guppyExitBar = setup && (setup.guppyExit === "cross" || setup.guppyExit === "zone") ? cs.length - 2 : -1;
        const eventNames = [
          [setup?.events.m0, "M0"], [setup?.events.mr, "MR"], [setup?.events.rsi, "RSI"], [setup?.events.cci, "CCI"],
          [guppyBlockedBar >= 0 ? cs[guppyBlockedBar].time : undefined, "GUPPY ✕"],
          [guppyExitBar >= 0 ? cs[guppyExitBar].time : undefined, setup?.guppyExit === "zone" ? "GUPPY ◌ ÇIKIŞ" : "GUPPY ↯ ÇIKIŞ"],
        ] as const;
        const markerTimes = new Set<number>();
        const markers = eventNames.flatMap(([time, text]) => {
          if (time === null || time === undefined || markerTimes.has(time)) return [];
          markerTimes.add(time);
          const idx = cs.findIndex((c) => c.time === time);
          const upSignal = setup?.side !== "SELL";
          const withMove = text === "M0" || text === "RSI";
          const isGuppy = String(text).startsWith("GUPPY");
          return idx < 0 ? [] : [{
            time: t(cs[idx]), position: (isGuppy ? !upSignal : withMove ? upSignal : !upSignal) ? "belowBar" as const : "aboveBar" as const,
            color: text === "M0" ? "#fbbf24" : text === "MR" ? "#38bdf8" : text === "RSI" ? "#a78bfa" : isGuppy ? "#22d3ee" : "#c084fc",
            shape: (isGuppy ? !upSignal : withMove ? upSignal : !upSignal) ? "arrowUp" as const : "arrowDown" as const, text,
          }];
        }).sort((a, b) => Number(a.time) - Number(b.time));
        s.markers?.setMarkers(markers);
        s.center?.setData(toLine(ks.center));
        for (let k = 0; k < 3; k++) {
          const sel = [kp.atrMult1, kp.atrMult2, kp.atrMult3][k] === Math.max(kp.atrMult1, kp.atrMult2, kp.atrMult3); // en dış bant (strateji bunu kullanır)
          s.up[k]?.setData(toLine(ks.up[k]));
          s.dn[k]?.setData(toLine(ks.dn[k]));
          s.up[k]?.applyOptions({ lineWidth: sel ? 2 : 1 });
          s.dn[k]?.applyOptions({ lineWidth: sel ? 2 : 1 });
        }
        if (osc) {
          s.rsi?.setData(toLine(ks.rsi));
          s.cci?.setData(toLine(ks.cci));
          s.cciMa?.setData(toLine(ks.cciMa));
          // GMMA OSC paneli strateji ayarlarıyla hizalı: seçilen set + sinyal EMA periyodu.
          const gm = ks.guppy;
          s.gmma?.setData(toLine(gm.osc));
          s.gmmaSignal?.setData(toLine(gm.signal));
          s.ref.forEach((r) => r.ser.removePriceLine(r.line));
          s.ref = [];
          const mk = (ser: ISeriesApi<"Line"> | undefined, price: number, color: string) => {
            if (ser) s.ref.push({ ser, line: ser.createPriceLine({ price, color, lineWidth: 1, lineStyle: LineStyle.Dashed, axisLabelVisible: true, title: "" }) });
          };
          mk(s.rsi, kp.rsiOb, "rgba(251,113,133,0.8)"); mk(s.rsi, kp.rsiOs, "rgba(52,211,153,0.8)");
          mk(s.cci, 200, "rgba(251,113,133,0.6)"); mk(s.cci, -200, "rgba(52,211,153,0.6)"); mk(s.cci, 0, "rgba(148,163,184,0.5)");
          mk(s.gmma, 0, "rgba(148,163,184,0.65)");
        }

        // açık işlem çizgileri
        s.lines.forEach((l) => s.candle?.removePriceLine(l));
        s.lines = [];
        for (const tr of j.trades) {
          const col = tr.side === "BUY" ? "#34d399" : "#fb7185";
          const add = (price: number | null, color: string, title: string, style: LineStyle) => {
            if (price && s.candle) s.lines.push(s.candle.createPriceLine({ price, color, lineWidth: 1, lineStyle: style, axisLabelVisible: true, title }));
          };
          add(tr.openPrice, col, `${tr.side} ${tr.volume}`, LineStyle.Solid);
          add(tr.sl, "#f43f5e", "SL", LineStyle.Dashed);
          add(tr.tp, "#22c55e", "TP", LineStyle.Dashed);
        }
        const key = `${market}:${symbol}|${tf}`;
        if (s.fitted !== key) {
          // YENİ PARİTE / ZAMAN DİLİMİ: görünümü ve fiyat eksenini sıfırla (eski paritenin fiyat aralığında kalmasın)
          resetView(cs.length);
          s.fitted = key;
        } else if (followRef.current && newBar) {
          chartRef.current.timeScale().scrollToRealTime();
        }

        const last = cs[cs.length - 1].close;
        const n = cs.length;
        const back = Math.max(1, Math.min(n - 1, 96));
        const ref = cs[n - 1 - back].close;
        infoRef.current?.({ price: last, change: last - ref, changePct: ((last - ref) / ref) * 100, rsi: ks.rsi[n - 1], cci: ks.cci[n - 1], live: j.live, tickAge: j.tick?.age ?? null, dataAge: j.ageMs === null ? null : j.ageMs / 1000, stale: j.tick?.stale ?? 0 });
        setState("ok");
      } catch {
        if (!dead) setState((p) => (p === "loading" ? "empty" : p));
      }
    };
    S.current.fitted = "";
    lastLen.current = 0;
    // eski paritenin mumlarını hemen kaldır (yeni veri gelene kadar yanlış fiyat görünmesin)
    try {
      const s0 = S.current;
      s0.candle?.setData([]); s0.vol?.setData([]); s0.center?.setData([]);
      s0.up.forEach((x) => x.setData([])); s0.dn.forEach((x) => x.setData([]));
      s0.rsi?.setData([]); s0.cci?.setData([]); s0.cciMa?.setData([]); s0.gmma?.setData([]); s0.gmmaSignal?.setData([]);
    } catch {}
    load();
    const iv = setInterval(load, refreshMs);
    return () => { dead = true; clearInterval(iv); };
  }, [symbol, tf, market, osc, refreshMs]);

  return (
    <div className="relative w-full" style={{ height }}>
      <div ref={box} className="absolute inset-0" onDoubleClick={() => resetView()} />
      {state === "ok" && (
        <div className="absolute left-1.5 top-1.5 z-10 flex flex-wrap gap-1 text-[11px]">
          <button onClick={() => resetView()} title="Ortala: son mumlar + otomatik fiyat ölçeği (çift tıklama da olur)" className="rounded-md border border-cyan-400/30 bg-black/60 px-1.5 py-0.5 font-bold text-cyan-100 hover:bg-cyan-400/20">⟲ Ortala</button>
          <button onClick={() => zoom(0.7)} title="Yakınlaştır" className="rounded-md border border-cyan-400/30 bg-black/60 px-1.5 py-0.5 font-bold text-cyan-100 hover:bg-cyan-400/20">＋</button>
          <button onClick={() => zoom(1.4)} title="Uzaklaştır" className="rounded-md border border-cyan-400/30 bg-black/60 px-1.5 py-0.5 font-bold text-cyan-100 hover:bg-cyan-400/20">－</button>
          <button onClick={toggleFreeY} title="Dikey serbest kaydırma: grafiği yukarı/aşağı sürükleyin" className={cx("rounded-md border px-1.5 py-0.5 font-bold", freeY ? "border-amber-400/60 bg-amber-400/20 text-amber-100" : "border-cyan-400/30 bg-black/60 text-cyan-100 hover:bg-cyan-400/20")}>↕ {freeY ? "Serbest" : "Oto ölçek"}</button>
          {!following && (
            <button onClick={() => { chartRef.current?.timeScale().scrollToRealTime(); followRef.current = true; setFollowing(true); }} title="Canlı uca dön" className="rounded-md border border-emerald-400/50 bg-emerald-400/15 px-1.5 py-0.5 font-bold text-emerald-100 hover:bg-emerald-400/25">⏭ Canlı</button>
          )}
        </div>
      )}
      {state !== "ok" && (
        <div className="absolute inset-0 flex items-center justify-center text-center text-sm text-slate-400">
          {state === "loading" ? <span className="flex items-center gap-2"><Spinner /> grafik yükleniyor…</span> : (
            <span>
              Bu parite/zaman dilimi için veri yok.<br />
              <span className="text-xs text-slate-500">Canlı modda ajan, izleme kuralındaki pariteleri gönderir (ajanı güncelleyin).</span>
            </span>
          )}
        </div>
      )}
    </div>
  );
}
