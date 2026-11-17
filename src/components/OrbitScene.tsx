import { useEffect, useRef } from "react";
import { prefersReducedMotion } from "../lib/motion";

/**
 * Giriş ekranı sahnesi: yıldız alanı ve yörüngede dönen iki küçük cisim.
 * Sekme gizlendiğinde durur; "hareketi azalt" ayarında tek bir sabit kare çizer.
 */
export default function OrbitScene() {
  const ref = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = ref.current;
    const ctx = canvas?.getContext("2d");
    if (!canvas || !ctx) return;
    const reduced = prefersReducedMotion();
    let w = 0, h = 0, raf = 0, running = true;
    let seed = 7;
    const rand = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
    const stars = Array.from({ length: 140 }, () => ({ x: rand(), y: rand(), r: 0.3 + rand() * 1.1, a: 0.15 + rand() * 0.55, tw: rand() * Math.PI * 2 }));
    const orbits = [
      { rx: 0.46, ry: 0.17, tilt: -0.32, speed: 0.00011, phase: 0.6, size: 3.2 },
      { rx: 0.68, ry: 0.27, tilt: -0.32, speed: -0.00006, phase: 2.4, size: 2.2 },
      { rx: 0.92, ry: 0.38, tilt: -0.32, speed: 0.00003, phase: 4.1, size: 0 },
    ];

    function resize() {
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      w = canvas!.clientWidth; h = canvas!.clientHeight;
      canvas!.width = Math.round(w * dpr); canvas!.height = Math.round(h * dpr);
      ctx!.setTransform(dpr, 0, 0, dpr, 0, 0);
    }

    function draw(time: number) {
      ctx!.clearRect(0, 0, w, h);
      for (const s of stars) {
        ctx!.globalAlpha = s.a * (reduced ? 1 : 0.75 + 0.25 * Math.sin(time * 0.0008 + s.tw));
        ctx!.fillStyle = "#d7dce8";
        ctx!.beginPath(); ctx!.arc(s.x * w, s.y * h, s.r, 0, Math.PI * 2); ctx!.fill();
      }
      const cx = w * 0.5, cy = h * 0.56, base = Math.max(w, h * 1.2);
      for (const o of orbits) {
        const rx = o.rx * base * 0.6, ry = o.ry * base * 0.6;
        ctx!.globalAlpha = 1;
        ctx!.strokeStyle = "rgba(217, 164, 65, 0.18)";
        ctx!.lineWidth = 1;
        ctx!.beginPath(); ctx!.ellipse(cx, cy, rx, ry, o.tilt, 0, Math.PI * 2); ctx!.stroke();
        if (!o.size) continue;
        const ang = o.phase + time * o.speed;
        // İz: cismin arkasında sönümlenen yay
        for (let k = 0; k < 28; k++) {
          const a = ang - Math.sign(o.speed) * k * 0.012;
          const x = cx + rx * Math.cos(a) * Math.cos(o.tilt) - ry * Math.sin(a) * Math.sin(o.tilt);
          const y = cy + rx * Math.cos(a) * Math.sin(o.tilt) + ry * Math.sin(a) * Math.cos(o.tilt);
          ctx!.globalAlpha = (1 - k / 28) * (k === 0 ? 1 : 0.35);
          ctx!.fillStyle = k === 0 ? "#ffffff" : "#e8bd66";
          ctx!.beginPath(); ctx!.arc(x, y, k === 0 ? o.size : o.size * (1 - k / 34), 0, Math.PI * 2); ctx!.fill();
        }
      }
      ctx!.globalAlpha = 1;
    }

    function loop(time: number) {
      if (!running) return;
      draw(time);
      raf = requestAnimationFrame(loop);
    }
    function onVisibility() {
      running = document.visibilityState === "visible" && !reduced;
      cancelAnimationFrame(raf);
      if (running) raf = requestAnimationFrame(loop);
    }
    function onResize() { resize(); if (reduced) draw(0); }

    resize();
    if (reduced) draw(0); else raf = requestAnimationFrame(loop);
    window.addEventListener("resize", onResize);
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      running = false;
      cancelAnimationFrame(raf);
      window.removeEventListener("resize", onResize);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, []);

  return <canvas ref={ref} className="pointer-events-none absolute inset-0 size-full" aria-hidden />;
}
