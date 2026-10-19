"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import Orb, { type OrbMode } from "./Orb";
import PriceChart, { type ChartInfo } from "./PriceChart";
import RadarTable from "./RadarTable";
import KanalTable from "./KanalTable";
import OrderTicket from "./OrderTicket";
import type { KanalItem } from "@/lib/kanal";
import {
  HudPanel, HudTitle, IconBrain, IconChart, IconGear, IconGlobe, IconMarket, IconPhone, IconPosition, IconPulse,
  IconRadar, IconSignal, IconTrade, Ring, SymbolIcon, Spark, FlashNum, TfBadge, MarketBadge,
} from "./hud";
import { Badge, Button, Modal, Skeleton, api, cx, fmtNum, fmtPrice, timeAgo, useToast } from "./ui";
import { CATEGORY_TABS, type Category } from "@/lib/tf";
import type { MarketT, Msg, Signal, StateT } from "@/lib/types";

/* eslint-disable @typescript-eslint/no-explicit-any */
type SR = any;

const rr = (s: Signal) => (s.sl && s.tp && s.price !== s.sl ? Math.abs(s.tp - s.price) / Math.abs(s.price - s.sl) : null);
const hhmm = (d: string) => new Date(d).toLocaleTimeString("tr-TR", { hour: "2-digit", minute: "2-digit" });
const signed = (n: number, d = 2) => `${n >= 0 ? "+" : ""}${fmtNum(n, d)}`;

export default function CommandCenter() {
  const toast = useToast();
  const [state, setState] = useState<StateT | null>(null);
  const [market, setMarket] = useState<MarketT | null>(null);
  const [kanal, setKanal] = useState<{ items: KanalItem[]; live: boolean; watch: string[]; settings: { enabled: boolean; timeframes: string; params: { rsiOb: number; rsiOs: number }; auto?: { enabled: boolean; minConf: number; beAtPct: number } } } | null>(null);
  const [msgs, setMsgs] = useState<Msg[]>([]);
  const [mode, setMode] = useState<OrbMode>("idle");
  const [input, setInput] = useState("");
  const [voiceOn, setVoiceOn] = useState(true);
  const [interim, setInterim] = useState("");
  const [tab, setTab] = useState<Category | null>(null);
  const [sel, setSel] = useState<{ symbol: string; tf: string } | null>(null);
  const [info, setInfo] = useState<ChartInfo | null>(null);
  const [chatOpen, setChatOpen] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [orderOpen, setOrderOpen] = useState(false);
  const [dis, setDis] = useState<Record<string, string>>({});
  useEffect(() => {
    try { setDis(JSON.parse(localStorage.getItem("jarvis_dismiss") || "{}")); } catch {}
  }, []);
  /** Kapatılan uyarı, aynı içerikle (sig) tekrar çıkmaz; içerik değişirse yeniden görünür. */
  const hide = useCallback((id: string, sig: string) => {
    setDis((d) => {
      const n = { ...d, [id]: sig };
      try { localStorage.setItem("jarvis_dismiss", JSON.stringify(n)); } catch {}
      return n;
    });
  }, []);
  const shown = (id: string, sig: string) => dis[id] !== sig;
  /* Bildirim bantları ilk görünmesinden 2 dk sonra kendiliğinden kapanır (aynı içerik tekrar çıkmaz). */
  const visRef = useRef<{ id: string; sig: string }[]>([]);
  const seenAt = useRef<Map<string, number>>(new Map());
  useEffect(() => {
    const iv = setInterval(() => {
      const now = Date.now();
      for (const v of visRef.current) {
        const k = `${v.id}|${v.sig}`;
        const t0 = seenAt.current.get(k);
        if (t0 === undefined) seenAt.current.set(k, now);
        else if (now - t0 >= 120000) hide(v.id, v.sig);
      }
    }, 5000);
    return () => clearInterval(iv);
  }, [hide]);
  const [now, setNow] = useState<Date | null>(null);
  const [orbSize, setOrbSize] = useState(470);
  const level = useRef(0);
  const seenSignals = useRef<Set<number> | null>(null);
  const seenAuto = useRef<Set<number> | null>(null);
  const recRef = useRef<SR>(null);
  const audioRef = useRef<{ ctx: AudioContext; stream: MediaStream; raf: number } | null>(null);
  const histEnd = useRef<HTMLDivElement>(null);
  const selRef = useRef<string | null>(null);
  const voiceOnRef = useRef(voiceOn);
  voiceOnRef.current = voiceOn;

  /* ---------- saat / ekran boyutu ---------- */
  useEffect(() => {
    setNow(new Date());
    const iv = setInterval(() => setNow(new Date()), 1000);
    const fit = () => setOrbSize(window.innerWidth < 640 ? 320 : window.innerWidth < 1280 ? 430 : 480);
    fit();
    window.addEventListener("resize", fit);
    return () => { clearInterval(iv); window.removeEventListener("resize", fit); };
  }, []);

  /* ---------- polling ---------- */
  const load = useCallback(async () => {
    try {
      const s = await api<StateT>("/api/state");
      setState(s);
      // Otomatik açılan işlemleri duyur
      const autos = s.recentSignals.filter((x) => x.source === "auto");
      if (seenAuto.current === null) seenAuto.current = new Set(autos.map((x) => x.id));
      else
        for (const x of autos)
          if (!seenAuto.current.has(x.id)) {
            seenAuto.current.add(x.id);
            if (x.status === "executed") toast(`🤖 Otomatik: ${x.symbol} ${x.timeframe} ${x.side === "BUY" ? "AL" : "SAT"} açıldı · güven %${x.confidence}`, "info");
            else if (x.status === "failed") toast(`🤖 Otomatik ${x.symbol} emri gönderilemedi: ${x.note}`, "err");
          }
      if (seenSignals.current === null) {
        seenSignals.current = new Set(s.pendingSignals.map((x) => x.id));
      } else {
        const fresh = s.pendingSignals.filter((x) => !seenSignals.current!.has(x.id) && x.source !== "manual");
        s.pendingSignals.forEach((x) => seenSignals.current!.add(x.id));
        fresh.forEach((x) => seenSignals.current!.add(x.id));
        if (fresh[0]) announce(fresh[0]);
      }
    } catch {}
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const loadMarket = useCallback(() => {
    api<MarketT>("/api/market").then(setMarket).catch(() => {});
    api<any>("/api/kanal").then(setKanal).catch(() => {});
  }, []);

  useEffect(() => {
    load();
    loadMarket();
    api<Msg[]>("/api/chat").then(setMsgs).catch(() => {});
    const a = setInterval(load, 3000);
    const b = setInterval(loadMarket, 3000);
    return () => { clearInterval(a); clearInterval(b); };
  }, [load, loadMarket]);

  useEffect(() => {
    if (!market?.quotes.length) return;
    if (!sel || !market.quotes.some((q) => q.symbol === sel.symbol)) {
      const q = market.quotes[0];
      setSel({ symbol: q.symbol, tf: q.tfs[0] });
    }
  }, [market, sel]);

  useEffect(() => { histEnd.current?.scrollIntoView({ block: "nearest" }); }, [msgs, chatOpen]);
  useEffect(() => { setInfo(null); }, [sel?.symbol, sel?.tf]); // parite değişince eski fiyat başlıkta kalmasın

  /* ---------- TTS ---------- */
  const speak = useCallback((text: string, then?: () => void) => {
    if (!voiceOnRef.current || typeof window === "undefined" || !("speechSynthesis" in window)) {
      setMode("idle");
      then?.();
      return;
    }
    window.speechSynthesis.cancel();
    const u = new SpeechSynthesisUtterance(text);
    u.lang = "tr-TR";
    const v = window.speechSynthesis.getVoices().find((x) => x.lang.toLowerCase().startsWith("tr"));
    if (v) u.voice = v;
    u.rate = 1.02;
    u.pitch = 0.9;
    let iv: ReturnType<typeof setInterval> | null = null;
    u.onstart = () => {
      setMode("speaking");
      iv = setInterval(() => { level.current = Math.max(level.current * 0.6, 0.25 + Math.random() * 0.45); }, 70);
    };
    u.onboundary = () => { level.current = 0.85 + Math.random() * 0.15; };
    const end = () => { if (iv) clearInterval(iv); level.current = 0; setMode("idle"); then?.(); };
    u.onend = end;
    u.onerror = end;
    window.speechSynthesis.speak(u);
  }, []);

  /* ---------- mikrofon seviyesi ---------- */
  const startMeter = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const ctx = new AudioContext();
      const src = ctx.createMediaStreamSource(stream);
      const an = ctx.createAnalyser();
      an.fftSize = 512;
      src.connect(an);
      const buf = new Uint8Array(an.frequencyBinCount);
      const tick = () => {
        an.getByteTimeDomainData(buf);
        let sum = 0;
        for (const b of buf) sum += ((b - 128) / 128) ** 2;
        level.current = Math.min(1, Math.sqrt(sum / buf.length) * 5);
        audioRef.current!.raf = requestAnimationFrame(tick);
      };
      audioRef.current = { ctx, stream, raf: requestAnimationFrame(tick) };
    } catch {}
  };
  const stopMeter = () => {
    const a = audioRef.current;
    if (!a) return;
    cancelAnimationFrame(a.raf);
    a.stream.getTracks().forEach((t) => t.stop());
    a.ctx.close();
    audioRef.current = null;
    level.current = 0;
  };

  /* ---------- gönder ---------- */
  const send = useCallback(async (text: string) => {
    const t = text.trim();
    if (!t) return;
    setMsgs((m) => [...m, { id: -Date.now(), role: "user", content: t, createdAt: new Date().toISOString() }]);
    setInput("");
    setMode("thinking");
    try {
      const r = await api<{ reply: string; action: string | null; message: Msg }>("/api/chat", { body: { text: t, context: { symbol: selRef.current } } });
      setMsgs((m) => [...m, r.message]);
      if (r.action) load();
      speak(r.reply);
    } catch (e) {
      setMode("idle");
      toast((e as Error).message, "err");
    }
  }, [load, speak, toast]);

  /* ---------- STT ---------- */
  const listen = useCallback(() => {
    const W = window as any;
    const Ctor = W.SpeechRecognition || W.webkitSpeechRecognition;
    if (!Ctor) {
      toast("Bu tarayıcıda/bağlantıda ses tanıma yok (telefonda http üzerinden mikrofon çalışmaz). Yazarak devam edin.", "info");
      return;
    }
    if (recRef.current) { recRef.current.stop(); return; }
    window.speechSynthesis?.cancel();
    const rec = new Ctor();
    rec.lang = "tr-TR";
    rec.interimResults = true;
    rec.continuous = false;
    let finalText = "";
    rec.onstart = () => { setMode("listening"); startMeter(); };
    rec.onresult = (e: any) => {
      let s = "";
      for (let i = e.resultIndex; i < e.results.length; i++) {
        if (e.results[i].isFinal) finalText += e.results[i][0].transcript;
        else s += e.results[i][0].transcript;
      }
      setInterim(finalText + s);
    };
    rec.onerror = () => {};
    rec.onend = () => {
      stopMeter();
      recRef.current = null;
      setInterim("");
      if (finalText.trim()) send(finalText);
      else setMode("idle");
    };
    recRef.current = rec;
    rec.start();
  }, [send, toast]);

  const announce = (s: Signal) => {
    const txt = `Efendim, ${s.symbol} paritesinde ${s.side === "BUY" ? "alış" : "satış"} fırsatı oluştu. Güven skoru yüzde ${s.confidence}. İşleme gireyim mi?`;
    toast(`Yeni sinyal: ${s.symbol} ${s.side}`, "info");
    setMsgs((m) => [...m, { id: -Date.now(), role: "assistant", content: txt, createdAt: new Date().toISOString() }]);
    speak(txt, () => voiceOnRef.current && listen());
  };

  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement).tagName;
      if (e.code === "Space" && tag !== "INPUT" && tag !== "TEXTAREA" && tag !== "SELECT" && tag !== "BUTTON") {
        e.preventDefault();
        listen();
      }
    };
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
  }, [listen]);

  /* ---------- sinyal kararı (iyimser) ---------- */
  const decide = async (s: Signal, approve: boolean) => {
    setState((st) => (st ? { ...st, pendingSignals: st.pendingSignals.filter((x) => x.id !== s.id) } : st));
    try {
      const r = await api<Signal>(`/api/signals/${s.id}`, { method: "PATCH", body: { decision: approve ? "approve" : "reject" } });
      toast(approve ? (r.status === "approved" ? "Onaylandı · MT5 ajanına iletildi" : "Onaylandı · Demo işlem açıldı") : "Sinyal reddedildi");
      load();
    } catch (e) {
      toast((e as Error).message, "err");
      load();
    }
  };

  const retrySignal = async (id: number) => {
    hide(`fail:${id}`, "1");
    try {
      await api<Signal>(`/api/signals/${id}`, { method: "PATCH", body: { decision: "retry" } });
      toast("Emir ajana yeniden iletildi", "info");
      load();
    } catch (e) {
      hide(`fail:${id}`, "");
      toast((e as Error).message, "err");
    }
  };

  const logout = async () => {
    await fetch("/api/auth/logout", { method: "POST" });
    window.location.href = "/login";
  };

  /* ---------- türetilmiş veriler ---------- */
  const a = state?.account;
  const floating = state?.openTrades.reduce((s, t) => s + t.pnl, 0) ?? 0;
  const pending = state?.pendingSignals[0];
  const quotes = market?.quotes ?? [];
  const activeTab: Category = tab ?? CATEGORY_TABS.find((t) => quotes.some((q) => q.category === t.key))?.key ?? "forex";
  const tabQuotes = quotes.filter((q) => q.category === activeTab);
  const selQuote = quotes.find((q) => q.symbol === sel?.symbol);
  selRef.current = sel?.symbol ?? null;
  const radarActive = (market?.radar ?? []).filter((r) => r.signal || r.tags.length);
  const radarSignals = radarActive.filter((r) => r.signal).length;
  const lastAssistant = [...msgs].reverse().find((m) => m.role === "assistant");
  const ag = state?.agent;
  const tickAge = ag?.tickAge ?? null;
  const minStale = quotes.length && quotes.every((q) => q.tickAge !== null) ? Math.min(...quotes.map((q) => q.stale)) : 0;
  const feed: "wait" | "demo" | "none" | "live" | "slow" | "down" | "closed" = !state ? "wait" : !ag?.online ? "demo" : tickAge === null ? "none" : tickAge > 20 ? "down" : tickAge > 5 ? "slow" : minStale > 120 ? "closed" : "live";
  const feedErrs = ag?.feedErrors ?? [];
  const connState = !state ? "wait" : state.agentOnline ? (a?.connected ? "live" : "nomt5") : "demo";

  const cities = useMemo(
    () => [
      { n: "Londra", tz: "Europe/London", o: [8, 17] },
      { n: "New York", tz: "America/New_York", o: [8, 17] },
      { n: "Tokyo", tz: "Asia/Tokyo", o: [9, 18] },
      { n: "Sydney", tz: "Australia/Sydney", o: [8, 17] },
    ],
    []
  );
  const cityTime = (tz: string, o: number[]) => {
    if (!now) return { t: "--:--", open: false };
    const parts = new Intl.DateTimeFormat("en-GB", { timeZone: tz, hour: "2-digit", minute: "2-digit", hour12: false, weekday: "short" }).formatToParts(now);
    const get = (k: string) => parts.find((p) => p.type === k)?.value ?? "";
    const h = Number(get("hour"));
    const wk = !["Sat", "Sun"].includes(get("weekday"));
    return { t: `${get("hour")}:${get("minute")}`, open: wk && h >= o[0] && h < o[1] };
  };

  const navBtn = "hud-nav block h-[62px] w-full cursor-pointer text-center";

  /* ======================================================================== */
  return (
    <div className="relative mx-auto max-w-[1780px] px-3 pb-6 pt-3 md:px-5">
      {/* ---------------- ÜST ÇUBUK ---------------- */}
      <header>
        <div className="flex items-center justify-between gap-3">
          <Link href="/dashboard" className="flex items-center gap-3">
            <div className="relative h-10 w-10 shrink-0 rounded-full border-2 border-cyan-300/70 shadow-[0_0_22px_rgba(34,211,238,0.8)]">
              <div className="absolute inset-1.5 rounded-full bg-gradient-to-br from-white via-cyan-300 to-blue-600" />
            </div>
            <div className="leading-none">
              <span className="neon-text text-[26px] font-black tracking-[0.28em] text-cyan-100" style={{ fontFamily: "Orbitron" }}>JARVIS</span>
              <span className="ml-4 hidden text-[11px] font-semibold tracking-[0.35em] text-cyan-300/80 sm:inline">AI TRADING ASSISTANT</span>
            </div>
          </Link>
          <div className="hud-wrap hidden lg:block">
            <div className="hud-panel" style={{ ["--c" as string]: "14px" }}>
              <div className="hud-panel-in !px-10 !py-1.5 text-center text-[12px] font-bold tracking-[0.22em] text-cyan-100" style={{ ["--c" as string]: "13.5px" }}>
                &quot;DAHA İYİ KARARLAR &nbsp;•&nbsp; DAHA GÜÇLÜ YARINLAR&quot;
              </div>
            </div>
          </div>
          <div className="flex items-center gap-4 text-right">
            <div className="hidden text-[12px] font-semibold text-cyan-100/90 md:block">
              {now ? now.toLocaleDateString("tr-TR", { day: "numeric", month: "long", year: "numeric", weekday: "long" }) : ""}
            </div>
            <div className="num text-[22px] font-bold tracking-wider text-white neon-text md:text-[26px]">
              {now ? now.toLocaleTimeString("tr-TR", { hour12: false }) : "--:--:--"}
            </div>
          </div>
        </div>
        <div className="hud-line mt-2" />
      </header>

      {/* ---------------- DURUM ŞERİDİ ---------------- */}
      <div className="mt-3 flex flex-wrap items-center gap-2 text-[12px]">
        <Chip tone={connState === "live" ? "g" : connState === "wait" ? "n" : "a"} label="MT5" value={connState === "live" ? "bağlı" : connState === "demo" ? "demo" : connState === "nomt5" ? "MT5 yok" : "…"} />
        <Chip tone={feed === "live" ? "g" : feed === "down" ? "r" : feed === "wait" || feed === "demo" ? "n" : "a"} label="Fiyat akışı"
          value={feed === "live" ? `canlı · ${tickAge!.toFixed(1)} sn` : feed === "slow" ? `gecikmeli · ${tickAge!.toFixed(0)} sn` : feed === "down" ? `DURDU · ${tickAge!.toFixed(0)} sn` : feed === "closed" ? "değişmiyor (piyasa kapalı?)" : feed === "none" ? "akış yok" : feed === "demo" ? "simüle" : "…"} />
        {ag?.online && <Chip tone={ag.algo ? "g" : "r"} label="Algo Trading" value={ag.algo ? "AÇIK" : "KAPALI"} />}
        {ag?.online && <Chip tone={ag.outdated || !ag.version ? "a" : "g"} label="Ajan" value={ag.version ? `v${ag.version}${ag.outdated ? " · güncelle" : ""}` : "eski sürüm"} />}
        {state?.crypto?.enabled && <Link href="/crypto"><Chip tone={state.crypto.connected ? "a" : "n"} label="₿ Kripto" value={state.crypto.connected ? state.crypto.label || "bağlı" : "bağlanıyor"} /></Link>}
        {kanal?.settings.auto && (
          <Link href="/kanal"><Chip tone={kanal.settings.auto.enabled ? "a" : "n"} label="🤖 Oto-işlem" value={kanal.settings.auto.enabled ? `AÇIK · güven ≥%${kanal.settings.auto.minConf}` : "kapalı (sorar)"} /></Link>
        )}
        <span className="ml-auto flex gap-2">
          <button onClick={() => setOrderOpen(true)} className="rounded-lg border border-cyan-400/50 bg-cyan-400/15 px-3 py-1 font-bold tracking-wide text-cyan-100 hover:bg-cyan-400/25">＋ Hızlı Emir</button>
        </span>
      </div>
      {(() => {
        const today = new Date().toDateString();
        const feedSig = feedErrs.map(([k]) => k).sort().join("|");
        const items: { id: string; sig: string; el: React.ReactNode }[] = [];
        if (ag?.online && !ag.algo)
          items.push({ id: "algo", sig: today, el: (
            <Banner tone="r" title="MT5'te Algo Trading KAPALI — emir gönderilemez" onClose={() => hide("algo", today)}>
              MT5 üst çubuğundaki <b>Algo Trading</b> düğmesini yeşil yapın; ayrıca Araçlar → Seçenekler → Uzman Danışmanlar → <b>“Algoritmik ticarete izin ver”</b> kutusunu işaretleyin.
            </Banner>) });
        if (ag?.online && !ag.tradeAllowed)
          items.push({ id: "trade", sig: today, el: <Banner tone="r" title="Bu hesapta işlem izni yok" onClose={() => hide("trade", today)}>Hesaba salt-okunur (yatırımcı) şifresiyle girilmiş ya da broker algoritmik işleme izin vermiyor olabilir.</Banner> });
        for (const f of state?.failedSignals ?? [])
          items.push({ id: `fail:${f.id}`, sig: "1", el: (
            <Banner tone="r" title={`${f.symbol} ${f.side} emri gönderilemedi`} action={<button onClick={() => retrySignal(f.id)} className="rounded-md border border-rose-300/50 px-2 py-1 text-xs font-bold hover:bg-rose-400/20">↻ Tekrar dene</button>} onClose={() => hide(`fail:${f.id}`, "1")}>
              {f.note || "Neden bildirilmedi."}
            </Banner>) });
        if (ag?.online && ag.ticks === 0)
          items.push({ id: "noticks", sig: today, el: <Banner tone="a" title="Canlı fiyat akışı gelmiyor" onClose={() => hide("noticks", today)}>Ajan eski sürüm olabilir ya da izleme listeniz boş. <Link href="/agent" className="underline">Yerel Ajan</Link> sayfasındaki güncelleme adımlarına bakın.</Banner> });
        if (ag?.online && ag.outdated)
          items.push({ id: "outdated", sig: ag.version ?? "", el: <Banner tone="a" title={`Ajan güncel değil (v${ag.version} → v${ag.latest})`} onClose={() => hide("outdated", ag.version ?? "")}><b>CALISTIR.bat</b> ile açarsanız ajan kendini otomatik günceller. SL/TP değiştirme ve sohbet emirleri için v{ag.latest} gerekir.</Banner> });
        if (ag?.online && feedErrs.length > 0)
          items.push({ id: "feed", sig: feedSig, el: (
            <Banner tone="a" title={`${feedErrs.length} sembol/zaman diliminde veri alınamadı`} onClose={() => hide("feed", feedSig)}>
              {feedErrs.slice(0, 4).map(([k, v]) => <div key={k} className="num text-[11px]">{k}: {v}</div>)}
              <div className="mt-1 text-[11px] opacity-80">Ajan v2.9 brokerdaki adları otomatik eşler (US100 → NAS100, US30 → DJ30, XAUUSD → GOLD, EURUSD → EURUSD.m). Hâlâ görünüyorsa <Link href="/rules" className="underline">İzleme Kuralları</Link>&apos;nda sembolü brokerdaki adıyla değiştirin.</div>
            </Banner>) });
        const vis = items.filter((i) => shown(i.id, i.sig));
        visRef.current = vis.map((i) => ({ id: i.id, sig: i.sig }));
        return (
          <>
            {vis.map((i) => <div key={i.id}>{i.el}</div>)}
            {vis.length > 1 && (
              <div className="mt-1 text-right">
                <span className="mr-3 text-[10px] text-slate-500">uyarılar 2 dk sonra kendiliğinden kapanır</span>
                <button onClick={() => vis.forEach((i) => hide(i.id, i.sig))} className="text-[11px] font-bold text-slate-400 hover:text-cyan-200">✕ Tüm uyarıları gizle</button>
              </div>
            )}
          </>
        );
      })()}

      <div className="mt-4 grid gap-4 xl:grid-cols-[minmax(340px,1fr)_minmax(440px,1.22fr)_minmax(340px,1fr)]">
        {/* ================= SOL ================= */}
        <div className="order-2 space-y-4 xl:order-1">
          {/* Piyasa özeti */}
          <HudPanel>
            <HudTitle icon={<IconMarket />} right={
              <span className="flex items-center gap-2 text-[10px] font-bold">
                {market && <Badge tone={market.live ? "green" : "amber"}>{market.live ? "CANLI" : "DEMO"}</Badge>}
                <Link href="/market" className="text-cyan-400 hover:underline">grafik →</Link>
              </span>
            }>Piyasa Özeti</HudTitle>
            <div className="mb-2 flex flex-wrap gap-x-4 gap-y-1 border-b border-cyan-400/15 pb-2">
              {CATEGORY_TABS.map((t) => (
                <button key={t.key} className="hud-tab" data-active={activeTab === t.key} onClick={() => setTab(t.key)}>
                  {t.label}
                  {quotes.some((q) => q.category === t.key) && <span className="ml-1 text-[9px] text-cyan-400">●</span>}
                </button>
              ))}
            </div>
            {!market ? <Skeleton rows={5} /> : tabQuotes.length === 0 ? (
              <div className="rounded-xl border border-dashed border-cyan-400/20 py-6 text-center text-sm text-slate-400">
                Bu kategoride takip edilen parite yok.<br />
                <Link href="/rules" className="text-cyan-300 underline">İzleme Kuralları</Link>&apos;ndan parite ekleyin.
              </div>
            ) : (
              <div className="space-y-0.5">
                {tabQuotes.map((q) => {
                  const up = q.changePct >= 0;
                  const rsiTone = q.rsi === null ? "text-slate-500" : q.rsi <= 30 ? "text-emerald-300" : q.rsi >= 70 ? "text-rose-300" : "text-slate-300";
                  return (
                    <button key={q.symbol} onClick={() => setSel({ symbol: q.symbol, tf: q.tfs.includes(sel?.tf ?? "") ? sel!.tf : q.tfs[0] })}
                      className={cx("hud-row flex w-full items-center gap-2 rounded-md px-1.5 py-[7px] text-left", sel?.symbol === q.symbol && "bg-cyan-400/10")}>
                      <SymbolIcon symbol={q.symbol} category={q.category} />
                      <span className="w-[74px] shrink-0 text-[14px] font-bold text-white">{q.symbol}</span>
                      <FlashNum value={q.price} className="num w-[78px] shrink-0 text-right text-[14px] text-slate-100">{fmtPrice(q.price)}</FlashNum>
                      <span className={cx("num w-[66px] shrink-0 text-right text-[12px] font-semibold", up ? "text-emerald-300" : "text-rose-300")}>
                        {up ? "▲" : "▼"} {Math.abs(q.changePct).toFixed(2)}%
                      </span>
                      <span className={cx("num hidden w-[62px] shrink-0 text-right text-[11px] font-bold sm:inline", rsiTone)} title="RSI">
                        {q.signal && <span className="mr-0.5 text-amber-300">⚡</span>}
                        {q.rsi === null ? "RSI —" : `RSI ${q.rsi.toFixed(0)}`}
                      </span>
                      <span className="ml-auto"><Spark data={q.spark} up={up} w={74} h={24} /></span>
                    </button>
                  );
                })}
              </div>
            )}
          </HudPanel>

          {/* Son sinyaller */}
          <HudPanel>
            <HudTitle icon={<IconSignal />} right={<Link href="/signals" className="text-[11px] font-bold text-cyan-400 hover:underline">tümü →</Link>}>Son Sinyaller</HudTitle>
            {!state ? <Skeleton rows={4} /> : state.recentSignals.length === 0 ? (
              <div className="py-5 text-center text-sm text-slate-400">Henüz sinyal yok.</div>
            ) : (
              <div className="space-y-0.5">
                {state.recentSignals.slice(0, 6).map((s) => {
                  const r = rr(s);
                  return (
                    <Link href="/signals" key={s.id} className="hud-row flex items-center gap-2 rounded-md px-1.5 py-[6px]">
                      <SymbolIcon symbol={s.symbol} category={s.symbol.startsWith("XAU") ? "metals" : s.symbol.startsWith("BTC") || s.symbol.startsWith("ETH") ? "crypto" : s.symbol.startsWith("US") || s.symbol.startsWith("GER") ? "indices" : "forex"} size={22} />
                      <span className="w-[72px] shrink-0 text-[13px] font-bold text-white">{s.symbol}</span>
                      <span className="w-8 shrink-0 text-[11px] text-slate-400">{s.timeframe}</span>
                      <span className={cx("w-[58px] shrink-0 text-[13px] font-extrabold", s.side === "BUY" ? "text-emerald-300" : "text-rose-300")}>
                        {s.side === "BUY" ? "▲" : "▼"} {s.side}
                      </span>
                      <span className="num w-[44px] shrink-0 text-[12px] font-bold text-emerald-300">{r ? `+${r.toFixed(1)}R` : "—"}</span>
                      <span className="ml-auto flex items-center gap-2">
                        {s.status === "pending" && <span className="h-1.5 w-1.5 rounded-full bg-amber-400 pulse-dot" />}
                        <span className="num text-[12px] text-slate-400">{hhmm(s.createdAt)}</span>
                      </span>
                    </Link>
                  );
                })}
              </div>
            )}
          </HudPanel>

          {/* Açık pozisyonlar */}
          <HudPanel>
            <HudTitle icon={<IconPosition />} right={<Link href="/trades" className="text-[11px] font-bold text-cyan-400 hover:underline">yönet →</Link>}>Açık Pozisyonlar</HudTitle>
            {!state ? <Skeleton rows={4} /> : state.openTrades.length === 0 ? (
              <div className="py-5 text-center text-sm text-slate-400">Açık pozisyon yok. Onayladığınız sinyaller burada görünür.</div>
            ) : (
              <div className="scroll-thin overflow-x-auto">
                <table className="w-full min-w-[470px] text-[12px]">
                  <thead>
                    <tr className="text-left text-[10px] text-slate-400">
                      <th className="pb-1 font-semibold">Sembol</th><th className="font-semibold">TF</th><th className="font-semibold">Yön</th><th className="font-semibold">Lot</th>
                      <th className="text-right font-semibold">Giriş</th><th className="text-right font-semibold">Güncel</th>
                      <th className="text-right font-semibold">SL</th><th className="text-right font-semibold">TP</th><th className="text-right font-semibold">P/L</th>
                    </tr>
                  </thead>
                  <tbody className="num">
                    {state.openTrades.slice(0, 6).map((t) => (
                      <tr key={t.id} className="hud-row cursor-pointer" onClick={() => market?.quotes.some((q) => q.symbol === t.symbol) && setSel({ symbol: t.symbol, tf: market.quotes.find((q) => q.symbol === t.symbol)!.tfs[0] })}>
                        <td className="py-[5px] font-bold text-white" style={{ fontFamily: "Rajdhani" }}>{t.symbol}{t.market === "crypto" && <span className="ml-1 text-[9px] text-amber-300" title="Kripto borsası">🪙</span>}</td>
                        <td><TfBadge tf={t.timeframe} comment={t.comment} /></td>
                        <td className={cx("font-extrabold", t.side === "BUY" ? "text-emerald-300" : "text-rose-300")}>{t.side}</td>
                        <td>{t.volume.toFixed(2)}</td>
                        <td className="text-right">{fmtPrice(t.openPrice)}</td>
                        <td className="text-right text-cyan-200">{fmtPrice(t.currentPrice)}</td>
                        <td className="text-right text-slate-400">{fmtPrice(t.sl)}</td>
                        <td className="text-right text-slate-400">{fmtPrice(t.tp)}</td>
                        <td className={cx("text-right font-bold", t.pnl >= 0 ? "text-emerald-300" : "text-rose-300")}>{signed(t.pnl, 1)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
            <div className="mt-2 flex items-center justify-between border-t border-cyan-400/15 pt-2">
              <span className="text-[13px] font-bold text-slate-200">Toplam K/Z</span>
              <span className={cx("num text-[22px] font-black", floating >= 0 ? "text-emerald-300" : "text-rose-300")} style={{ textShadow: "0 0 12px currentColor" }}>
                {floating >= 0 ? "↗ +" : "↘ "}{fmtNum(floating, 1)} <span className="text-[12px] font-semibold">{a?.currency ?? "USD"}</span>
              </span>
            </div>
          </HudPanel>
        </div>

        {/* ================= ORTA ================= */}
        <div className="order-1 flex min-w-0 flex-col items-center xl:order-2">
          <div className="flex w-full items-start justify-between gap-2">
            <HudPanel className="w-[132px] sm:w-[150px]" innerClassName="!px-3 !py-3 text-center">
              <IconBrain size={34} className="mx-auto text-cyan-300 drop-shadow-[0_0_8px_#22d3ee]" />
              <div className="mt-1.5 text-[11px] font-bold leading-[1.45] tracking-[0.12em] text-slate-100">ANALİZ<br />TARAMA<br />SİNYAL<br />İŞLEM</div>
            </HudPanel>
            <div className="mt-1 flex flex-wrap justify-center gap-1.5 text-[10px]">
              {state?.provider ? <Badge tone={state.provider.isLocal ? "cyan" : "violet"}>{state.provider.isLocal ? "Yerel" : "Bulut"} · {state.provider.model}</Badge> : <Badge tone="red">LLM yok</Badge>}
              <button onClick={() => { setVoiceOn(!voiceOn); window.speechSynthesis?.cancel(); }} className="rounded-md border border-slate-600/50 px-1.5 py-0.5 font-bold uppercase tracking-wider text-slate-300 hover:text-cyan-200">
                {voiceOn ? "🔊 Ses" : "🔇 Sessiz"}
              </button>
            </div>
            <HudPanel className="w-[132px] sm:w-[150px]" innerClassName="!px-3 !py-3 text-center">
              <IconPulse size={34} className="mx-auto text-cyan-300 drop-shadow-[0_0_8px_#22d3ee]" />
              <div className="mt-1.5 text-[10px] font-bold leading-[1.5] tracking-[0.1em] text-slate-100">PİYASA<br />VERİLERİ<br />TEKNİK ANALİZ<br />RİSK YÖNETİMİ</div>
            </HudPanel>
          </div>

          {/* ORB */}
          <div className="relative -mt-14 flex w-full flex-col items-center sm:-mt-20">
            <div className="hud-beam pointer-events-none absolute -top-10 left-1/2 h-[55%] w-[150px] -translate-x-1/2" />
            <button onClick={listen} className="relative z-10 cursor-pointer outline-none" title="Konuşmak için tıklayın (Space)" style={{ width: orbSize, height: orbSize, maxWidth: "100%" }}>
              <Orb mode={mode} levelRef={level} size={orbSize} variant="hud" />
              <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center">
                <div className="text-center text-white" style={{ fontFamily: "Orbitron", textShadow: "0 0 18px #38bdf8, 0 0 40px #2563eb" }}>
                  <div className="text-[26px] font-black tracking-[0.3em] sm:text-[34px]">JARVIS</div>
                  <div className="mt-1 text-[9px] font-bold tracking-[0.35em] text-cyan-200 sm:text-[11px]">AI COMMAND CENTER</div>
                </div>
              </div>
            </button>
            <div className="pointer-events-none relative -mt-16 h-14 w-full sm:-mt-20 sm:h-20">
              <div className="hud-ellipse" style={{ width: orbSize * 0.78, height: orbSize * 0.16, top: 4 }} />
              <div className="hud-ellipse" style={{ width: orbSize * 0.6, height: orbSize * 0.12, top: 12, opacity: 0.7 }} />
              <div className="hud-ellipse" style={{ width: orbSize * 0.42, height: orbSize * 0.08, top: 20, opacity: 0.55 }} />
            </div>
          </div>

          {/* Onay bekleyen sinyal */}
          {pending && (
            <div className="hud-wrap fade-up z-10 mb-3 w-full max-w-xl">
              <div className="hud-panel" style={{ background: "linear-gradient(135deg,#fbbf24,#f59e0b,#fb923c)" }}>
                <div className="hud-panel-in">
                  <div className="flex items-center justify-between gap-2">
                    <span className="flex items-center gap-2 text-xs font-bold uppercase tracking-[0.2em] text-amber-300" style={{ fontFamily: "Orbitron" }}>
                      <span className="h-2 w-2 rounded-full bg-amber-400 pulse-dot" /> Onay Bekleniyor
                    </span>
                    <span className="text-xs text-slate-400">{timeAgo(pending.createdAt)}</span>
                  </div>
                  <div className="mt-1.5 text-lg font-semibold text-slate-100">
                    <span className="mr-2 align-middle"><MarketBadge market={pending.market} /></span>
                    {pending.source === "manual" ? (
                      <>Emriniz: <span className="num">{pending.symbol}</span>{" "}
                      <span className={pending.side === "BUY" ? "text-emerald-300" : "text-rose-300"}>{pending.side === "BUY" ? "AL" : "SAT"}</span> {pending.volume} lot — gönderilsin mi?</>
                    ) : (
                      <><span className="num">{pending.symbol}</span> paritesinde{" "}
                      <span className={pending.side === "BUY" ? "text-emerald-300" : "text-rose-300"}>{pending.side}</span> fırsatı oluştu, işleme gireyim mi?</>
                    )}
                  </div>
                  <div className="mt-1 text-sm text-slate-400">{pending.reason} · {pending.volume} lot @ {fmtPrice(pending.price)} · Güven %{pending.confidence}</div>
                  <div className="mt-3 flex gap-2">
                    <Button variant="success" className="flex-1" onClick={() => decide(pending, true)}>✓ Evet, gir</Button>
                    <Button variant="danger" className="flex-1" onClick={() => decide(pending, false)}>✕ Hayır</Button>
                    <Button variant="ghost" onClick={listen} title="Sesli yanıt">🎙</Button>
                  </div>
                  <div className="mt-2 text-[11px] text-slate-500">Kesin kural: Açık bir “Evet” onayı olmadan işlem açılmaz.</div>
                </div>
              </div>
            </div>
          )}

          {/* Sohbet çubuğu */}
          <HudPanel className="z-10 mb-3 w-full max-w-xl" innerClassName="!py-2.5">
            <div className="mb-1.5 flex items-start gap-2 text-[13px]">
              <span className="mt-0.5 text-[10px] font-bold tracking-[0.3em] text-cyan-400" style={{ fontFamily: "Orbitron" }}>JARVIS</span>
              <p className="line-clamp-2 min-h-[2.4em] flex-1 text-slate-200">
                {interim ? <i className="text-emerald-200">{interim}…</i> : mode === "thinking" ? <span className="text-violet-300">düşünüyorum…</span> : lastAssistant?.content ?? "Orb'a tıklayın veya Space'e basıp konuşun. Örn: “durum”, “derle RSI”."}
              </p>
              <button onClick={() => setChatOpen(true)} className="text-[11px] font-bold text-cyan-400 hover:underline">geçmiş</button>
            </div>
            <form className="flex gap-2" onSubmit={(e) => { e.preventDefault(); send(input); }}>
              <button type="button" onClick={listen} className={cx("flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border", mode === "listening" ? "border-emerald-400 bg-emerald-400/20" : "border-cyan-400/40 hover:bg-cyan-400/10")}>🎙</button>
              <input className="input !py-1.5" placeholder="örn: EURUSD 0.1 lot al sl 30 tp 60 · SL girişe çek · NAS100 kapat" value={input} onChange={(e) => setInput(e.target.value)} />
              <Button type="submit" size="sm" disabled={!input.trim() || mode === "thinking"}>Gönder</Button>
            </form>
          </HudPanel>

          {/* MT5 + Kripto bağlantıları (yan yana) */}
          <div className="z-10 grid w-full max-w-xl gap-2 sm:grid-cols-2">
            <HudPanel innerClassName="!px-3 !py-2.5">
              <div className="flex items-center gap-2.5">
                <div className="relative flex h-12 w-12 shrink-0 items-center justify-center">
                  <svg className="ring-spin absolute inset-0" viewBox="0 0 56 56"><circle cx="28" cy="28" r="25" fill="none" stroke={connState === "live" ? "#34d399" : connState === "demo" ? "#fbbf24" : "#fb7185"} strokeWidth="2" strokeDasharray="30 10" /></svg>
                  <span className="text-[11px] font-black text-cyan-100" style={{ fontFamily: "Orbitron" }}>MT5</span>
                </div>
                <div className="min-w-0">
                  <div className="text-[11px] font-bold tracking-wide text-slate-300">MT5 BAĞLANTISI</div>
                  <div className={cx("text-xl font-black leading-none", connState === "live" ? "text-emerald-300" : connState === "demo" ? "text-amber-300" : "text-rose-300")} style={{ textShadow: "0 0 12px currentColor" }}>
                    {connState === "live" ? "AKTİF" : connState === "demo" ? "DEMO" : connState === "nomt5" ? "MT5 YOK" : "…"}
                  </div>
                </div>
                <div className="ml-auto flex h-7 items-end gap-[3px]">
                  {[1, 2, 3, 4].map((i) => (
                    <span key={i} className="w-[4px] rounded-sm" style={{ height: 5 + i * 5, background: connState === "live" && (state?.ping ?? 99) < 40 * i + 40 ? "#34d399" : "rgba(100,116,139,0.45)", boxShadow: connState === "live" ? "0 0 6px #34d399" : "none" }} />
                  ))}
                </div>
              </div>
              <div className="mt-2 grid grid-cols-[52px_1fr] gap-x-1 text-[11px] leading-[1.5]">
                <span className="text-slate-500">Sunucu</span><span className="truncate text-slate-100">{a?.server || "—"}</span>
                <span className="text-slate-500">Ping</span><span className="num text-slate-100">{state?.ping != null ? `${Math.round(state.ping)} ms` : "—"}</span>
                <span className="text-slate-500">Hesap</span><span className="num truncate text-slate-100">{a?.login || "—"} ({a?.currency ?? "USD"})</span>
                {ag?.online && <><span className="text-slate-500">Algo</span><span className={cx("font-bold", ag.algo ? "text-emerald-300" : "text-rose-300")}>{ag.algo ? "AÇIK" : "KAPALI"}</span></>}
              </div>
              {connState === "demo" && <Link href="/agent" className="mt-2 block rounded-lg border border-cyan-400/20 bg-cyan-400/5 px-2 py-1 text-center text-[10px] text-cyan-200 hover:border-cyan-400/50">Demo · ajanı başlatın →</Link>}
            </HudPanel>

            <HudPanel innerClassName="!px-3 !py-2.5">
              {(() => {
                const cr = state?.crypto;
                const st: "off" | "wait" | "on" = !cr?.enabled ? "off" : cr.connected ? "on" : "wait";
                const col = st === "on" ? "#fbbf24" : st === "wait" ? "#38bdf8" : "#64748b";
                const acc = cr?.account;
                return (
                  <>
                    <div className="flex items-center gap-2.5">
                      <div className="relative flex h-12 w-12 shrink-0 items-center justify-center">
                        <svg className={cx(st !== "off" && "ring-spin", "absolute inset-0")} viewBox="0 0 56 56"><circle cx="28" cy="28" r="25" fill="none" stroke={col} strokeWidth="2" strokeDasharray="30 10" /></svg>
                        <span className="text-[18px] font-black text-amber-200" style={{ fontFamily: "Orbitron" }}>₿</span>
                      </div>
                      <div className="min-w-0">
                        <div className="text-[11px] font-bold tracking-wide text-slate-300">KRİPTO BORSASI</div>
                        <div className={cx("truncate text-xl font-black leading-none", st === "on" ? "text-amber-300" : st === "wait" ? "text-sky-300" : "text-slate-500")} style={{ textShadow: st === "on" ? "0 0 12px currentColor" : "none" }}>
                          {st === "off" ? "KAPALI" : st === "wait" ? "BAĞLANIYOR" : `${(cr?.exchange ?? "binance").toUpperCase()} ${cr?.demo ? "DEMO" : "CANLI"}`}
                        </div>
                      </div>
                      <span className={cx("ml-auto h-2.5 w-2.5 shrink-0 rounded-full", st === "on" ? "bg-emerald-400 shadow-[0_0_8px_#34d399]" : st === "wait" ? "bg-sky-400 pulse-dot" : "bg-slate-600")} />
                    </div>
                    {st === "off" ? (
                      <Link href="/crypto" className="mt-2 block rounded-lg border border-amber-400/20 bg-amber-400/5 px-2 py-1 text-center text-[10px] text-amber-200 hover:border-amber-400/50">Binance vadeli demo bağla →</Link>
                    ) : (
                      <div className="mt-2 grid grid-cols-[52px_1fr] gap-x-1 text-[11px] leading-[1.5]">
                        <span className="text-slate-500">Piyasa</span><span className="truncate text-slate-100">Vadeli USDⓈ-M · {cr?.demo ? "Demo Trading" : "Gerçek hesap"}</span>
                        <span className="text-slate-500">Cüzdan</span><span className="num text-slate-100">{acc?.balance != null ? `${fmtNum(acc.balance)} ${acc.currency ?? "USDT"}` : "—"}</span>
                        <span className="text-slate-500">Varlık</span><span className="num text-slate-100">{acc?.equity != null ? fmtNum(acc.equity) : "—"}</span>
                        <span className="text-slate-500">Ayar</span><span className="num text-slate-100">{cr?.leverage}x · {cr?.orderUsdt} USDT/işlem</span>
                      </div>
                    )}
                    {st === "wait" && <div className="mt-1 text-[10px] text-sky-300/80">Ajan borsaya bağlanıyor — ajan v3.4 açık mı?</div>}
                  </>
                );
              })()}
            </HudPanel>
          </div>

          {/* Alt gezinme */}
          <div className="relative z-10 mt-3 grid w-full max-w-xl grid-cols-5 gap-2">
            {[
              { href: "/market", label: "PİYASA", icon: <IconMarket size={22} /> },
              { href: "/signals", label: "SİNYALLER", icon: <IconSignal size={22} /> },
              { href: "/trades", label: "İŞLEMLER", icon: <IconTrade size={22} /> },
              { href: "/rules", label: "ANALİZ", icon: <IconChart size={22} /> },
            ].map((n) => (
              <Link key={n.href} href={n.href} className={navBtn}>
                <div className="flex h-full flex-col items-center justify-center gap-0.5 text-cyan-300"><span className="drop-shadow-[0_0_6px_#22d3ee]">{n.icon}</span><span className="text-[10px] font-bold tracking-wider text-slate-100">{n.label}</span></div>
              </Link>
            ))}
            <div className="relative">
              <button onClick={() => setMenuOpen(!menuOpen)} className={navBtn}>
                <div className="flex h-full flex-col items-center justify-center gap-0.5 text-cyan-300"><span className="drop-shadow-[0_0_6px_#22d3ee]"><IconGear size={22} /></span><span className="text-[10px] font-bold tracking-wider text-slate-100">AYARLAR</span></div>
              </button>
              {menuOpen && (
                <>
                  <div className="fixed inset-0 z-20" onClick={() => setMenuOpen(false)} />
                  <div className="glass fade-up absolute bottom-[70px] right-0 z-30 w-56 rounded-xl p-1.5 text-sm">
                    {[
                      ["/rules", "◈ İzleme Kuralları"], ["/strategies", "⌘ MQL5 Stratejileri"], ["/providers", "✦ AI Sağlayıcıları"],
                      ["/agent", "⬡ Yerel Ajan (EXE)"], ["/phone", "📱 Telefon Bağlantısı (QR)"],
                    ].map(([h, l]) => (
                      <Link key={h} href={h} className="block rounded-lg px-3 py-2 text-slate-200 hover:bg-cyan-400/10 hover:text-cyan-100">{l}</Link>
                    ))}
                    <button onClick={logout} className="mt-1 block w-full rounded-lg border-t border-slate-700/50 px-3 py-2 text-left text-rose-300 hover:bg-rose-400/10">⏻ Oturumu kapat</button>
                  </div>
                </>
              )}
            </div>
          </div>
        </div>

        {/* ================= SAĞ ================= */}
        <div className="order-3 space-y-4">
          {/* Grafik */}
          <HudPanel>
            <div className="mb-1 flex flex-wrap items-center justify-between gap-2">
              <div className="flex items-center gap-2">
                {selQuote && <SymbolIcon symbol={selQuote.symbol} category={selQuote.category} size={30} />}
                <select className="cursor-pointer rounded-md border border-cyan-400/25 bg-transparent px-1 text-[20px] font-bold text-white outline-none" value={sel?.symbol ?? ""}
                  onChange={(e) => { const q = quotes.find((x) => x.symbol === e.target.value); if (q) setSel({ symbol: q.symbol, tf: q.tfs[0] }); }}>
                  {quotes.length === 0 && <option value="">—</option>}
                  {quotes.map((q) => <option key={q.symbol} value={q.symbol} className="bg-slate-900 text-base">{q.symbol}</option>)}
                </select>
                <div className="flex gap-1">
                  {(selQuote?.tfs ?? []).map((tf) => (
                    <button key={tf} onClick={() => setSel({ symbol: sel!.symbol, tf })}
                      className={cx("rounded px-1.5 py-0.5 text-[11px] font-bold", sel?.tf === tf ? "bg-cyan-400/25 text-cyan-100 shadow-[0_0_8px_rgba(34,211,238,0.5)]" : "text-slate-400 hover:text-cyan-200")}>{tf}</button>
                  ))}
                </div>
              </div>
              <div className="text-right">
                <FlashNum value={info?.price ?? selQuote?.price ?? null} className="num block text-[22px] font-bold leading-none text-white">{fmtPrice(info?.price ?? selQuote?.price)}</FlashNum>
                {info && info.live && (
                  <div className={cx("text-[10px] font-bold", info.tickAge !== null && info.tickAge < 5 ? "text-emerald-300" : "text-amber-300")}>
                    ● {info.tickAge === null ? "tick yok" : info.stale > 120 ? "piyasa kapalı?" : `canlı · ${info.tickAge.toFixed(0)} sn`}{info.dataAge !== null && info.dataAge > 30 ? ` · mumlar ${info.dataAge.toFixed(0)} sn` : ""}
                  </div>
                )}
                {info && <div className={cx("num text-[12px] font-semibold", info.change >= 0 ? "text-emerald-300" : "text-rose-300")}>{signed(info.change, info.price && info.price < 10 ? 5 : 2)} ({signed(info.changePct)}%)</div>}
              </div>
            </div>
            {sel ? <PriceChart symbol={sel.symbol} tf={sel.tf} market={quotes.find((q) => q.symbol === sel.symbol)?.market ?? "forex"} height={235} onInfo={setInfo} /> : <div className="flex h-[235px] items-center justify-center text-sm text-slate-400">İzleme kuralı ekleyerek grafiği görün.</div>}
            {info && (
              <div className="mt-1 flex flex-wrap items-center gap-3 border-t border-cyan-400/15 pt-1.5 text-[12px]">
                <span className="text-slate-400">RSI <b className={cx("num", info.rsi !== null && info.rsi <= 30 ? "text-emerald-300" : info.rsi !== null && info.rsi >= 70 ? "text-rose-300" : "text-violet-300")}>{info.rsi?.toFixed(1) ?? "—"}</b></span>
                <span className="text-slate-400">CCI <b className="num text-cyan-300">{info.cci?.toFixed(0) ?? "—"}</b></span>
                <Link href="/market" className="ml-auto text-[11px] font-bold text-cyan-400 hover:underline">RSI/CCI panelli büyük grafik →</Link>
              </div>
            )}
          </HudPanel>

          {/* Performans */}
          <HudPanel>
            <HudTitle icon={<IconPulse />}>Performans</HudTitle>
            {!state ? <Skeleton rows={2} /> : (
              <div className="grid grid-cols-4 gap-1">
                <Ring value={Math.abs(state.perf.week) / 5} text={`${signed(state.perf.week, 1)}%`} label="Bu Hafta" color={state.perf.week >= 0 ? "#22d3ee" : "#fb7185"} />
                <Ring value={Math.abs(state.perf.month) / 15} text={`${signed(state.perf.month, 1)}%`} label="Bu Ay" color={state.perf.month >= 0 ? "#22d3ee" : "#fb7185"} />
                <Ring value={Math.abs(state.perf.year) / 50} text={`${signed(state.perf.year, 1)}%`} label="Bu Yıl" color={state.perf.year >= 0 ? "#22d3ee" : "#fb7185"} />
                <Ring value={state.perf.winRate / 100} text={`%${Math.round(state.perf.winRate)}`} label="Başarı Oranı" color="#38bdf8" />
              </div>
            )}
          </HudPanel>

          {/* JARVIS AI durumu */}
          <HudPanel>
            <HudTitle icon={<IconBrain />}>JARVIS AI Durumu</HudTitle>
            <div className="flex items-center gap-3">
              <div className="flex-1 space-y-1.5 text-[13px]">
                {[
                  ["Piyasa Analizi", quotes.length > 0],
                  ["Sinyal Taraması", (state?.watching.length ?? 0) > 0],
                  ["Risk Yönetimi", true],
                  ["Onaylı İşlem (Sesli)", true],
                ].map(([l, on]) => (
                  <div key={l as string} className="flex items-center justify-between">
                    <span className="flex items-center gap-2 text-slate-200"><span className={cx("h-2.5 w-2.5 rounded-full", on ? "bg-emerald-400 shadow-[0_0_8px_#34d399]" : "bg-slate-600")} />{l}</span>
                    <span className={cx("font-bold", on ? "text-emerald-300" : "text-slate-500")}>{on ? "Aktif" : "Pasif"}</span>
                  </div>
                ))}
              </div>
              <div className="hidden w-[150px] shrink-0 flex-col items-center sm:flex">
                <IconBrain size={46} className="text-cyan-300 drop-shadow-[0_0_10px_#22d3ee]" />
                <div className="mt-1 w-full rounded-lg border border-cyan-400/30 bg-cyan-400/5 px-2 py-1.5 text-center text-[11px] leading-tight text-slate-200">
                  {state?.agentOnline ? "Tüm sistemler çalışıyor…" : "Demo modu · ajan çevrimdışı"}
                </div>
              </div>
            </div>
          </HudPanel>

          {/* Dünya piyasaları */}
          <HudPanel>
            <HudTitle icon={<IconGlobe />}>Dünya Piyasaları</HudTitle>
            <div className="relative flex items-center gap-3">
              <div className="dots-map pointer-events-none absolute inset-y-0 right-0 w-1/2" />
              <div className="relative z-10 space-y-1 text-[13px]">
                {cities.map((c) => {
                  const ct = cityTime(c.tz, c.o);
                  return (
                    <div key={c.n} className="flex items-center gap-2">
                      <span className={cx("h-2 w-2 rounded-full", ct.open ? "bg-emerald-400 shadow-[0_0_6px_#34d399]" : "bg-slate-600")} />
                      <span className="w-[68px] text-slate-200">{c.n}</span>
                      <span className="num text-cyan-200">{ct.t}</span>
                      <span className={cx("text-[10px] font-bold", ct.open ? "text-emerald-300" : "text-slate-500")}>{ct.open ? "AÇIK" : "KAPALI"}</span>
                    </div>
                  );
                })}
              </div>
              <div className="relative z-10 ml-auto max-w-[170px] text-right text-[12px] italic leading-snug text-slate-300">
                “Piyasalar duygularla değil, verilerle hareket eder.”
                <div className="mt-1 not-italic text-cyan-300">- JARVIS</div>
              </div>
            </div>
          </HudPanel>
        </div>
      </div>

      {/* ================= RSI · CCI RADAR ================= */}
      <HudPanel className="mt-4">
        <HudTitle icon={<IconRadar />} right={
          <span className="flex items-center gap-3 text-[11px] font-bold">
            <Badge tone={radarSignals ? "green" : "slate"}>{radarSignals} RSI+CCI uyumu</Badge>
            <Link href="/market" className="text-cyan-400 hover:underline">tüm radar →</Link>
          </span>
        }>RSI · CCI Radar — kesişen / uyumlu pariteler</HudTitle>
        {!market ? <Skeleton rows={3} /> : <RadarTable rows={market.radar} onlyActive limit={8} onSelect={(symbol, tf) => setSel({ symbol, tf })} selected={sel ? `${sel.symbol}|${sel.tf}` : undefined} />}
        <p className="mt-2 text-[11px] text-slate-500">
          Uyum: RSI ve CCI aynı yönde aşırı bölgede (veya son 3 mumda eşiği kesmiş). RSI değeri her satırda yazar; eşikler İzleme Kuralları&apos;ndan gelir. Sinyal tek başına işlem açmaz — onayınız gerekir.
        </p>
      </HudPanel>

      {/* ================= KANAL STRATEJİ · PİYASA GÖZLEMİ ================= */}
      <HudPanel className="mt-4">
        <HudTitle icon={<IconSignal />} right={
          <span className="flex items-center gap-3 text-[11px] font-bold">
            {kanal && <Badge tone={kanal.settings.enabled ? "green" : "slate"}>{kanal.settings.enabled ? "AÇIK" : "KAPALI"}</Badge>}
            {kanal && <Badge tone="cyan">{kanal.watch.length} parite · {kanal.settings.timeframes}</Badge>}
            {kanal && kanal.items.some((i) => i.fire) && <Badge tone="amber">{kanal.items.filter((i) => i.fire).length} yeni sinyal</Badge>}
            <Link href="/kanal" className="text-cyan-400 hover:underline">ayarlar / tüm tarama →</Link>
          </span>
        }>KANAL Strateji — Piyasa Gözlemi</HudTitle>
        {!kanal ? <Skeleton rows={3} /> : <KanalTable items={kanal.items} onlyActive limit={8} rsiOb={kanal.settings.params.rsiOb} rsiOs={kanal.settings.params.rsiOs} minConf={kanal.settings.auto?.minConf} autoOn={kanal.settings.auto?.enabled} onSelect={(symbol) => { const q = quotes.find((x) => x.symbol === symbol); if (q) setSel({ symbol, tf: q.tfs[0] }); }} />}
        <p className="mt-2 text-[11px] text-slate-500">
          Tüm bantların dışında kapanış yapıp içeri dönen, RSI 30/70 ve CCI mor çizgi kesişimi veren pariteler (takip listesi · 3dk/5dk/15dk/1sa). 5/5 olunca: {kanal?.settings.auto?.enabled ? `güven ≥ %${kanal.settings.auto.minConf} ise JARVIS otomatik girer, altındaysa sorar` : "JARVIS sesli onay ister, “Evet” demeden işlem açılmaz"}.
        </p>
      </HudPanel>

      {/* ================= ALT ÇUBUK ================= */}
      <footer className="mt-4">
        <div className="hud-line mb-2 opacity-70" />
        <div className="flex flex-wrap items-center justify-between gap-2 text-[11px] text-slate-400">
          <span><b className="text-cyan-200" style={{ fontFamily: "Orbitron" }}>JARVIS</b> &nbsp;v2.6.0 &nbsp;|&nbsp; Finansal Zeka • Otomatik Analiz • Gerçek Zamanlı Veri</span>
          <Link href="/phone" className="flex items-center gap-1 font-bold text-cyan-300 hover:underline"><IconPhone size={14} /> Telefondan aç (QR)</Link>
          <span className="tracking-wider text-cyan-200/80">İŞLEM YAPMAK DEĞİL, DOĞRU İŞLEM YAPMAK ÖNEMLİDİR.</span>
        </div>
      </footer>

      <OrderTicket open={orderOpen} onClose={() => setOrderOpen(false)} defaultSymbol={sel?.symbol} algoOff={!!ag?.online && !ag.algo} />

      {/* sohbet geçmişi */}
      <Modal open={chatOpen} onClose={() => setChatOpen(false)} title="İletişim Kanalı">
        <div className="scroll-thin max-h-[55vh] space-y-2 overflow-y-auto pr-1">
          {msgs.length === 0 && <div className="py-8 text-center text-sm text-slate-500">Henüz mesaj yok.</div>}
          {msgs.map((m) => (
            <div key={m.id} className={cx("flex", m.role === "user" ? "justify-end" : "justify-start")}>
              <div className={cx("max-w-[85%] whitespace-pre-wrap rounded-xl px-3 py-2 text-sm", m.role === "user" ? "border border-cyan-400/30 bg-cyan-400/10 text-cyan-50" : "border border-slate-500/20 bg-slate-900/50 text-slate-200")}>
                {m.role !== "user" && <div className="mb-0.5 text-[10px] font-bold tracking-[0.3em] text-cyan-400" style={{ fontFamily: "Orbitron" }}>JARVIS</div>}
                {m.content}
              </div>
            </div>
          ))}
          <div ref={histEnd} />
        </div>
        <div className="mt-3 flex justify-end">
          <Button size="sm" variant="ghost" onClick={async () => { setMsgs([]); await api("/api/chat", { method: "DELETE" }); }}>Geçmişi temizle</Button>
        </div>
      </Modal>
    </div>
  );
}

export function StatusBadge({ s }: { s: string }) {
  const m: Record<string, [string, "cyan" | "green" | "red" | "amber" | "slate" | "violet"]> = {
    pending: ["Bekliyor", "amber"], approved: ["Onaylı", "cyan"], executed: ["Açıldı", "green"],
    rejected: ["Red", "slate"], failed: ["Hata", "red"], expired: ["Süresi doldu", "slate"],
  };
  const [l, t] = m[s] ?? [s, "slate"];
  return <Badge tone={t}>{l}</Badge>;
}

export function JobBadge({ s }: { s: string }) {
  const m: Record<string, [string, "cyan" | "green" | "red" | "amber" | "slate" | "violet"]> = {
    queued: ["Kuyrukta", "amber"], running: ["Derleniyor", "violet"], success: ["Başarılı", "green"], failed: ["Hatalı", "red"],
  };
  const [l, t] = m[s] ?? [s, "slate"];
  return <Badge tone={t}>{l}</Badge>;
}

function Chip({ tone, label, value }: { tone: "g" | "a" | "r" | "n"; label: string; value: string }) {
  const c = { g: "border-emerald-400/40 text-emerald-300", a: "border-amber-400/40 text-amber-300", r: "border-rose-400/50 text-rose-300", n: "border-slate-500/40 text-slate-300" }[tone];
  const dot = { g: "bg-emerald-400 shadow-[0_0_6px_#34d399]", a: "bg-amber-400", r: "bg-rose-400 pulse-dot", n: "bg-slate-500" }[tone];
  return (
    <span className={cx("inline-flex items-center gap-1.5 rounded-lg border bg-black/25 px-2.5 py-1 font-semibold", c)}>
      <span className={cx("h-2 w-2 rounded-full", dot)} />
      <span className="text-slate-400">{label}</span> {value}
    </span>
  );
}

function Banner({ tone, title, children, action, onClose }: { tone: "r" | "a"; title: string; children?: React.ReactNode; action?: React.ReactNode; onClose?: () => void }) {
  return (
    <div className={cx("fade-up mt-2 flex items-start gap-3 rounded-xl border px-3 py-2 text-[12px]", tone === "r" ? "border-rose-400/50 bg-rose-500/10 text-rose-100" : "border-amber-400/40 bg-amber-400/10 text-amber-100")}>
      <span className="mt-0.5 text-base">{tone === "r" ? "⛔" : "⚠"}</span>
      <div className="min-w-0 flex-1"><div className="font-bold">{title}</div><div className="opacity-90">{children}</div></div>
      {action}
      {onClose && <button onClick={onClose} className="opacity-60 hover:opacity-100">✕</button>}
    </div>
  );
}
