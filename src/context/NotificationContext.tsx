import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { supabase } from "../lib/supabase";
import { useAuth } from "./AuthContext";

interface NotificationState {
  unreadCount: number;
  refreshUnread: () => void;
}

const Ctx = createContext<NotificationState>({ unreadCount: 0, refreshUnread: () => undefined });

const POLL_MS = 30_000;

export function NotificationProvider({ children }: { children: ReactNode }) {
  const { profile } = useAuth();
  const [unreadCount, setUnreadCount] = useState(0);
  const uid = profile?.is_active ? profile.id : null;

  const refreshUnread = useCallback(() => {
    if (!uid) return;
    supabase
      .from("notifications")
      .select("id", { count: "exact", head: true })
      .eq("user_id", uid)
      .eq("is_read", false)
      .then(({ count, error }) => {
        if (!error) setUnreadCount(count ?? 0);
      });
  }, [uid]);

  useEffect(() => {
    if (!uid) {
      setUnreadCount(0);
      return;
    }
    refreshUnread();
    const timer = window.setInterval(() => {
      if (document.visibilityState === "visible") refreshUnread();
    }, POLL_MS);
    const onFocus = () => refreshUnread();
    window.addEventListener("focus", onFocus);
    return () => {
      window.clearInterval(timer);
      window.removeEventListener("focus", onFocus);
    };
  }, [uid, refreshUnread]);

  const value = useMemo(() => ({ unreadCount, refreshUnread }), [unreadCount, refreshUnread]);
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useNotifications(): NotificationState {
  return useContext(Ctx);
}
