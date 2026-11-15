import { useState } from "react";
import { ScrollText } from "lucide-react";
import { supabase } from "../../lib/supabase";
import { unwrap, useAsync } from "../../lib/useAsync";
import { fetchDirectory, nameMap } from "../../lib/api";
import { ACTION_LABEL } from "../../lib/constants";
import { formatDateTime, fullName } from "../../lib/format";
import type { ActivityLog } from "../../lib/types";
import { Badge, EmptyState, ErrorState, LoadingState, PageHeader } from "../../components/ui";
import type { Tone } from "../../lib/constants";

const PAGE_SIZE = 40;

function tone(action: string): Tone {
  if (/DELETED|REJECT/.test(action)) return "danger";
  if (/REVISION|PASSWORD|SETTING/.test(action)) return "warning";
  if (/APPROVE|CREATED|BOOTSTRAP/.test(action)) return "success";
  return "accent";
}

export default function Logs() {
  const [action, setAction] = useState("");
  const [page, setPage] = useState(0);
  const names = useAsync(async () => nameMap(await fetchDirectory()), []);
  const { data, loading, error, reload } = useAsync(async () => {
    let q = supabase.from("activity_logs").select("*", { count: "exact" });
    if (action) q = q.eq("action", action);
    const res = await q.order("created_at", { ascending: false }).range(page * PAGE_SIZE, page * PAGE_SIZE + PAGE_SIZE - 1);
    return { rows: unwrap(res) as ActivityLog[], count: res.count ?? 0 };
  }, [action, page]);

  const actor = (l: ActivityLog) => (l.actor_id ? fullName(names.data?.get(l.actor_id)) : "Sistem");

  return (
    <>
      <PageHeader title="Sistem Kayıtları" description="Sistemde gerçekleştirilen önemli işlemlerin değiştirilemez denetim kaydı."
        actions={
          <select className="input sm:w-60" value={action} onChange={(e) => { setAction(e.target.value); setPage(0); }} aria-label="İşlem türüne göre filtrele">
            <option value="">Tüm işlemler</option>
            {Object.entries(ACTION_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
          </select>
        } />

      {loading && !data ? <LoadingState /> : error || !data ? <ErrorState message={error ?? ""} onRetry={reload} /> : data.rows.length === 0 ? (
        <EmptyState icon={<ScrollText className="size-6" />} title="Kayıt bulunamadı" />
      ) : (
        <div className={`card overflow-hidden ${loading ? "opacity-60" : ""}`}>
          <table className="hidden w-full md:table">
            <thead className="border-b border-line-soft">
              <tr><th className="th">Tarih</th><th className="th">İşlem</th><th className="th">Açıklama</th><th className="th">Yapan</th></tr>
            </thead>
            <tbody className="divide-y divide-line-soft">
              {data.rows.map((l) => (
                <tr key={l.id} data-testid="log-row">
                  <td className="td whitespace-nowrap font-mono text-xs text-muted">{formatDateTime(l.created_at)}</td>
                  <td className="td"><Badge tone={tone(l.action)}>{ACTION_LABEL[l.action] ?? l.action}</Badge></td>
                  <td className="td">{l.summary}</td>
                  <td className="td whitespace-nowrap text-muted">{actor(l)}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <ul className="divide-y divide-line-soft md:hidden">
            {data.rows.map((l) => (
              <li key={l.id} className="space-y-1.5 p-4" data-testid="log-row">
                <div className="flex items-center justify-between gap-2">
                  <Badge tone={tone(l.action)}>{ACTION_LABEL[l.action] ?? l.action}</Badge>
                  <span className="font-mono text-[11px] text-muted">{formatDateTime(l.created_at)}</span>
                </div>
                <p className="text-sm">{l.summary}</p>
                <p className="text-xs text-muted">{actor(l)}</p>
              </li>
            ))}
          </ul>
        </div>
      )}

      {data && data.count > PAGE_SIZE && (
        <div className="mt-4 flex items-center justify-between text-sm">
          <button className="btn-secondary" disabled={page === 0} onClick={() => setPage((p) => p - 1)}>Önceki</button>
          <span className="text-muted">Sayfa {page + 1} / {Math.ceil(data.count / PAGE_SIZE)} · {data.count} kayıt</span>
          <button className="btn-secondary" disabled={(page + 1) * PAGE_SIZE >= data.count} onClick={() => setPage((p) => p + 1)}>Sonraki</button>
        </div>
      )}
    </>
  );
}
