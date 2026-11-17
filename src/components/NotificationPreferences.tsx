import { useState } from "react";
import { BellRing } from "lucide-react";
import { supabase } from "../lib/supabase";
import { useAuth } from "../context/AuthContext";
import { useToast } from "../context/ToastContext";
import { unwrap, useAsync } from "../lib/useAsync";
import { errorMessage } from "../lib/errors";
import { NOTIFICATION_GROUPS, NOTIFICATION_META } from "../lib/constants";
import type { NotificationType } from "../lib/types";
import { Card, LoadingState, SectionTitle } from "./ui";

/** Kullanıcı bazında bildirim türlerini açar/kapatır. Kapalı türde bildirim sunucuda hiç oluşturulmaz. */
export default function NotificationPreferences() {
  const { profile } = useAuth();
  const toast = useToast();
  const uid = profile!.id;
  const [saving, setSaving] = useState<NotificationType | null>(null);
  // İyimser güncelleme: anahtar tıklamayı anında yansıtır, kayıt başarısızsa geri alınır
  const [local, setLocal] = useState<Partial<Record<NotificationType, boolean>>>({});
  const { data, loading, reload } = useAsync(async () => {
    const rows = unwrap(await supabase.from("notification_preferences").select("type,enabled").eq("user_id", uid)) as { type: NotificationType; enabled: boolean }[];
    return new Map(rows.map((r) => [r.type, r.enabled]));
  }, [uid]);

  async function toggle(type: NotificationType, enabled: boolean) {
    setLocal((l) => ({ ...l, [type]: enabled }));
    setSaving(type);
    const { error } = await supabase.from("notification_preferences").upsert({ user_id: uid, type, enabled, updated_at: new Date().toISOString() });
    setSaving(null);
    if (error) {
      setLocal((l) => { const n = { ...l }; delete n[type]; return n; });
      return toast.error(errorMessage(error));
    }
    reload();
  }

  return (
    <Card className="p-5">
      <SectionTitle><span className="flex items-center gap-2"><BellRing className="size-4 text-muted" /> Bildirim tercihleri</span></SectionTitle>
      <p className="mb-4 text-xs text-muted">Kapattığınız türler için bildirim oluşturulmaz. Görev ve rapor iş akışı bundan etkilenmez.</p>
      {loading && !data ? <LoadingState variant="compact" /> : (
        <div className="grid gap-5 md:grid-cols-3" data-testid="notification-preferences">
          {NOTIFICATION_GROUPS.map((g) => (
            <fieldset key={g.title}>
              <legend className="mb-2 text-xs font-medium text-faint">{g.title}</legend>
              <ul className="space-y-1">
                {g.types.map((t) => {
                  const on = local[t] ?? data?.get(t) ?? true;
                  return (
                    <li key={t}>
                      <label className="flex min-h-10 cursor-pointer items-center justify-between gap-3 rounded-lg px-2 hover:bg-ink/5">
                        <span className="text-sm">{NOTIFICATION_META[t].label}</span>
                        <input type="checkbox" role="switch" className="size-4" checked={on} aria-busy={saving === t} 
                          onChange={(e) => void toggle(t, e.target.checked)} aria-label={`${NOTIFICATION_META[t].label} bildirimleri`} />
                      </label>
                    </li>
                  );
                })}
              </ul>
            </fieldset>
          ))}
        </div>
      )}
    </Card>
  );
}
