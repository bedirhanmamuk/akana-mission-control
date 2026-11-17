import { useEffect, useRef, useState } from "react";
import { prefersReducedMotion } from "../lib/motion";
import OrbitScene from "./OrbitScene";

const BASE = `${import.meta.env.BASE_URL}media/`;

/** Veri tasarrufu açıksa video indirilmez. */
function saveData(): boolean {
  const c = (navigator as Navigator & { connection?: { saveData?: boolean } }).connection;
  return Boolean(c?.saveData);
}

/**
 * Giriş ekranı arka planı: takımın atış videosu (sessiz, döngüde, koyu lacivert katman altında).
 * Dik ekranlarda roketin kadrajda kaldığı dikey kurgu kullanılır.
 * "Hareketi azalt" / veri tasarrufu açıkken ya da video oynatılamadığında yıldızlı sahneye düşer.
 */
export default function LaunchBackdrop({ boost }: { boost: boolean }) {
  const ref = useRef<HTMLVideoElement>(null);
  const [portrait, setPortrait] = useState(() => window.matchMedia("(max-aspect-ratio: 4/5)").matches);
  const [failed, setFailed] = useState(false);
  const [ready, setReady] = useState(false);
  const still = prefersReducedMotion() || saveData();

  useEffect(() => {
    const mq = window.matchMedia("(max-aspect-ratio: 4/5)");
    const on = () => setPortrait(mq.matches);
    mq.addEventListener("change", on);
    return () => mq.removeEventListener("change", on);
  }, []);

  // Sekme gizlenince durdur; görünür olunca devam et
  useEffect(() => {
    const v = ref.current;
    if (!v) return;
    const on = () => {
      if (document.visibilityState === "visible") v.play().catch(() => undefined);
      else v.pause();
    };
    document.addEventListener("visibilitychange", on);
    return () => document.removeEventListener("visibilitychange", on);
  }, [portrait, still, failed]);

  useEffect(() => {
    if (ref.current) ref.current.playbackRate = boost ? 3 : 1;
  }, [boost]);

  if (still || failed) return <OrbitScene />;

  const name = portrait ? "atis-mobil" : "atis";
  return (
    <>
      <video
        key={name}
        ref={ref}
        src={`${BASE}${name}.mp4`}
        poster={`${BASE}${name}.jpg`}
        muted
        loop
        autoPlay
        playsInline
        preload="auto"
        disablePictureInPicture
        tabIndex={-1}
        aria-hidden
        onCanPlay={() => setReady(true)}
        onError={() => setFailed(true)}
        data-testid="launch-video"
        className={`pointer-events-none absolute inset-0 size-full object-cover transition-[opacity,filter,transform] duration-1000 ease-out ${ready ? "opacity-100" : "opacity-0"} ${boost ? "scale-110 brightness-150 saturate-125" : ""}`}
      />
      {/* Okunabilirlik katmanı: ortası biraz açık, kenarları koyu */}
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(75%_60%_at_50%_42%,rgb(6_10_18/0.45),rgb(6_10_18/0.88))]" aria-hidden />
    </>
  );
}
