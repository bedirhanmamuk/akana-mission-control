import { createClient, type SupabaseClient } from "@supabase/supabase-js";

const url = import.meta.env.VITE_SUPABASE_URL?.trim();
const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY?.trim();

/** Ortam değişkenleri tanımlı mı? Değilse uygulama kurulum ekranını gösterir. */
export const isSupabaseConfigured = Boolean(url && anonKey);

export const SUPABASE_URL = url ?? "";
export const SUPABASE_ANON_KEY = anonKey ?? "";

// Yalnızca anon anahtar kullanılır; tüm yetkilendirme RLS ile veritabanında yapılır.
export const supabase: SupabaseClient = isSupabaseConfigured
  ? createClient(url!, anonKey!, {
      auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: false },
    })
  : (new Proxy({}, {
      get() {
        throw new Error("Supabase yapılandırılmamış: VITE_SUPABASE_URL ve VITE_SUPABASE_ANON_KEY gerekli.");
      },
    }) as SupabaseClient);

export const REPORTS_BUCKET = "reports";
