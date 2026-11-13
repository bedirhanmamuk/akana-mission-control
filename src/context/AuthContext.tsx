import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import type { Session } from "@supabase/supabase-js";
import { supabase } from "../lib/supabase";
import { errorMessage } from "../lib/errors";
import type { Profile } from "../lib/types";

interface AuthState {
  session: Session | null;
  profile: Profile | null;
  /** İlk oturum/profil yüklemesi sürüyor */
  loading: boolean;
  profileError: string | null;
  isAdmin: boolean;
  signIn: (email: string, password: string) => Promise<void>;
  signOut: () => Promise<void>;
  refreshProfile: () => Promise<void>;
}

const AuthContext = createContext<AuthState | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [sessionReady, setSessionReady] = useState(false);
  const [profileLoading, setProfileLoading] = useState(false);
  const [profileError, setProfileError] = useState<string | null>(null);

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      setSession(data.session);
      setSessionReady(true);
    });
    // Not: geri çağrı içinde Supabase çağrısı yapılmaz (kilitlenmeyi önlemek için);
    // profil aşağıdaki effect'te yüklenir.
    const { data: sub } = supabase.auth.onAuthStateChange((_event, s) => {
      setSession(s);
      setSessionReady(true);
    });
    return () => sub.subscription.unsubscribe();
  }, []);

  const userId = session?.user.id ?? null;

  const loadProfile = useCallback(async (uid: string) => {
    setProfileError(null);
    // Rol ve durum her zaman veritabanından okunur; JWT veya yerel depoya güvenilmez.
    const { data, error } = await supabase.from("profiles").select("*").eq("id", uid).maybeSingle();
    if (error) {
      setProfileError(errorMessage(error));
      setProfile(null);
    } else if (!data) {
      setProfileError("Profil kaydınız bulunamadı. Yöneticinizle iletişime geçin.");
      setProfile(null);
    } else {
      setProfile(data as Profile);
    }
  }, []);

  useEffect(() => {
    if (!sessionReady) return;
    if (!userId) {
      setProfile(null);
      setProfileError(null);
      return;
    }
    let cancelled = false;
    setProfileLoading(true);
    loadProfile(userId).finally(() => {
      if (cancelled) return;
      setProfileLoading(false);
      // Teslim tarihi kontrolleri (idempotent); hata olursa sessizce geç.
      void supabase.rpc("process_deadlines").then(() => undefined, () => undefined);
    });
    return () => { cancelled = true; };
  }, [userId, sessionReady, loadProfile]);

  const signIn = useCallback(async (email: string, password: string) => {
    const { error } = await supabase.auth.signInWithPassword({ email: email.trim(), password });
    if (error) throw new Error(errorMessage(error, "Giriş yapılamadı."));
  }, []);

  const signOut = useCallback(async () => {
    await supabase.auth.signOut();
    setProfile(null);
  }, []);

  const refreshProfile = useCallback(async () => {
    if (userId) await loadProfile(userId);
  }, [userId, loadProfile]);

  const value = useMemo<AuthState>(() => ({
    session,
    profile,
    loading: !sessionReady || (Boolean(userId) && !profile && !profileError) || (profileLoading && !profile),
    profileError,
    isAdmin: profile?.role === "ADMIN" && profile.is_active,
    signIn,
    signOut,
    refreshProfile,
  }), [session, profile, sessionReady, userId, profileLoading, profileError, signIn, signOut, refreshProfile]);

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthState {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth, AuthProvider içinde kullanılmalıdır.");
  return ctx;
}
