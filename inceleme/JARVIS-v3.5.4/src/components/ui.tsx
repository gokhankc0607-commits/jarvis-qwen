"use client";

import { createContext, useCallback, useContext, useEffect, useState } from "react";

export function cx(...c: (string | false | null | undefined)[]) {
  return c.filter(Boolean).join(" ");
}

export function Card({ title, icon, right, children, className }: {
  title?: string; icon?: React.ReactNode; right?: React.ReactNode; children: React.ReactNode; className?: string;
}) {
  return (
    <section className={cx("glass hud-corner rounded-2xl p-4", className)}>
      {title && (
        <header className="mb-3 flex items-center justify-between gap-2">
          <h3 className="flex items-center gap-2 text-[11px] font-bold uppercase tracking-[0.25em] text-cyan-300/90" style={{ fontFamily: "Orbitron" }}>
            {icon}
            {title}
          </h3>
          {right}
        </header>
      )}
      {children}
    </section>
  );
}

export function Button({ variant = "primary", size = "md", loading, className, children, ...p }: React.ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: "primary" | "ghost" | "danger" | "success"; size?: "sm" | "md"; loading?: boolean;
}) {
  const v = {
    primary: "bg-cyan-500/15 text-cyan-200 border-cyan-400/40 hover:bg-cyan-400/25 hover:shadow-[0_0_20px_-4px_rgba(34,211,238,0.6)]",
    ghost: "bg-transparent text-slate-300 border-slate-600/40 hover:border-cyan-400/40 hover:text-cyan-200",
    danger: "bg-rose-500/10 text-rose-300 border-rose-400/40 hover:bg-rose-500/20",
    success: "bg-emerald-500/15 text-emerald-200 border-emerald-400/40 hover:bg-emerald-500/25 hover:shadow-[0_0_20px_-4px_rgba(16,185,129,0.6)]",
  }[variant];
  const s = size === "sm" ? "px-2.5 py-1 text-xs" : "px-4 py-2 text-sm";
  return (
    <button
      {...p}
      disabled={p.disabled || loading}
      className={cx("inline-flex items-center justify-center gap-2 rounded-lg border font-semibold tracking-wide transition disabled:cursor-not-allowed disabled:opacity-50", v, s, className)}
    >
      {loading && <Spinner />}
      {children}
    </button>
  );
}

export function Spinner({ className }: { className?: string }) {
  return <span className={cx("inline-block h-3.5 w-3.5 animate-spin rounded-full border-2 border-cyan-300/30 border-t-cyan-300", className)} />;
}

export function Badge({ tone = "cyan", children }: { tone?: "cyan" | "green" | "red" | "amber" | "slate" | "violet"; children: React.ReactNode }) {
  const t = {
    cyan: "bg-cyan-400/10 text-cyan-300 border-cyan-400/30",
    green: "bg-emerald-400/10 text-emerald-300 border-emerald-400/30",
    red: "bg-rose-400/10 text-rose-300 border-rose-400/30",
    amber: "bg-amber-400/10 text-amber-300 border-amber-400/30",
    slate: "bg-slate-400/10 text-slate-300 border-slate-400/30",
    violet: "bg-violet-400/10 text-violet-300 border-violet-400/30",
  }[tone];
  return <span className={cx("inline-flex items-center gap-1 whitespace-nowrap rounded-md border px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wider", t)}>{children}</span>;
}

export function Empty({ icon = "◎", title, hint, action }: { icon?: string; title: string; hint?: string; action?: React.ReactNode }) {
  return (
    <div className="flex flex-col items-center justify-center gap-2 rounded-xl border border-dashed border-cyan-400/20 py-10 text-center">
      <div className="text-3xl text-cyan-400/60">{icon}</div>
      <div className="font-semibold text-slate-200">{title}</div>
      {hint && <div className="max-w-sm text-sm text-slate-400">{hint}</div>}
      {action && <div className="mt-2">{action}</div>}
    </div>
  );
}

export function Skeleton({ rows = 3 }: { rows?: number }) {
  return (
    <div className="space-y-2">
      {Array.from({ length: rows }).map((_, i) => (
        <div key={i} className="skeleton h-10" />
      ))}
    </div>
  );
}

export function Field({ label, children, hint }: { label: string; children: React.ReactNode; hint?: string }) {
  return (
    <label className="block space-y-1">
      <span className="text-[11px] font-semibold uppercase tracking-wider text-slate-400">{label}</span>
      {children}
      {hint && <span className="block text-[11px] text-slate-500">{hint}</span>}
    </label>
  );
}

export function Modal({ open, onClose, title, children, wide }: { open: boolean; onClose: () => void; title: string; children: React.ReactNode; wide?: boolean }) {
  useEffect(() => {
    const h = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
  }, [onClose]);
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4 backdrop-blur-sm" onClick={onClose}>
      <div className={cx("glass hud-corner fade-up max-h-[90vh] w-full overflow-auto rounded-2xl p-5 scroll-thin", wide ? "max-w-3xl" : "max-w-lg")} onClick={(e) => e.stopPropagation()}>
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-sm font-bold uppercase tracking-[0.2em] text-cyan-200" style={{ fontFamily: "Orbitron" }}>{title}</h2>
          <button onClick={onClose} className="text-slate-400 hover:text-cyan-200">✕</button>
        </div>
        {children}
      </div>
    </div>
  );
}

export function PageHeader({ title, sub, right }: { title: string; sub?: string; right?: React.ReactNode }) {
  return (
    <div className="mb-6 flex flex-wrap items-end justify-between gap-3">
      <div>
        <h1 className="neon-text text-xl font-black tracking-[0.2em] text-cyan-200 md:text-2xl" style={{ fontFamily: "Orbitron" }}>{title}</h1>
        {sub && <p className="mt-1 text-sm text-slate-400">{sub}</p>}
      </div>
      {right}
    </div>
  );
}

/* ---------- Toasts ---------- */
type Toast = { id: number; text: string; tone: "ok" | "err" | "info" };
const ToastCtx = createContext<(text: string, tone?: Toast["tone"]) => void>(() => {});
export const useToast = () => useContext(ToastCtx);

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [list, setList] = useState<Toast[]>([]);
  const push = useCallback((text: string, tone: Toast["tone"] = "ok") => {
    const id = Date.now() + Math.random();
    setList((l) => [...l, { id, text, tone }]);
    setTimeout(() => setList((l) => l.filter((t) => t.id !== id)), 3800);
  }, []);
  return (
    <ToastCtx.Provider value={push}>
      {children}
      <div className="fixed bottom-4 right-4 z-[60] flex flex-col gap-2">
        {list.map((t) => (
          <div
            key={t.id}
            className={cx(
              "glass fade-up rounded-xl px-4 py-2.5 text-sm font-medium",
              t.tone === "err" ? "border-rose-400/40 text-rose-200" : t.tone === "info" ? "text-cyan-200" : "border-emerald-400/40 text-emerald-200"
            )}
          >
            {t.text}
          </div>
        ))}
      </div>
    </ToastCtx.Provider>
  );
}

/* ---------- API helper ---------- */
export async function api<T = unknown>(url: string, opts?: { method?: string; body?: unknown }): Promise<T> {
  const r = await fetch(url, {
    method: opts?.method ?? (opts?.body ? "POST" : "GET"),
    headers: opts?.body ? { "Content-Type": "application/json" } : undefined,
    body: opts?.body ? JSON.stringify(opts.body) : undefined,
    cache: "no-store",
  });
  const j = await r.json().catch(() => ({}));
  if (r.status === 401) {
    window.location.href = "/login";
    throw new Error("Oturum sona erdi");
  }
  if (!r.ok) throw new Error(j.error || `Hata ${r.status}`);
  return j as T;
}

export function useList<T>(url: string) {
  const [data, setData] = useState<T[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const reload = useCallback(() => {
    api<T[]>(url).then(setData).catch((e) => setError(e.message));
  }, [url]);
  useEffect(() => {
    reload();
  }, [reload]);
  return { data, setData, error, reload };
}

export const fmtNum = (n: number | null | undefined, d = 2) =>
  n === null || n === undefined ? "—" : n.toLocaleString("tr-TR", { minimumFractionDigits: d, maximumFractionDigits: d });

export const fmtPrice = (n: number | null | undefined) => {
  if (n === null || n === undefined) return "—";
  const d = n > 1000 ? 2 : n > 50 ? 3 : 5;
  return n.toFixed(d);
};

export const timeAgo = (d: string | Date) => {
  const s = Math.floor((Date.now() - new Date(d).getTime()) / 1000);
  if (s < 60) return `${Math.max(s, 0)} sn önce`;
  if (s < 3600) return `${Math.floor(s / 60)} dk önce`;
  if (s < 86400) return `${Math.floor(s / 3600)} sa önce`;
  return `${Math.floor(s / 86400)} gün önce`;
};
