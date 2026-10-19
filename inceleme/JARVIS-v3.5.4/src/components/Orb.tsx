"use client";

import { useEffect, useRef } from "react";

export type OrbMode = "idle" | "listening" | "thinking" | "speaking";

const PALETTE: Record<OrbMode, { a: [number, number, number]; b: [number, number, number]; label: string }> = {
  idle: { a: [34, 211, 238], b: [59, 130, 246], label: "BEKLEMEDE" },
  listening: { a: [52, 211, 153], b: [34, 211, 238], label: "DİNLİYOR" },
  thinking: { a: [167, 139, 250], b: [56, 189, 248], label: "DÜŞÜNÜYOR" },
  speaking: { a: [125, 211, 252], b: [255, 255, 255], label: "KONUŞUYOR" },
};

export default function Orb({ mode, levelRef, size = 420, variant = "default" }: { mode: OrbMode; levelRef: React.MutableRefObject<number>; size?: number; variant?: "default" | "hud" }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const modeRef = useRef(mode);
  modeRef.current = mode;

  useEffect(() => {
    const cv = canvasRef.current!;
    const ctx = cv.getContext("2d")!;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    cv.width = size * dpr;
    cv.height = size * dpr;
    ctx.scale(dpr, dpr);
    const C = size / 2;
    const hud = variant === "hud";
    const R = size * (hud ? 0.235 : 0.2);

    const particles = Array.from({ length: 140 }, () => ({
      ang: Math.random() * Math.PI * 2,
      rad: R * (1.3 + Math.random() * 1.0),
      spd: (Math.random() * 0.6 + 0.2) * (Math.random() > 0.5 ? 1 : -1),
      sz: Math.random() * 1.6 + 0.3,
      tilt: Math.random() * 0.6 + 0.3,
    }));

    let col = [...PALETTE.idle.a];
    let col2 = [...PALETTE.idle.b];
    let smooth = 0;
    let raf = 0;
    let t0 = performance.now();

    const rgba = (c: number[], a: number) => `rgba(${c[0] | 0},${c[1] | 0},${c[2] | 0},${a})`;

    const draw = (now: number) => {
      const dt = Math.min((now - t0) / 1000, 0.05);
      t0 = now;
      const t = now / 1000;
      const m = modeRef.current;
      const pal = PALETTE[m];
      col = col.map((v, i) => v + (pal.a[i] - v) * 0.06);
      col2 = col2.map((v, i) => v + (pal.b[i] - v) * 0.06);

      let target = levelRef.current;
      if (m === "idle") target = 0.06 + Math.sin(t * 1.2) * 0.03;
      if (m === "thinking") target = 0.18 + Math.sin(t * 6) * 0.08;
      smooth += (target - smooth) * 0.2;
      const lv = Math.max(0, Math.min(1, smooth));
      const speed = m === "thinking" ? 3 : m === "speaking" ? 1.8 : m === "listening" ? 1.4 : 1;

      ctx.clearRect(0, 0, size, size);

      // aura
      const aura = ctx.createRadialGradient(C, C, R * 0.4, C, C, R * 2.6);
      aura.addColorStop(0, rgba(col, 0.35 + lv * 0.3));
      aura.addColorStop(0.45, rgba(col2, 0.08 + lv * 0.1));
      aura.addColorStop(1, "rgba(0,0,0,0)");
      ctx.fillStyle = aura;
      ctx.fillRect(0, 0, size, size);

      // particles
      for (const p of particles) {
        p.ang += p.spd * dt * 0.5 * speed;
        const r = p.rad * (1 + lv * 0.25);
        const x = C + Math.cos(p.ang) * r;
        const y = C + Math.sin(p.ang) * r * p.tilt;
        ctx.fillStyle = rgba(col, 0.25 + 0.5 * Math.abs(Math.sin(p.ang * 3 + t)));
        ctx.beginPath();
        ctx.arc(x, y, p.sz, 0, Math.PI * 2);
        ctx.fill();
      }

      // rotating HUD rings
      const rings = [
        { r: R * 1.95, w: 1, dash: [2, 8], rot: t * 0.15 * speed, a: 0.35 },
        { r: R * 1.75, w: 2, dash: [40, 14, 6, 14], rot: -t * 0.3 * speed, a: 0.55 },
        { r: R * 1.55, w: 1, dash: [], rot: 0, a: 0.25 },
        { r: R * 1.42, w: 3, dash: [90, 30], rot: t * 0.55 * speed, a: 0.7 },
        { r: R * 2.15, w: 1.5, dash: [120, 260], rot: -t * 0.22 * speed, a: 0.5 },
      ];
      for (const rg of rings) {
        ctx.save();
        ctx.translate(C, C);
        ctx.rotate(rg.rot);
        ctx.setLineDash(rg.dash);
        ctx.lineWidth = rg.w;
        ctx.strokeStyle = rgba(col, rg.a);
        ctx.shadowColor = rgba(col, 0.9);
        ctx.shadowBlur = 8;
        ctx.beginPath();
        ctx.arc(0, 0, rg.r * (1 + lv * 0.06), 0, Math.PI * 2);
        ctx.stroke();
        ctx.restore();
      }
      ctx.setLineDash([]);

      // tick marks
      ctx.save();
      ctx.translate(C, C);
      ctx.rotate(-t * 0.08);
      for (let i = 0; i < 72; i++) {
        const a = (i / 72) * Math.PI * 2;
        const long = i % 6 === 0;
        const r1 = R * 2.3;
        const r2 = r1 + (long ? 10 : 4);
        ctx.strokeStyle = rgba(col, long ? 0.6 : 0.25);
        ctx.lineWidth = long ? 1.5 : 1;
        ctx.beginPath();
        ctx.moveTo(Math.cos(a) * r1, Math.sin(a) * r1);
        ctx.lineTo(Math.cos(a) * r2, Math.sin(a) * r2);
        ctx.stroke();
      }
      ctx.restore();

      // audio waveform ring
      ctx.save();
      ctx.translate(C, C);
      ctx.beginPath();
      const N = 128;
      for (let i = 0; i <= N; i++) {
        const a = (i / N) * Math.PI * 2;
        const wob =
          Math.sin(a * 6 + t * 4 * speed) * 0.5 + Math.sin(a * 11 - t * 7) * 0.3 + Math.sin(a * 17 + t * 9) * 0.2;
        const r = R * 1.18 + wob * (2 + lv * R * 0.45);
        const x = Math.cos(a) * r;
        const y = Math.sin(a) * r;
        if (i === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      }
      ctx.strokeStyle = rgba(col2, 0.55 + lv * 0.4);
      ctx.lineWidth = 1.6;
      ctx.shadowColor = rgba(col, 1);
      ctx.shadowBlur = 16;
      ctx.stroke();
      ctx.restore();

      // core sphere
      const pulse = 1 + lv * 0.18 + Math.sin(t * 2) * 0.01;
      const cr = R * pulse;
      const core = ctx.createRadialGradient(C - cr * 0.3, C - cr * 0.35, cr * 0.05, C, C, cr);
      if (hud) {
        core.addColorStop(0, "rgba(10,40,110,0.55)");
        core.addColorStop(0.35, rgba(col2, 0.35));
        core.addColorStop(0.75, rgba(col, 0.5));
        core.addColorStop(1, rgba(col, 0.12));
      } else {
        core.addColorStop(0, "rgba(255,255,255,0.95)");
        core.addColorStop(0.25, rgba(col2, 0.85));
        core.addColorStop(0.65, rgba(col, 0.55));
        core.addColorStop(1, rgba(col, 0.05));
      }
      ctx.save();
      ctx.shadowColor = rgba(col, 1);
      ctx.shadowBlur = 40 + lv * 60;
      ctx.fillStyle = core;
      ctx.beginPath();
      ctx.arc(C, C, cr, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();

      // inner lattice
      ctx.save();
      ctx.translate(C, C);
      ctx.strokeStyle = rgba([255, 255, 255], 0.18);
      ctx.lineWidth = 0.8;
      for (let i = 0; i < 4; i++) {
        ctx.beginPath();
        ctx.ellipse(0, 0, cr * 0.92, cr * (0.25 + i * 0.22) * Math.abs(Math.cos(t * 0.5 * speed + i)), 0, 0, Math.PI * 2);
        ctx.stroke();
        ctx.beginPath();
        ctx.ellipse(0, 0, cr * (0.25 + i * 0.22) * Math.abs(Math.sin(t * 0.4 * speed + i)), cr * 0.92, 0, 0, Math.PI * 2);
        ctx.stroke();
      }
      ctx.restore();

      raf = requestAnimationFrame(draw);
    };
    raf = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(raf);
  }, [size, levelRef, variant]);

  return (
    <div className="relative flex flex-col items-center">
      <canvas ref={canvasRef} style={{ width: size, height: size, maxWidth: "100%" }} />
      <div className="absolute bottom-[6%] text-[11px] font-bold tracking-[0.5em] text-cyan-200/80" style={{ fontFamily: "Orbitron" }}>
        {PALETTE[mode].label}
      </div>
    </div>
  );
}
