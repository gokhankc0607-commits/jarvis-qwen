"use client";

import { useEffect, useRef, useState } from "react";
import Orb from "@/components/Orb";

export default function LoginPage() {
  const [mode, setMode] = useState<"login" | "register">("login");
  const [email, setEmail] = useState("demo@jarvis.local");
  const [password, setPassword] = useState("jarvis123");
  const [name, setName] = useState("");
  const [err, setErr] = useState("");
  const [loading, setLoading] = useState(false);
  const level = useRef(0);

  useEffect(() => {
    if (new URLSearchParams(window.location.search).get("pair") === "expired")
      setErr("QR kodunun süresi dolmuş veya daha önce kullanılmış. Bilgisayarda Telefon (QR) sayfasından yeni QR üretin ya da e-posta/şifre ile girin.");
  }, []);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErr("");
    setLoading(true);
    try {
      const r = await fetch(`/api/auth/${mode}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, password, name }),
      });
      const j = await r.json().catch(() => ({}));
      if (!r.ok)
        throw new Error(
          j.error ||
            (r.status >= 500
              ? "Sunucu hatası: veritabanına bağlanılamadı. Panel penceresindeki [db] satırlarını kontrol edin."
              : `Hata ${r.status}`)
        );
      window.location.href = "/dashboard";
    } catch (e) {
      setErr((e as Error).message);
      setLoading(false);
    }
  };

  return (
    <div className="relative flex min-h-screen items-center justify-center overflow-hidden p-4">
      <div className="pointer-events-none absolute inset-0 grid-bg" />
      <div className="relative grid w-full max-w-5xl items-center gap-8 md:grid-cols-2">
        <div className="hidden flex-col items-center md:flex">
          <Orb mode={loading ? "thinking" : "idle"} levelRef={level} size={380} />
          <p className="mt-2 max-w-sm text-center text-slate-400">
            MetaTrader 5 işlemlerinizi izleyen, MQL5 stratejilerinizi derleyen ve tamamen yerel yapay zekâ ile konuşan kişisel asistanınız.
          </p>
        </div>
        <form onSubmit={submit} className="glass hud-corner scanline relative mx-auto w-full max-w-md space-y-4 overflow-hidden rounded-2xl p-7">
          <div>
            <div className="neon-text text-3xl font-black tracking-[0.4em] text-cyan-100" style={{ fontFamily: "Orbitron" }}>JARVIS</div>
            <div className="text-xs tracking-[0.3em] text-cyan-400/70">{mode === "login" ? "KİMLİK DOĞRULAMA" : "YENİ OPERATÖR KAYDI"}</div>
          </div>
          {mode === "register" && (
            <input className="input" placeholder="Adınız" value={name} onChange={(e) => setName(e.target.value)} />
          )}
          <input className="input" type="email" placeholder="E-posta" value={email} onChange={(e) => setEmail(e.target.value)} required />
          <input className="input" type="password" placeholder="Şifre" value={password} onChange={(e) => setPassword(e.target.value)} required />
          {err && <div className="rounded-lg border border-rose-400/40 bg-rose-500/10 px-3 py-2 text-sm text-rose-200">{err}</div>}
          <button
            disabled={loading}
            className="w-full rounded-xl border border-cyan-400/50 bg-cyan-500/20 py-2.5 font-bold tracking-[0.2em] text-cyan-100 transition hover:bg-cyan-400/30 hover:shadow-[0_0_30px_-6px_rgba(34,211,238,0.8)] disabled:opacity-60"
            style={{ fontFamily: "Orbitron" }}
          >
            {loading ? "BAĞLANIYOR..." : mode === "login" ? "SİSTEME GİR" : "KAYIT OL"}
          </button>
          <div className="flex items-center justify-between text-sm">
            <button type="button" className="text-cyan-300 hover:underline" onClick={() => { setMode(mode === "login" ? "register" : "login"); setErr(""); if (mode === "login") { setEmail(""); setPassword(""); } }}>
              {mode === "login" ? "Hesap oluştur" : "Zaten hesabım var"}
            </button>
            {mode === "login" && <span className="text-xs text-slate-500">Demo: demo@jarvis.local / jarvis123</span>}
          </div>
        </form>
      </div>
    </div>
  );
}
