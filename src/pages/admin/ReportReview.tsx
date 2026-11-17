import { useState } from "react";
import { Link } from "react-router-dom";
import { ChevronRight, ClipboardCheck } from "lucide-react";
import { supabase } from "../../lib/supabase";
import { unwrap, useAsync } from "../../lib/useAsync";
import { REPORT_STATUS_META } from "../../lib/constants";
import { formatBytes, timeAgo } from "../../lib/format";
import type { ReportOverview, ReportStatus } from "../../lib/types";
import { EmptyState, ErrorState, LoadingState, PageHeader, ReportStatusBadge } from "../../components/ui";

const TABS: { key: string; label: string; statuses: ReportStatus[] }[] = [
  { key: "queue", label: "İnceleme kuyruğu", statuses: ["PENDING", "IN_REVIEW"] },
  { key: "revision", label: "Revizyon istenen", statuses: ["REVISION_REQUESTED"] },
  { key: "approved", label: "Onaylanan", statuses: ["APPROVED"] },
  { key: "rejected", label: "Reddedilen", statuses: ["REJECTED"] },
];

export default function ReportReview() {
  const [tab, setTab] = useState("queue");
  const { data, loading, error, reload } = useAsync<ReportOverview[]>(
    async () => unwrap(await supabase.from("report_overview").select("*").order("updated_at", { ascending: true }).limit(500)), [],
  );

  const current = TABS.find((t) => t.key === tab)!;
  const rows = (data ?? []).filter((r) => current.statuses.includes(r.status));
  const count = (s: ReportStatus[]) => (data ?? []).filter((r) => s.includes(r.status)).length;

  return (
    <>
      <PageHeader title="Rapor İnceleme" description="Yüklenen raporlar onaylanmadan önce burada incelenir. Kuyruk en eski yüklemeden başlar." />
      <div className="mb-4 flex gap-1 overflow-x-auto rounded-lg bg-surface p-1" role="tablist">
        {TABS.map((t) => (
          <button key={t.key} role="tab" aria-selected={tab === t.key} onClick={() => setTab(t.key)}
            className={`flex min-h-9 shrink-0 items-center gap-2 rounded-md px-3 text-sm transition-colors ${tab === t.key ? "bg-accent text-on-accent" : "text-muted hover:text-ink"}`}>
            {t.label}
            <span className={`rounded-full px-1.5 text-[11px] tabular-nums ${tab === t.key ? "bg-white/25" : "bg-ink/8"}`}>{count(t.statuses)}</span>
          </button>
        ))}
      </div>

      {loading ? <LoadingState /> : error ? <ErrorState message={error} onRetry={reload} /> : rows.length === 0 ? (
        <EmptyState icon={<ClipboardCheck className="size-6" />}
          title={tab === "queue" ? "İnceleme bekleyen rapor yok" : `${current.label} rapor yok`}
          description={tab === "queue" ? "Üyeler rapor yüklediğinde burada listelenecek." : undefined} />
      ) : (
        <ul className="stagger space-y-2" data-testid="review-queue">
          {rows.map((r) => (
            <li key={r.id}>
              <Link to={`/yonetim/rapor-inceleme/${r.id}`} className="card flex items-center gap-4 p-4 card-link" data-testid="review-item">
                <div className="min-w-0 flex-1">
                  <div className="mb-1 flex flex-wrap items-center gap-2">
                    <span className="code-tag">{r.task_code}</span>
                    <span className="rounded bg-accent/20 px-1.5 font-mono text-[11px] font-bold text-accent-2">V{r.current_version}</span>
                    <ReportStatusBadge status={r.status} />
                  </div>
                  <p className="truncate text-sm font-medium">{r.title}</p>
                  <p className="mt-0.5 truncate text-xs text-muted">
                    {r.uploader_name} · {r.department_name} · {r.file_count} dosya ({formatBytes(r.total_bytes)}) · {timeAgo(r.updated_at)}
                  </p>
                </div>
                <span className="hidden text-xs text-muted sm:inline">{REPORT_STATUS_META[r.status].label}</span>
                <ChevronRight className="size-5 shrink-0 text-muted" />
              </Link>
            </li>
          ))}
        </ul>
      )}
    </>
  );
}
