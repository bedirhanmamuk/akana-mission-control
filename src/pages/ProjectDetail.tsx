import { useMemo, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { ArrowLeft, FileText, Pencil, Plus, ShieldAlert, Trash2 } from "lucide-react";
import { supabase } from "../lib/supabase";
import { useAuth } from "../context/AuthContext";
import { useToast } from "../context/ToastContext";
import { unwrap, useAsync } from "../lib/useAsync";
import { fetchDepartments, fetchDirectory, fetchDocuments, fetchProject, fetchRisks, TASK_SELECT } from "../lib/api";
import { errorMessage } from "../lib/errors";
import { DOCUMENT_CATEGORY_LABEL } from "../lib/constants";
import { daysUntil, formatDate } from "../lib/format";
import type { TaskWithRelations } from "../lib/types";
import Gantt, { GanttLegend, type GanttZoom } from "../components/Gantt";
import ProjectForm from "../components/ProjectForm";
import TCountdown from "../components/TCountdown";
import {
  Card, DocumentStatusBadge, ErrorState, InfoRow, LoadingState, Modal, PageHeader, PriorityBadge, ProgressBar,
  ProjectStatusBadge, RiskScore, SectionTitle, Segmented, Spinner, TaskStatusBadge, Unauthorized,
} from "../components/ui";

export default function ProjectDetail() {
  const { id = "" } = useParams();
  const { profile, isAdmin, isManager } = useAuth();
  const toast = useToast();
  const navigate = useNavigate();
  const [modal, setModal] = useState<"edit" | "delete" | null>(null);
  const [zoom, setZoom] = useState<GanttZoom>("week");
  const [busy, setBusy] = useState(false);

  const { data, loading, error, reload } = useAsync(async () => {
    const project = await fetchProject(id);
    if (!project) return null;
    const [tasks, deps, risks, docs, departments, people] = await Promise.all([
      supabase.from("tasks").select(TASK_SELECT).eq("project_id", id).order("start_date").then(unwrap<TaskWithRelations[]>),
      supabase.from("task_dependencies").select("task_id,depends_on_id").then(unwrap<{ task_id: string; depends_on_id: string }[]>),
      fetchRisks().then((r) => r.filter((x) => x.project_id === id)),
      fetchDocuments({ projectId: id }),
      fetchDepartments(), fetchDirectory(),
    ]);
    return { project, tasks, deps, risks, docs, departments, people };
  }, [id]);

  const groups = useMemo(() => {
    if (!data) return [];
    return data.departments.map((d) => ({ key: d.id, label: d.name, tasks: data.tasks.filter((t) => t.department_id === d.id && t.status !== "CANCELLED") }))
      .filter((g) => g.tasks.length > 0);
  }, [data]);

  if (loading && !data) return <LoadingState />;
  if (error) return <ErrorState message={error} onRetry={reload} />;
  if (!data) return <Unauthorized />;
  const { project: p, tasks, deps, risks, docs } = data;
  const canEdit = isAdmin || p.owner_id === profile?.id;
  const left = daysUntil(p.target_date);
  const open = !["COMPLETED", "CANCELLED"].includes(p.status);

  async function remove() {
    setBusy(true);
    const { error: err } = await supabase.from("projects").delete().eq("id", p.id);
    setBusy(false);
    if (err) return toast.error(errorMessage(err));
    toast.success("Proje silindi; görevleri korunarak projesiz kaldı.");
    navigate("/projeler");
  }

  return (
    <>
      <Link to="/projeler" className="mb-4 inline-flex items-center gap-1.5 text-sm text-muted hover:text-ink"><ArrowLeft className="size-4" /> Projeler</Link>
      <PageHeader title={p.name} description={p.description || undefined}
        actions={<>
          {isManager && <Link to={`/yonetim/gorev-olustur?proje=${p.id}`} className="btn-secondary"><Plus className="size-4" /> Görev ekle</Link>}
          {canEdit && <button className="btn-secondary" onClick={() => setModal("edit")}><Pencil className="size-4" /> Düzenle</button>}
          {isAdmin && <button className="btn-danger" onClick={() => setModal("delete")}><Trash2 className="size-4" /> Sil</button>}
        </>} />

      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_320px]">
        <Card className="p-5">
          <div className="flex flex-wrap items-end justify-between gap-4">
            <div>
              <p className="text-xs text-faint">Tamamlanma</p>
              <p className="num text-5xl font-semibold leading-none">%{p.progress}</p>
            </div>
            <div className="grid grid-cols-3 gap-6 text-sm">
              <div><p className="text-xs text-faint">Görev</p><p className="num text-xl font-semibold">{p.completed_tasks}/{p.total_tasks}</p></div>
              <div><p className="text-xs text-faint">Geciken</p><p className={`num text-xl font-semibold ${p.overdue_tasks ? "text-danger" : ""}`}>{p.overdue_tasks}</p></div>
              <div><p className="text-xs text-faint">Bloke</p><p className={`num text-xl font-semibold ${p.blocked_tasks ? "text-danger" : ""}`}>{p.blocked_tasks}</p></div>
            </div>
          </div>
          <ProgressBar className="mt-4 h-2" value={p.progress} tone={open && left < 0 ? "danger" : p.progress >= 100 ? "success" : "accent"} />
        </Card>
        <Card className="p-5">
          <dl className="divide-y divide-line-soft">
            <InfoRow label="Kod"><span className="code-tag">{p.code}</span></InfoRow>
            <InfoRow label="Durum"><ProjectStatusBadge status={p.status} /></InfoRow>
            <InfoRow label="Sorumlu">{p.owner_id ? <Link to={`/ekip/${p.owner_id}`} className="hover:text-accent-2">{p.owner_name}</Link> : "Atanmadı"}</InfoRow>
            <InfoRow label="Başlangıç">{formatDate(p.start_date)}</InfoRow>
            <InfoRow label="Hedef teslim"><span className={open && left < 0 ? "text-danger" : ""}>{formatDate(p.target_date)}{open && ` (${left < 0 ? `${-left} gün gecikti` : `${left} gün kaldı`})`}</span></InfoRow>
          </dl>
        </Card>
      </div>

      <section className="mt-6">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
          <h2 className="display text-lg font-semibold">Proje zaman çizelgesi</h2>
          <Segmented label="Yakınlaştırma" size="sm" value={zoom} onChange={setZoom} options={[["day", "Gün"], ["week", "Hafta"], ["month", "Ay"]] as const} />
        </div>
        {groups.length === 0 ? <p className="card p-6 text-sm text-muted">Bu projeye henüz görev bağlanmadı.</p> : (
          <>
            <Gantt groups={groups} dependencies={deps} zoom={zoom} milestones={[{ date: p.target_date, label: "Hedef teslim" }]} />
            <div className="mt-3"><GanttLegend /></div>
          </>
        )}
      </section>

      <div className="mt-6 grid gap-4 xl:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)]">
        <Card className="p-5">
          <SectionTitle aside={<span className="text-xs text-muted">{tasks.length} görev</span>}>Görevler</SectionTitle>
          {tasks.length === 0 ? <p className="text-sm text-muted">Görev yok.</p> : (
            <ul className="divide-y divide-line-soft">
              {tasks.map((t) => (
                <li key={t.id}>
                  <Link to={`/gorevler/${t.id}`} className="flex items-center gap-3 py-2.5 hover:opacity-80">
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm"><span className="code-tag mr-2">{t.code}</span>{t.title}</span>
                      <span className="block text-xs text-muted">{t.department?.name} · %{t.progress}</span>
                    </span>
                    <span className="hidden sm:inline"><PriorityBadge priority={t.priority} /></span>
                    <TCountdown dueDate={t.due_date} status={t.status} showDate={false} />
                    <TaskStatusBadge status={t.status} />
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </Card>
        <div className="space-y-4">
          <Card className="p-5">
            <SectionTitle aside={<Link to="/riskler" className="text-xs text-accent-2 hover:underline">Risk kaydı</Link>}><span className="flex items-center gap-2"><ShieldAlert className="size-4 text-muted" /> Riskler</span></SectionTitle>
            {risks.length === 0 ? <p className="text-sm text-muted">Bu projeye bağlı risk kaydı yok.</p> : (
              <ul className="divide-y divide-line-soft">
                {risks.map((r) => (
                  <li key={r.id}><Link to={`/riskler/${r.id}`} className="flex items-center gap-3 py-2 hover:opacity-80">
                    <span className="min-w-0 flex-1 truncate text-sm"><span className="code-tag mr-2">{r.code}</span>{r.title}</span><RiskScore score={r.score} />
                  </Link></li>
                ))}
              </ul>
            )}
          </Card>
          <Card className="p-5">
            <SectionTitle aside={<Link to={`/dokumanlar?proje=${p.id}`} className="text-xs text-accent-2 hover:underline">Doküman merkezi</Link>}><span className="flex items-center gap-2"><FileText className="size-4 text-muted" /> Dokümanlar</span></SectionTitle>
            {docs.length === 0 ? <p className="text-sm text-muted">Bu projeye arşivlenmiş doküman yok.</p> : (
              <ul className="divide-y divide-line-soft">
                {docs.slice(0, 8).map((d) => (
                  <li key={d.id}><Link to={`/dokumanlar/${d.id}`} className="flex items-center gap-3 py-2 hover:opacity-80">
                    <span className="min-w-0 flex-1"><span className="block truncate text-sm">{d.title}</span><span className="block text-xs text-muted">{DOCUMENT_CATEGORY_LABEL[d.category]} · V{d.current_version}</span></span>
                    <DocumentStatusBadge status={d.status} />
                  </Link></li>
                ))}
              </ul>
            )}
          </Card>
        </div>
      </div>

      {modal === "edit" && <ProjectForm project={p} departments={data.departments} people={data.people} onClose={() => setModal(null)} onSaved={() => { setModal(null); reload(); }} />}
      <Modal open={modal === "delete"} onClose={() => setModal(null)} title="Projeyi sil"
        footer={<><button className="btn-secondary" onClick={() => setModal(null)} disabled={busy}>Vazgeç</button>
          <button className="btn-danger" onClick={() => void remove()} disabled={busy}>{busy && <Spinner className="size-4" />} Evet, sil</button></>}>
        <p className="text-sm"><span className="code-tag">{p.code}</span> projesi silinecek. Görevler, riskler ve dokümanlar silinmez; yalnızca proje bağlantıları kaldırılır.</p>
      </Modal>
    </>
  );
}
