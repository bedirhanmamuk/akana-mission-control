import { useEffect, useState } from "react";
import { supabase } from "./supabase";
import { AVATARS_BUCKET } from "./files";

/**
 * Profil fotoğrafları özel bucket'tadır. Aynı ekrandaki tüm avatarlar için tek bir
 * createSignedUrls isteği atılır (toplama penceresi: bir mikro görev) ve sonuç
 * 50 dakika önbellekte tutulur (URL ömrü 60 dakika).
 */
const cache = new Map<string, { url: string; at: number }>();
const waiting = new Map<string, ((url: string | null) => void)[]>();
let scheduled = false;
const TTL = 50 * 60 * 1000;

async function flush() {
  scheduled = false;
  const paths = [...waiting.keys()];
  const callbacks = new Map(waiting);
  waiting.clear();
  if (paths.length === 0) return;
  const { data } = await supabase.storage.from(AVATARS_BUCKET).createSignedUrls(paths, 3600);
  const byPath = new Map((data ?? []).map((d) => [d.path, d.signedUrl]));
  for (const p of paths) {
    const url = byPath.get(p) ?? null;
    if (url) cache.set(p, { url, at: Date.now() });
    callbacks.get(p)?.forEach((cb) => cb(url));
  }
}

function request(path: string): Promise<string | null> {
  const hit = cache.get(path);
  if (hit && Date.now() - hit.at < TTL) return Promise.resolve(hit.url);
  return new Promise((resolve) => {
    waiting.set(path, [...(waiting.get(path) ?? []), resolve]);
    if (!scheduled) {
      scheduled = true;
      queueMicrotask(() => void flush());
    }
  });
}

export function useAvatarUrl(path: string | null | undefined): string | null {
  const [url, setUrl] = useState<string | null>(() => (path ? cache.get(path)?.url ?? null : null));
  useEffect(() => {
    let alive = true;
    if (!path) { setUrl(null); return; }
    void request(path).then((u) => { if (alive) setUrl(u); });
    return () => { alive = false; };
  }, [path]);
  return url;
}

export function forgetAvatar(path: string | null | undefined) {
  if (path) cache.delete(path);
}
