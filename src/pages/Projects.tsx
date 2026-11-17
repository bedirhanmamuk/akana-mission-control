import { useMemo, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { FolderKanban, Plus } from "lucide-react";
import { useAuth } from "../context/AuthContext";
import { useAsync } from "../lib/useAsync";
import { fetchDepartments, fetchDirectory, fetchProjects } from "../lib/api";
import { PROJECT_STATUS_META } from "../lib/constants";
import { daysUntil, formatDate } from "../lib/format";
import type { ProjectStatus } from "../lib/types";
import ProjectForm from "../components/ProjectForm";
import { EmptyState, ErrorState, LoadingState, PageHeader, ProgressBar, ProjectStatusBadge, Segmented } from "../components/ui";

type Filter = "open" | "all" | "closed";

export default function Projects() {
  const { isAdmin } = useAuth();
  const navigate = useNavigate();
  const [filter, setFilter] = useState<Filter>("open");
  const [creating, setCreating] = useState(false);
  const { data, loading, error, reload } = useAsync(async () => {
    const [projects, departments, people] = await Promise.all([fetchProjects(), fetchDepartments(), fetchDirectory()]);
    return { projects, departments, people };
  }, []);

  const list = useMemo(() => {
    const closed: ProjectStatus[] = ["COMPLETED", "CANCELLED"];
    return (data?.projects ?? []).filter((p) => filter === "all" || (filter === "closed" ? closed.includes(p.status) : !closed.includes(p.status)));
  }, [data, filter]);

  return (
    <>
      <PageHeader title="Projeler" description="İlerleme, projedeki görevlerin ortalamasıdır."
        actions={isAdmin && <button className="btn-primary" onClick={() => setCreating(true)}><Plus className="size-4" /> Yeni proje</button>} />
      <div className="mb-4"><Segmented label="Proje filtresi" value={filter} onChange={setFilter} options={[["open", "Süren"], ["closed", "Kapanan"], ["all", "Tümü"]] as const} /></div>
      {loading && !data ? <LoadingState variant="list" /> : error || !data ? <ErrorState message={error ?? ""} onRetry={reload} /> : list.length === 0 ? (
        <EmptyState icon={<FolderKanban className="size-6" />} title={data.projects.length === 0 ? "Henüz proje yok" : "Bu filtrede proje yok"}
          description={isAdmin ? "İlk projeyi oluşturun." : "Projeler yönetici tarafından oluşturulur."}
          action={isAdmin && data.projects.length === 0 ? <button className="btn-primary" onClick={() => setCreating(true)}><Plus className="size-4" /> Yeni proje</button> : undefined} />
      ) : (
        <div className="stagger grid gap-4 md:grid-cols-2 xl:grid-cols-3" data-testid="project-list">
          {list.map((p) => {
            const left = daysUntil(p.target_date);
            const late = left < 0 && !["COMPLETED", "CANCELLED"].includes(p.status);
            return (
              <article key={p.id} className="card card-link relative flex flex-col gap-3 p-5" data-testid="project-card">
                <div className="flex items-start justify-between gap-3">
                  <span className="code-tag">{p.code}</span>
                  <ProjectStatusBadge status={p.status} />
                </div>
                <h2 className="display text-lg font-semibold leading-tight"><Link to={`/projeler/${p.id}`} className="after:absolute after:inset-0 after:rounded-2xl">{p.name}</Link></h2>
                {p.description && <p className="line-clamp-2 text-sm text-muted">{p.description}</p>}
                <div className="mt-auto">
                  <div className="mb-1.5 flex items-baseline justify-between text-sm">
                    <span className="text-muted">{p.completed_tasks}/{p.total_tasks} görev</span>
                    <span className="num text-xl font-semibold">%{p.progress}</span>
                  </div>
                  <ProgressBar value={p.progress} tone={late ? "danger" : p.progress >= 100 ? "success" : "accent"} label={`${p.name} ilerlemesi`} />
                </div>
                <dl className="grid grid-cols-2 gap-2 border-t border-line-soft pt-3 text-xs">
                  <div><dt className="text-faint">Sorumlu</dt><dd className="truncate">{p.owner_name || "Atanmadı"}</dd></div>
                  <div><dt className="text-faint">Hedef</dt><dd className={late ? "text-danger" : ""}>{formatDate(p.target_date)}{!["COMPLETED", "CANCELLED"].includes(p.status) && ` · ${late ? `${-left} gün gecikti` : `${left} gün`}`}</dd></div>
                </dl>
                {(p.overdue_tasks > 0 || p.blocked_tasks > 0) && (
                  <p className="text-xs text-danger">{p.overdue_tasks > 0 && `${p.overdue_tasks} geciken görev`}{p.overdue_tasks > 0 && p.blocked_tasks > 0 && " · "}{p.blocked_tasks > 0 && `${p.blocked_tasks} bloke görev`}</p>
                )}
                <span className="sr-only">{PROJECT_STATUS_META[p.status].label}</span>
              </article>
            );
          })}
        </div>
      )}
      {creating && data && (
        <ProjectForm project={null} departments={data.departments} people={data.people} onClose={() => setCreating(false)}
          onSaved={(id) => { setCreating(false); navigate(`/projeler/${id}`); }} />
      )}
    </>
  );
}
