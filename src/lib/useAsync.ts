import { useCallback, useEffect, useRef, useState } from "react";
import { errorMessage } from "./errors";

export interface AsyncState<T> {
  data: T | null;
  loading: boolean;
  error: string | null;
  /** Yeniden yükler (yükleniyor durumu gösterilir) */
  reload: () => void;
  /** Sessiz yenileme: mevcut veri ekranda kalır, hata olursa eski veri korunur */
  refresh: () => void;
}

/** Basit veri çekme kancası: yükleniyor / hata / veri durumlarını yönetir. */
export function useAsync<T>(fn: () => Promise<T>, deps: unknown[]): AsyncState<T> {
  const [data, setData] = useState<T | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [tick, setTick] = useState(0);
  const silentRef = useRef(false);
  const fnRef = useRef(fn);
  fnRef.current = fn;

  useEffect(() => {
    let cancelled = false;
    const silent = silentRef.current;
    silentRef.current = false;
    if (!silent) {
      setLoading(true);
      setError(null);
    }
    fnRef.current()
      .then((d) => { if (!cancelled) { setData(d); setError(null); } })
      .catch((e) => { if (!cancelled && !silent) setError(errorMessage(e)); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [...deps, tick]);

  const reload = useCallback(() => setTick((t) => t + 1), []);
  const refresh = useCallback(() => { silentRef.current = true; setTick((t) => t + 1); }, []);
  return { data, loading, error, reload, refresh };
}

/** Supabase yanıtını açar: hata varsa fırlatır. */
export function unwrap<T>(res: { data: T | null; error: unknown }): T {
  if (res.error) throw res.error;
  return res.data as T;
}
