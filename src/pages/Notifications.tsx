import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { Bell, CheckCheck, Trash2 } from "lucide-react";
import { supabase } from "../lib/supabase";
import { useAuth } from "../context/AuthContext";
import { useNotifications } from "../context/NotificationContext";
import { useToast } from "../context/ToastContext";
import { unwrap, useAsync } from "../lib/useAsync";
import { errorMessage } from "../lib/errors";
import { NOTIFICATION_META } from "../lib/constants";
import { formatDateTime, timeAgo } from "../lib/format";
import type { Notification } from "../lib/types";
import { Badge, EmptyState, ErrorState, LoadingState, PageHeader } from "../components/ui";
import NotificationPreferences from "../components/NotificationPreferences";

export default function Notifications() {
  const { profile } = useAuth();
  const uid = profile!.id;
  const { refreshUnread } = useNotifications();
  const toast = useToast();
  const navigate = useNavigate();
  const [onlyUnread, setOnlyUnread] = useState(false);

  const { data, loading, error, reload } = useAsync<Notification[]>(async () => {
    let q = supabase.from("notifications").select("*").eq("user_id", uid);
    if (onlyUnread) q = q.eq("is_read", false);
    return unwrap(await q.order("created_at", { ascending: false }).limit(200));
  }, [uid, onlyUnread]);

  async function markRead(ids: string[]) {
    if (ids.length === 0) return;
    const { error: err } = await supabase.from("notifications")
      .update({ is_read: true, read_at: new Date().toISOString() }).in("id", ids);
    if (err) return toast.error(errorMessage(err));
    refreshUnread();
    reload();
  }

  async function markAll() {
    const { error: err } = await supabase.from("notifications")
      .update({ is_read: true, read_at: new Date().toISOString() }).eq("user_id", uid).eq("is_read", false);
    if (err) return toast.error(errorMessage(err));
    toast.success("Tüm bildirimler okundu olarak işaretlendi.");
    refreshUnread();
    reload();
  }

  async function remove(id: string) {
    const { error: err } = await supabase.from("notifications").delete().eq("id", id);
    if (err) return toast.error(errorMessage(err));
    refreshUnread();
    reload();
  }

  async function open(n: Notification) {
    if (!n.is_read) await markRead([n.id]);
    if (n.link) navigate(n.link);
  }

  const unread = data?.filter((n) => !n.is_read).length ?? 0;

  return (
    <>
      <PageHeader title="Bildirimler" description="Görev ve rapor süreçlerinizle ilgili güncellemeler."
        actions={<>
          <label className="flex min-h-10 cursor-pointer items-center gap-2 text-sm text-muted">
            <input type="checkbox" className="size-4" checked={onlyUnread} onChange={(e) => setOnlyUnread(e.target.checked)} /> Yalnızca okunmamış
          </label>
          <button className="btn-secondary" onClick={() => void markAll()} disabled={unread === 0}><CheckCheck className="size-4" /> Tümünü okundu işaretle</button>
        </>} />

      {loading ? <LoadingState /> : error || !data ? <ErrorState message={error ?? ""} onRetry={reload} /> : data.length === 0 ? (
        <EmptyState icon={<Bell className="size-6" />} title={onlyUnread ? "Okunmamış bildiriminiz yok" : "Henüz bildiriminiz yok"}
          description="Atamalar, teslim tarihleri ve inceleme sonuçları." />
      ) : (
        <ul className="stagger space-y-2" data-testid="notification-list">
          {data.map((n) => {
            const meta = NOTIFICATION_META[n.type] ?? { label: n.type, tone: "neutral" as const };
            return (
              <li key={n.id} data-testid="notification-item" data-read={n.is_read}
                className={`card flex items-start gap-3 p-4 transition-colors ${n.is_read ? "opacity-70" : "border-accent/40"}`}>
                <span className={`mt-1.5 size-2 shrink-0 rounded-full ${n.is_read ? "bg-line" : "bg-accent"}`} aria-label={n.is_read ? "Okundu" : "Okunmadı"} />
                <button className="min-w-0 flex-1 text-left" onClick={() => void open(n)}>
                  <div className="mb-1 flex flex-wrap items-center gap-2">
                    <span className="text-sm font-medium">{n.title}</span>
                    <Badge tone={meta.tone}>{meta.label}</Badge>
                  </div>
                  <p className="text-sm text-muted">{n.body}</p>
                  <p className="mt-1.5 text-xs text-muted/70" title={formatDateTime(n.created_at)}>{timeAgo(n.created_at)} · {formatDateTime(n.created_at)}</p>
                </button>
                <div className="flex shrink-0 flex-col gap-1 sm:flex-row">
                  {!n.is_read && (
                    <button className="rounded-md p-2 text-muted hover:bg-ink/5 hover:text-success" onClick={() => void markRead([n.id])} aria-label="Okundu olarak işaretle" title="Okundu olarak işaretle">
                      <CheckCheck className="size-4" />
                    </button>
                  )}
                  <button className="rounded-md p-2 text-muted hover:bg-danger/10 hover:text-danger" onClick={() => void remove(n.id)} aria-label="Bildirimi sil" title="Sil">
                    <Trash2 className="size-4" />
                  </button>
                </div>
              </li>
            );
          })}
        </ul>
      )}
      <div className="mt-8"><NotificationPreferences /></div>
    </>
  );
}
