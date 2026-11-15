import { Link } from "react-router-dom";
import { Building2, Settings2, UserRound } from "lucide-react";
import { useAuth } from "../context/AuthContext";
import { useAsync } from "../lib/useAsync";
import { fetchDepartmentStats, fetchDepartments, fetchDirectory, nameMap } from "../lib/api";
import { fullName } from "../lib/format";
import { Badge, EmptyState, ErrorState, LoadingState, PageHeader } from "../components/ui";

function Metric({ label, value }: { label: string; value: number | string }) {
  return (
    <div className="rounded-lg bg-surface px-3 py-2">
      <p className="text-[11px] text-muted">{label}</p>
      <p className="text-lg font-semibold tabular-nums">{value}</p>
    </div>
  );
}

export default function Departments() {
  const { profile, isAdmin } = useAuth();
  const { data, loading, error, reload } = useAsync(async () => {
    const [departments, stats, dir] = await Promise.all([fetchDepartments(), fetchDepartmentStats(), fetchDirectory()]);
    return { departments, stats: new Map(stats.map((s) => [s.department_id, s])), names: nameMap(dir) };
  }, []);

  return (
    <>
      <PageHeader title="Departmanlar"
        description={isAdmin ? "Tüm departmanların görev ve rapor durumu." : "Takım departmanları. Ayrıntılı sayılar yalnızca kendi departmanınız için gösterilir."}
        actions={isAdmin && <Link to="/yonetim" className="btn-secondary"><Settings2 className="size-4" /> Departmanları yönet</Link>} />

      {loading ? <LoadingState /> : error || !data ? <ErrorState message={error ?? ""} onRetry={reload} /> : data.departments.length === 0 ? (
        <EmptyState icon={<Building2 className="size-6" />} title="Henüz departman yok" description="Departmanlar Yönetim Paneli'nden oluşturulur." />
      ) : (
        <div className="stagger grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {data.departments.map((d) => {
            const s = data.stats.get(d.id);
            const mine = profile?.department_id === d.id;
            return (
              <article key={d.id} className={`card flex flex-col p-5 ${mine ? "border-accent/50" : ""} ${d.is_active ? "" : "opacity-60"}`} data-testid="department-card">
                <div className="flex items-start justify-between gap-3">
                  <div className="flex items-center gap-3">
                    <div className="flex size-10 items-center justify-center rounded-lg bg-accent/15 font-mono text-xs font-bold text-accent-2">{d.code}</div>
                    <div>
                      <h2 className="font-semibold leading-tight">{d.name}</h2>
                      <p className="mt-0.5 flex items-center gap-1 text-xs text-muted">
                        <UserRound className="size-3.5" /> Sorumlu: {d.lead_id ? fullName(data.names.get(d.lead_id)) : "Atanmadı"}
                      </p>
                    </div>
                  </div>
                  {mine ? <Badge tone="accent">Departmanım</Badge> : !d.is_active ? <Badge>Pasif</Badge> : null}
                </div>
                {d.description && <p className="mt-3 text-sm text-muted">{d.description}</p>}
                {s ? (
                  <div className="mt-4 grid grid-cols-3 gap-2">
                    <Metric label="Üye" value={s.member_count} />
                    <Metric label="Toplam görev" value={s.total_tasks} />
                    <Metric label="Tamamlanan" value={s.completed_tasks} />
                    <Metric label="Teslim edilen rapor" value={s.submitted_reports} />
                    <Metric label="Bekleyen rapor" value={s.pending_reports} />
                    <Metric label="Tamamlama" value={s.total_tasks > 0 ? `%${Math.round((s.completed_tasks / s.total_tasks) * 100)}` : "—"} />
                  </div>
                ) : (
                  <p className="mt-4 rounded-lg bg-surface px-3 py-2 text-xs text-muted">Bu departmanın sayıları yalnızca kendi üyelerine ve yöneticilere açıktır.</p>
                )}
              </article>
            );
          })}
        </div>
      )}
    </>
  );
}
