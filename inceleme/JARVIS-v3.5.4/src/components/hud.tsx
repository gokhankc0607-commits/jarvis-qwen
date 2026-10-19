"use client";

import { useEffect, useRef, useState } from "react";
import { cx } from "./ui";

/* ---------- Panel (köşeleri pahlı, neon çerçeveli) ---------- */
export function HudPanel({ children, className, innerClassName }: { children: React.ReactNode; className?: string; innerClassName?: string }) {
  return (
    <div className={cx("hud-wrap", className)}>
      <div className="hud-panel h-full">
        <div className={cx("hud-panel-in", innerClassName)}>{children}</div>
      </div>
    </div>
  );
}

export function HudTitle({ icon, children, right }: { icon?: React.ReactNode; children: React.ReactNode; right?: React.ReactNode }) {
  return (
    <div className="mb-2 flex items-center justify-between gap-2">
      <div className="hud-title">
        {icon}
        {children}
      </div>
      {right}
    </div>
  );
}

/* ---------- Sparkline ---------- */
export function Spark({ data, up, w = 120, h = 30 }: { data: number[]; up: boolean; w?: number; h?: number }) {
  if (data.length < 2) return <div style={{ width: w, height: h }} />;
  const min = Math.min(...data);
  const max = Math.max(...data);
  const rng = max - min || 1;
  const pts = data.map((v, i) => [(i / (data.length - 1)) * w, h - 2 - ((v - min) / rng) * (h - 4)]);
  const line = pts.map((p, i) => `${i ? "L" : "M"}${p[0].toFixed(1)},${p[1].toFixed(1)}`).join(" ");
  const color = up ? "#34d399" : "#fb7185";
  const id = `sp${up ? "u" : "d"}${w}`;
  return (
    <svg width={w} height={h} viewBox={`0 0 ${w} ${h}`} className="shrink-0">
      <defs>
        <linearGradient id={id} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={color} stopOpacity="0.35" />
          <stop offset="100%" stopColor={color} stopOpacity="0" />
        </linearGradient>
      </defs>
      <path d={`${line} L${w},${h} L0,${h} Z`} fill={`url(#${id})`} />
      <path d={line} fill="none" stroke={color} strokeWidth="1.6" strokeLinejoin="round" style={{ filter: `drop-shadow(0 0 3px ${color})` }} />
    </svg>
  );
}

/* ---------- Halka (performans) ---------- */
export function Ring({ value, label, text, color = "#22d3ee", size = 74 }: { value: number; label: string; text: string; color?: string; size?: number }) {
  const r = (size - 10) / 2;
  const circ = 2 * Math.PI * r;
  const pct = Math.max(0, Math.min(1, value));
  return (
    <div className="flex flex-col items-center gap-1">
      <div className="relative" style={{ width: size, height: size }}>
        <svg width={size} height={size} className="-rotate-90">
          <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="rgba(56,189,248,0.15)" strokeWidth="5" />
          <circle
            cx={size / 2} cy={size / 2} r={r} fill="none" stroke={color} strokeWidth="5" strokeLinecap="round"
            strokeDasharray={`${circ * pct} ${circ}`} style={{ filter: `drop-shadow(0 0 5px ${color})`, transition: "stroke-dasharray .6s" }}
          />
        </svg>
        <div className="num absolute inset-0 flex items-center justify-center text-[13px] font-bold text-white">{text}</div>
      </div>
      <div className="text-[11px] font-semibold text-slate-300">{label}</div>
    </div>
  );
}

/* ---------- Sembol ikonu ---------- */
const ICON_BG: Record<string, string> = {
  forex: "linear-gradient(135deg,#2563eb,#38bdf8)",
  crypto: "linear-gradient(135deg,#f59e0b,#f97316)",
  metals: "linear-gradient(135deg,#eab308,#f59e0b)",
  indices: "linear-gradient(135deg,#0ea5e9,#6366f1)",
  commodities: "linear-gradient(135deg,#64748b,#334155)",
  stocks: "linear-gradient(135deg,#10b981,#0ea5e9)",
};
export function SymbolIcon({ symbol, category, size = 24 }: { symbol: string; category: string; size?: number }) {
  return (
    <span
      className="inline-flex shrink-0 items-center justify-center rounded-full text-[9px] font-black text-white shadow-[0_0_8px_rgba(56,189,248,0.5)]"
      style={{ width: size, height: size, background: ICON_BG[category] ?? ICON_BG.forex }}
    >
      {symbol.slice(0, 2)}
    </span>
  );
}

/* ---------- RSI göstergesi ---------- */
export function RsiGauge({ value, os, ob }: { value: number | null; os: number; ob: number }) {
  if (value === null) return <span className="text-slate-500">—</span>;
  const tone = value <= os ? "text-emerald-300" : value >= ob ? "text-rose-300" : "text-slate-200";
  return (
    <div className="flex items-center gap-2">
      <span className={cx("num w-10 text-right text-sm font-bold", tone)}>{value.toFixed(1)}</span>
      <div className="relative h-1.5 w-16 rounded-full bg-slate-800">
        <div className="absolute inset-y-0 left-0 rounded-l-full bg-emerald-400/30" style={{ width: `${os}%` }} />
        <div className="absolute inset-y-0 right-0 rounded-r-full bg-rose-400/30" style={{ width: `${100 - ob}%` }} />
        <div
          className="absolute top-1/2 h-2.5 w-1 -translate-y-1/2 rounded-sm bg-white shadow-[0_0_6px_#fff]"
          style={{ left: `calc(${Math.max(0, Math.min(100, value))}% - 2px)` }}
        />
      </div>
    </div>
  );
}

/* ---------- İkonlar (SVG) ---------- */
type P = { className?: string; size?: number };
const base = (size = 18) => ({ width: size, height: size, viewBox: "0 0 24 24", fill: "none", stroke: "currentColor", strokeWidth: 1.8, strokeLinecap: "round" as const, strokeLinejoin: "round" as const });
export const IconMarket = ({ size, className }: P) => (<svg {...base(size)} className={className}><path d="M3 3v18h18" /><path d="M7 15l4-4 3 3 5-6" /></svg>);
export const IconSignal = ({ size, className }: P) => (<svg {...base(size)} className={className}><path d="M13 2L4 14h7l-1 8 9-12h-7z" /></svg>);
export const IconTrade = ({ size, className }: P) => (<svg {...base(size)} className={className}><path d="M7 7h13l-3-3M17 17H4l3 3" /></svg>);
export const IconChart = ({ size, className }: P) => (<svg {...base(size)} className={className}><path d="M4 20V10M10 20V4M16 20v-8M22 20H2" /></svg>);
export const IconGear = ({ size, className }: P) => (<svg {...base(size)} className={className}><circle cx="12" cy="12" r="3" /><path d="M19.4 15a1.7 1.7 0 00.3 1.8l.1.1a2 2 0 11-2.8 2.8l-.1-.1a1.7 1.7 0 00-1.8-.3 1.7 1.7 0 00-1 1.5V21a2 2 0 11-4 0v-.1a1.7 1.7 0 00-1.1-1.5 1.7 1.7 0 00-1.8.3l-.1.1a2 2 0 11-2.8-2.8l.1-.1a1.7 1.7 0 00.3-1.8 1.7 1.7 0 00-1.5-1H3a2 2 0 110-4h.1a1.7 1.7 0 001.5-1.1 1.7 1.7 0 00-.3-1.8l-.1-.1a2 2 0 112.8-2.8l.1.1a1.7 1.7 0 001.8.3H9a1.7 1.7 0 001-1.5V3a2 2 0 114 0v.1a1.7 1.7 0 001 1.5 1.7 1.7 0 001.8-.3l.1-.1a2 2 0 112.8 2.8l-.1.1a1.7 1.7 0 00-.3 1.8V9a1.7 1.7 0 001.5 1H21a2 2 0 110 4h-.1a1.7 1.7 0 00-1.5 1z" /></svg>);
export const IconPulse = ({ size, className }: P) => (<svg {...base(size)} className={className}><path d="M2 12h4l3-8 4 16 3-8h6" /></svg>);
export const IconBrain = ({ size, className }: P) => (
  <svg {...base(size)} className={className}>
    <circle cx="6" cy="7" r="2" /><circle cx="18" cy="7" r="2" /><circle cx="12" cy="12" r="2.2" /><circle cx="6" cy="17" r="2" /><circle cx="18" cy="17" r="2" />
    <path d="M8 7.5l2.3 3M16 7.5l-2.3 3M8 16.5l2.3-3M16 16.5l-2.3-3M8 7h8M8 17h8" />
  </svg>
);
export const IconList = ({ size, className }: P) => (<svg {...base(size)} className={className}><path d="M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01" /></svg>);
export const IconRadar = ({ size, className }: P) => (<svg {...base(size)} className={className}><circle cx="12" cy="12" r="9" /><circle cx="12" cy="12" r="4.5" /><path d="M12 12l6-6" /></svg>);
export const IconPosition = ({ size, className }: P) => (<svg {...base(size)} className={className}><rect x="3" y="4" width="18" height="16" rx="2" /><path d="M3 9h18M8 4v16" /></svg>);
export const IconGlobe = ({ size, className }: P) => (<svg {...base(size)} className={className}><circle cx="12" cy="12" r="9" /><path d="M3 12h18M12 3c3 3 3 15 0 18M12 3c-3 3-3 15 0 18" /></svg>);
export const IconPhone = ({ size, className }: P) => (<svg {...base(size)} className={className}><rect x="7" y="2" width="10" height="20" rx="2" /><path d="M11 18h2" /></svg>);

/** Değer değişince yeşil/kırmızı yanıp söner (fiyatın canlı aktığı görülsün). */
export function FlashNum({ value, children, className }: { value: number | null | undefined; children: React.ReactNode; className?: string }) {
  const prev = useRef<number | null | undefined>(value);
  const [dir, setDir] = useState<0 | 1 | -1>(0);
  useEffect(() => {
    const p = prev.current;
    prev.current = value;
    if (p === null || p === undefined || value === null || value === undefined || value === p) return;
    setDir(value > p ? 1 : -1);
    const t = setTimeout(() => setDir(0), 700);
    return () => clearTimeout(t);
  }, [value]);
  return <span key={dir === 0 ? "n" : value} className={cx(className, dir === 1 && "flash-up", dir === -1 && "flash-down")}>{children}</span>;
}

/** İşlemin açıldığı zaman dilimi rozeti (MAN = elle emir, boş = MT5'te elle açılmış). */
export function TfBadge({ tf, comment, onClick }: { tf?: string | null; comment?: string | null; onClick?: () => void }) {
  const label = !tf ? (onClick ? "＋TF" : "—") : tf === "MAN" ? "Elle" : tf;
  const title =
    (!tf ? "Zaman dilimi bilinmiyor — MT5'te elle ya da başka bir EA ile açılmış olabilir." + (onClick ? " Tıklayıp elle atayabilirsiniz." : "")
      : tf === "MAN" ? "Elle verilen emir (sohbet / Hızlı Emir)" : `${tf} zaman diliminde açıldı`) + (comment ? `\nMT5 yorumu: ${comment}` : "");
  const Tag = onClick ? "button" : "span";
  return (
    <Tag title={title} onClick={onClick} className={cx("inline-flex min-w-[38px] justify-center rounded-md border px-1.5 py-0.5 text-[10px] font-black tracking-wider", onClick && "cursor-pointer hover:brightness-125",
      !tf ? "border-slate-600/40 text-slate-500" : tf === "MAN" ? "border-violet-400/40 bg-violet-400/10 text-violet-200" : "border-cyan-400/40 bg-cyan-400/10 text-cyan-200")}>
      {label}
    </Tag>
  );
}

/** Piyasa rozeti: forex (MT5) / kripto (borsa). */
export function MarketBadge({ market }: { market?: string | null }) {
  const c = market === "crypto";
  return <span title={c ? "Kripto borsası (vadeli)" : "Forex / MT5"} className={cx("inline-flex rounded-md border px-1.5 py-0.5 text-[10px] font-black", c ? "border-amber-400/40 bg-amber-400/10 text-amber-200" : "border-sky-400/30 bg-sky-400/10 text-sky-200")}>{c ? "🪙 KRİPTO" : "💱 FX"}</span>;
}
