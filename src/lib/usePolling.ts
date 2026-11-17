import { useEffect } from "react";

/**
 * Görünür sekmede verileri belirli aralıkla ve pencereye dönüldüğünde yeniler.
 * Gerçek zamanlı kanal yerine kullanılır: Supabase Realtime her kurulumda açık
 * olmayabilir; yenileme sessizdir (mevcut veri ekranda kalır).
 */
export function usePolling(refresh: () => void, intervalMs = 60_000) {
  useEffect(() => {
    const timer = window.setInterval(() => {
      if (document.visibilityState === "visible") refresh();
    }, intervalMs);
    const onFocus = () => refresh();
    window.addEventListener("focus", onFocus);
    return () => {
      window.clearInterval(timer);
      window.removeEventListener("focus", onFocus);
    };
  }, [refresh, intervalMs]);
}
