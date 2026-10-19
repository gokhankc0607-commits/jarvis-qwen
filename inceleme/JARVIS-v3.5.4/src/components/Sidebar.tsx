"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { cx } from "./ui";

const NAV = [
  { href: "/dashboard", label: "Komuta Merkezi", icon: "◉" },
  { href: "/market", label: "Piyasa & Grafik", icon: "◭" },
  { href: "/watchlist", label: "Takip Listesi", icon: "☰" },
  { href: "/crypto", label: "Kripto Borsası", icon: "🪙" },
  { href: "/kanal", label: "KANAL Strateji", icon: "◬" },
  { href: "/signals", label: "Sinyaller", icon: "⚡" },
  { href: "/trades", label: "İşlemler", icon: "⇅" },
  { href: "/strategies", label: "MQL5 Stratejileri", icon: "⌘" },
  { href: "/rules", label: "İzleme Kuralları", icon: "◈" },
  { href: "/providers", label: "AI Sağlayıcıları", icon: "✦" },
  { href: "/agent", label: "Yerel Ajan", icon: "⬡" },
  { href: "/phone", label: "Telefon (QR)", icon: "▯" },
  { href: "/telegram", label: "Telegram Bot", icon: "✈" },
  { href: "/design", label: "Tasarım Önizleme", icon: "◧" },
];

const KEY = "jarvis_sidebar"; // "open" | "closed"

/** Açılır-kapanır kenar menü: masaüstünde geniş ⇄ yalnız simgeler (tercih hatırlanır), mobilde çekmece. */
export default function Sidebar({ name, email }: { name: string; email: string }) {
  const path = usePathname();
  const [drawer, setDrawer] = useState(false);
  const [collapsed, setCollapsed] = useState(false);

  useEffect(() => {
    try {
      const v = localStorage.getItem(KEY);
      setCollapsed(v ? v === "closed" : window.innerWidth < 1600 && path === "/dashboard");
    } catch {}
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const toggle = () =>
    setCollapsed((c) => {
      try { localStorage.setItem(KEY, c ? "open" : "closed"); } catch {}
      return !c;
    });

  const logout = async () => {
    await fetch("/api/auth/logout", { method: "POST" });
    window.location.href = "/login";
  };

  const nav = (mini: boolean) => (
    <nav className="flex flex-col gap-1">
      {NAV.map((n) => {
        const active = path === n.href || path.startsWith(n.href + "/");
        return (
          <Link
            key={n.href}
            href={n.href}
            title={mini ? n.label : undefined}
            onClick={() => setDrawer(false)}
            className={cx(
              "group flex items-center rounded-xl border text-[15px] font-semibold tracking-wide transition",
              mini ? "justify-center px-0 py-2.5" : "gap-3 px-3 py-2.5",
              active
                ? "border-cyan-400/40 bg-cyan-400/10 text-cyan-100 shadow-[0_0_24px_-8px_rgba(34,211,238,0.8)]"
                : "border-transparent text-slate-400 hover:border-cyan-400/20 hover:bg-cyan-400/5 hover:text-cyan-200"
            )}
          >
            <span className={cx("w-5 text-center text-lg", active ? "text-cyan-300" : "text-slate-500 group-hover:text-cyan-300")}>{n.icon}</span>
            {!mini && n.label}
          </Link>
        );
      })}
    </nav>
  );
  const orb = (
    <div className="relative h-9 w-9 shrink-0 rounded-full border border-cyan-300/60 shadow-[0_0_20px_rgba(34,211,238,0.6)]">
      <div className="absolute inset-1.5 rounded-full bg-gradient-to-br from-white via-cyan-300 to-blue-600" />
    </div>
  );
  const brand = (mini: boolean) => (
    <Link href="/dashboard" className={cx("flex items-center", mini ? "justify-center" : "gap-3 px-2")} title="Komuta Merkezi">
      {orb}
      {!mini && (
        <div>
          <div className="neon-text text-lg font-black tracking-[0.35em] text-cyan-100" style={{ fontFamily: "Orbitron" }}>JARVIS</div>
          <div className="-mt-1 text-[10px] tracking-[0.3em] text-cyan-400/70">MT5 · MQL5 · LOCAL AI</div>
        </div>
      )}
    </Link>
  );
  const footer = (mini: boolean) =>
    mini ? (
      <button onClick={logout} title={`${name} · Oturumu kapat`} className="w-full rounded-xl border border-slate-600/40 py-2 text-slate-400 hover:border-rose-400/50 hover:text-rose-300">⏻</button>
    ) : (
      <div className="glass rounded-xl p-3">
        <div className="truncate text-sm font-bold text-slate-200">{name}</div>
        <div className="truncate text-xs text-slate-500">{email}</div>
        <button onClick={logout} className="mt-2 w-full rounded-lg border border-slate-600/40 py-1.5 text-xs font-semibold text-slate-300 hover:border-rose-400/50 hover:text-rose-300">
          Oturumu kapat
        </button>
      </div>
    );

  return (
    <>
      {/* mobil üst çubuk + çekmece */}
      <header className="glass sticky top-0 z-40 flex items-center justify-between rounded-none border-x-0 border-t-0 px-4 py-3 lg:hidden">
        {brand(false)}
        <button onClick={() => setDrawer(true)} className="rounded-lg border border-cyan-400/30 px-3 py-1.5 text-cyan-200" aria-label="Menüyü aç">☰</button>
      </header>
      {drawer && (
        <div className="fixed inset-0 z-50 bg-black/70 backdrop-blur-sm lg:hidden" onClick={() => setDrawer(false)}>
          <aside className="glass fade-up flex h-full w-72 flex-col gap-6 overflow-y-auto rounded-none p-4" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between">
              {brand(false)}
              <button onClick={() => setDrawer(false)} className="text-slate-400 hover:text-cyan-200" aria-label="Kapat">✕</button>
            </div>
            {nav(false)}
            <div className="mt-auto">{footer(false)}</div>
          </aside>
        </div>
      )}

      {/* masaüstü: açılır / kapanır */}
      <aside
        className={cx(
          "glass sticky top-0 z-30 hidden h-screen shrink-0 flex-col gap-6 overflow-y-auto overflow-x-hidden rounded-none border-y-0 border-l-0 py-4 transition-[width] duration-200 lg:flex",
          collapsed ? "w-[68px] px-2" : "w-64 px-4"
        )}
      >
        <div className={cx("flex items-center pt-1", collapsed ? "flex-col gap-3" : "justify-between")}>
          {brand(collapsed)}
          <button
            onClick={toggle}
            title={collapsed ? "Menüyü genişlet" : "Menüyü daralt"}
            aria-label={collapsed ? "Menüyü genişlet" : "Menüyü daralt"}
            className="flex h-7 w-7 items-center justify-center rounded-lg border border-cyan-400/30 text-sm text-cyan-200 hover:bg-cyan-400/10"
          >
            {collapsed ? "»" : "«"}
          </button>
        </div>
        {nav(collapsed)}
        <div className="mt-auto">{footer(collapsed)}</div>
      </aside>
    </>
  );
}
