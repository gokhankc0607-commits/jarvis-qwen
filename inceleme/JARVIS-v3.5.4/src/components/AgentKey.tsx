"use client";

import { useState } from "react";

export default function AgentKey({ initial }: { initial: string }) {
  const [key, setKey] = useState(initial);
  const [show, setShow] = useState(false);
  const [msg, setMsg] = useState("");
  const regen = async () => {
    if (!confirm("Yeni anahtar oluşturulsun mu? Eski anahtarla çalışan ajan bağlantısı kesilir.")) return;
    const r = await fetch("/api/agent/key", { method: "POST" });
    const j = await r.json();
    if (j.agentKey) { setKey(j.agentKey); setShow(true); setMsg("Yeni anahtar oluşturuldu"); }
  };
  return (
    <div>
      <div className="text-[11px] uppercase tracking-wider text-slate-500">Ajan Anahtarı</div>
      <code className="block break-all text-cyan-200">{show ? key : key.slice(0, 8) + "•".repeat(24)}</code>
      <div className="mt-2 flex gap-2 text-xs">
        <button className="rounded-md border border-cyan-400/30 px-2 py-1 text-cyan-200" onClick={() => setShow(!show)}>{show ? "Gizle" : "Göster"}</button>
        <button className="rounded-md border border-cyan-400/30 px-2 py-1 text-cyan-200" onClick={() => { navigator.clipboard.writeText(key); setMsg("Kopyalandı"); }}>Kopyala</button>
        <button className="rounded-md border border-rose-400/30 px-2 py-1 text-rose-300" onClick={regen}>Yenile</button>
        {msg && <span className="self-center text-emerald-300">{msg}</span>}
      </div>
    </div>
  );
}
