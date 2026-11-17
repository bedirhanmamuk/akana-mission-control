import { useMemo, useState, type CSSProperties, type DragEvent } from "react";
import { Link, useSearchParams } from "react-router-dom";
import {
  ClipboardList, GitBranch, KanbanSquare, LayoutGrid, List, Pencil, Plus, Search, SlidersHorizontal, Trash2, Users, X,
} from "lucide-react";
import { supabase } from "../lib/supabase";
import { useAuth } from "../context/AuthContext";
import { useToast } from "../context/ToastContext";
import { useAsync } from "../lib/useAsync";
import { fetchDepartments, fetchDirectory, fetchProjectList, fetchTasks, nameMap } from "../lib/api";
import { errorMessage } from "../lib/errors";
import { BOARD_COLUMNS, CLOSED_STATUSES, PRIORITIES, PRIORITY_META, TASK_STATUS_META, TASK_STATUSES } from "../lib/constants";
import { daysUntil, fullName } from "../lib/format";
import TCountdown from "../components/TCountdown";
import { FlightTrack } from "../components/FlightProfile";
import type { DirectoryEntry, TaskPriority, TaskStatus, TaskWithRelations } from "../lib/types";
import {
  EmptyState, ErrorState, LoadingState, PageHeader, PriorityBadge, ProgressBar, Segmented, TaskStatusBadge,
} from "../components/ui";

type Scope = "mine" | "all";
type View = "cards" | "list" | "board";
type Sort = "due" | "priority" | "created" | "code" | "progress";
type Quick = "" | "geciken" | "bloke" | "kritik" | "acik" | "devam" | "tamamlanan";

const QUICK_LABEL: Record<Exclude<Quick, "">, string> = {
  geciken: "Geciken", bloke: "Bloke", kritik: "Kritik operasyonlar", acik: "Açık görevler", devam: "Devam eden", tamamlanan: "Tamamlanan",
};
const PRIORITY_RANK: Record<TaskPriority, number> = { CRITICAL: 0, HIGH: 1, NORMAL: 2, LOW: 3 };

const isOverdue = (t: TaskWithRelations) => !CLOSED_STATUSES.includes(t.status) && (t.status === "OVERDUE" || daysUntil(t.due_date) < 0);

function matchesQuick(t: TaskWithRelations, q: Quick): boolean {
  switch (q) {
    case "geciken": return isOverdue(t);
    case "bloke": return t.status === "BLOCKED";
    case "kritik": return !CLOSED_STATUSES.includes(t.status) && (t.status === "BLOCKED" || isOverdue(t) || t.priority === "CRITICAL" || t.priority === "HIGH");
    case "acik": return !CLOSED_STATUSES.includes(t.status);
    case "devam": return ["IN_PROGRESS", "AWAITING_REPORT", "IN_REVIEW", "REVISION_REQUESTED"].includes(t.status);
    case "tamamlanan": return t.status === "COMPLETED";
    default: return true;
  }
}

function assigneeNames(t: TaskWithRelations, names: Map<string, DirectoryEntry>): string {
  const list = t.task_assignees.map((a) => fullName(names.get(a.user_id)));
  if (list.length === 0) return "—";
  return list.length <= 2 ? list.join(", ") : `${list.slice(0, 2).join(", ")} +${list.length - 2}`;
}

/** Yönetici / departman sorumlusu için satır eylemleri: görev detayını ilgili pencere açık olarak açar. */
function AdminActions({ task }: { task: TaskWithRelations }) {
  return (
    <span className="relative z-10 flex shrink-0 items-center gap-1">
      <Link to={`/gorevler/${task.id}?islem=duzenle`} aria-label={`${task.code} görevini düzenle`} title="Düzenle"
        className="flex size-10 items-center justify-center rounded-lg text-muted transition-colors duration-150 hover:bg-ink/8 hover:text-ink active:scale-95">
        <Pencil className="size-4" />
      </Link>
      <Link to={`/gorevler/${task.id}?islem=sil`} aria-label={`${task.code} görevini sil`} title="Sil"
        className="flex size-10 items-center justify-center rounded-lg text-muted transition-colors duration-150 hover:bg-danger/12 hover:text-danger active:scale-95">
        <Trash2 className="size-4" />
      </Link>
    </span>
  );
}

function ProgressCell({ t }: { t: TaskWithRelations }) {
  return (
    <span className="flex min-w-24 items-center gap-2">
      <ProgressBar value={t.progress} tone={t.status === "BLOCKED" || isOverdue(t) ? "danger" : t.progress >= 100 ? "success" : "accent"} className="flex-1" />
      <span className="w-9 text-right text-xs text-muted tabular-nums">%{t.progress}</span>
    </span>
  );
}

/** Kanban: sütunlar iş akışı sırasındadır. Yöneticiler/sorumlular kartı sürükleyerek durumu değiştirir. */
function Board({ tasks, names, canManage, onMoved }: {
  tasks: TaskWithRelations[]; names: Map<string, DirectoryEntry>;
  canManage: (t: TaskWithRelations) => boolean; onMoved: () => void;
}) {
  const toast = useToast();
  const [drag, setDrag] = useState<string | null>(null);
  const [over, setOver] = useState<TaskStatus | null>(null);
  const columns = BOARD_COLUMNS.filter((s) => ["NEW", "IN_PROGRESS", "BLOCKED", "IN_REVIEW", "COMPLETED"].includes(s) || tasks.some((t) => t.status === s));

  async function drop(e: DragEvent, status: TaskStatus) {
    e.preventDefault();
    setOver(null);
    const id = e.dataTransfer.getData("text/task") || drag;
    setDrag(null);
    const task = tasks.find((t) => t.id === id);
    if (!task || task.status === status) return;
    if (status === "BLOCKED") {
      toast.error("Bloke etmek için görev detayında nedeni yazın.");
      return;
    }
    const { error } = await supabase.from("tasks").update({ status }).eq("id", task.id);
    if (error) return toast.error(errorMessage(error));
    toast.success(`${task.code} → ${TASK_STATUS_META[status].label}`);
    onMoved();
  }

  return (
    <div className="scroll-x -mx-4 px-4 pb-2 sm:mx-0 sm:px-0" data-testid="task-board">
      <div className="flex gap-3" style={{ minWidth: columns.length * 272 }}>
        {columns.map((s) => {
          const col = tasks.filter((t) => t.status === s);
          return (
            <section key={s} aria-label={`${TASK_STATUS_META[s].label} sütunu`}
              onDragOver={(e) => { if (drag) { e.preventDefault(); setOver(s); } }}
              onDragLeave={() => setOver((o) => (o === s ? null : o))}
              onDrop={(e) => void drop(e, s)}
              className={`flex w-64 shrink-0 flex-col rounded-2xl bg-surface/70 p-2 transition-colors ${over === s ? "bg-accent/10 ring-1 ring-accent/50" : ""}`}>
              <header className="flex items-center gap-2 px-2 pt-1 pb-2">
                <span className="size-2 rounded-full" style={{ background: TASK_STATUS_META[s].color }} />
                <h2 className="flex-1 text-[13px] font-medium">{TASK_STATUS_META[s].label}</h2>
                <span className="rounded-full bg-ink/8 px-1.5 text-[11px] text-muted tabular-nums">{col.length}</span>
              </header>
              <ul className="flex min-h-24 flex-col gap-2">
                {col.map((t) => {
                  const movable = canManage(t);
                  return (
                    <li key={t.id} draggable={movable}
                      onDragStart={(e) => { e.dataTransfer.setData("text/task", t.id); e.dataTransfer.effectAllowed = "move"; setDrag(t.id); }}
                      onDragEnd={() => { setDrag(null); setOver(null); }}
                      className={`card card-link relative space-y-2 p-3 ${movable ? "cursor-grab active:cursor-grabbing" : ""} ${drag === t.id ? "opacity-50" : ""}`}
                      data-testid="task-item">
                      <div className="flex items-center justify-between gap-2">
                        <span className="code-tag">{t.code}</span>
                        <PriorityBadge priority={t.priority} />
                      </div>
                      <p className="line-clamp-2 text-sm font-medium leading-snug">
                        <Link to={`/gorevler/${t.id}`} className="after:absolute after:inset-0 after:rounded-2xl" draggable={false}>{t.title}</Link>
                      </p>
                      {t.status !== "COMPLETED" && <ProgressCell t={t} />}
                      <div className="flex items-center justify-between gap-2 text-xs text-muted">
                        <span className="truncate">{assigneeNames(t, names)}</span>
                        <TCountdown dueDate={t.due_date} status={t.status} showDate={false} />
                      </div>
                    </li>
                  );
                })}
                {col.length === 0 && <li className="rounded-xl border border-dashed border-line px-3 py-6 text-center text-xs text-faint">Görev yok</li>}
              </ul>
            </section>
          );
        })}
      </div>
    </div>
  );
}

export default function MyTasks() {
  const { profile, isAdmin, isManager, canManageDepartment } = useAuth();
  const uid = profile!.id;
  const [params, setParams] = useSearchParams();
  const quick = (params.get("filtre") ?? "") as Quick;
  const [scope, setScope] = useState<Scope>(isManager || quick ? "all" : "mine");
  const [view, setView] = useState<View>(() => {
    try {
      const v = localStorage.getItem("amc.taskView");
      return v === "list" || v === "board" ? v : "cards";
    } catch { return "cards"; }
  });
  const [status, setStatus] = useState<TaskStatus | "">("");
  const [query, setQuery] = useState("");
  const [dept, setDept] = useState("");
  const [assignee, setAssignee] = useState("");
  const [priority, setPriority] = useState<TaskPriority | "">("");
  const [project, setProject] = useState("");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [sort, setSort] = useState<Sort>("due");
  const [showFilters, setShowFilters] = useState(false);

  const { data, loading, error, reload, refresh } = useAsync(async () => {
    const [tasks, dir, departments, projects] = await Promise.all([fetchTasks(), fetchDirectory(), fetchDepartments(), fetchProjectList()]);
    return { tasks, dir, names: nameMap(dir), departments, projects };
  }, []);

  const filtered = useMemo(() => {
    if (!data) return [];
    const q = query.trim().toLocaleLowerCase("tr-TR");
    const list = data.tasks.filter((t) => {
      if (scope === "mine" && !t.task_assignees.some((a) => a.user_id === uid)) return false;
      if (quick && !matchesQuick(t, quick)) return false;
      if (status && t.status !== status) return false;
      if (dept && t.department_id !== dept) return false;
      if (assignee && !t.task_assignees.some((a) => a.user_id === assignee)) return false;
      if (priority && t.priority !== priority) return false;
      if (project && (project === "none" ? t.project_id !== null : t.project_id !== project)) return false;
      if (from && t.due_date < from) return false;
      if (to && t.due_date > to) return false;
      if (q && !(`${t.code} ${t.title} ${t.description}`.toLocaleLowerCase("tr-TR").includes(q))) return false;
      return true;
    });
    const cmp: Record<Sort, (a: TaskWithRelations, b: TaskWithRelations) => number> = {
      due: (a, b) => a.due_date.localeCompare(b.due_date),
      priority: (a, b) => PRIORITY_RANK[a.priority] - PRIORITY_RANK[b.priority] || a.due_date.localeCompare(b.due_date),
      created: (a, b) => b.created_at.localeCompare(a.created_at),
      code: (a, b) => a.code.localeCompare(b.code, "tr"),
      progress: (a, b) => a.progress - b.progress,
    };
    return [...list].sort(cmp[sort]);
  }, [data, scope, quick, status, dept, assignee, priority, project, from, to, query, sort, uid]);

  const activeFilters = [status, dept, assignee, priority, project, from, to].filter(Boolean).length;

  function changeView(v: View) {
    setView(v);
    try { localStorage.setItem("amc.taskView", v); } catch { /* özel pencere */ }
  }
  function clearFilters() {
    setStatus(""); setDept(""); setAssignee(""); setPriority(""); setProject(""); setFrom(""); setTo("");
    if (quick) setParams({}, { replace: true });
  }
  const canManage = (t: TaskWithRelations) => canManageDepartment(t.department_id);
  const projectName = (id: string | null) => (id ? data?.projects.find((p) => p.id === id)?.code ?? "" : "");

  return (
    <>
      <PageHeader
        title="Görevler"
        description={isAdmin ? "Tüm departmanların görevleri ve size atanan görevler." : isManager ? "Sorumlu olduğunuz departmanların görevleri ve size atanan görevler." : "Size atanan görevler ve departmanınızın görevleri."}
        actions={isManager && <Link to="/yonetim/gorev-olustur" className="btn-primary"><Plus className="size-4" /> Görev oluştur</Link>}
      />

      <div className="mb-3 flex flex-col gap-3 lg:flex-row lg:items-center">
        <Segmented label="Görev kapsamı" value={scope} onChange={setScope}
          options={[["mine", "Bana atananlar"], ["all", isAdmin ? "Tüm görevler" : "Departman görevleri"]] as const} />
        <div className="relative flex-1">
          <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted" />
          <input className="input pl-9" placeholder="Görev kodu, başlık veya açıklama ara…" value={query} onChange={(e) => setQuery(e.target.value)} aria-label="Görev ara" />
        </div>
        <div className="flex items-center gap-2">
          <select className="input w-auto min-w-0 flex-1 lg:w-44" value={sort} onChange={(e) => setSort(e.target.value as Sort)} aria-label="Sıralama">
            <option value="due">Teslim tarihine göre</option>
            <option value="priority">Önceliğe göre</option>
            <option value="progress">İlerlemeye göre</option>
            <option value="created">En yeni önce</option>
            <option value="code">Görev koduna göre</option>
          </select>
          <button className={`btn-secondary shrink-0 px-3 ${showFilters || activeFilters ? "ring-1 ring-accent/60" : ""}`} onClick={() => setShowFilters((s) => !s)} aria-expanded={showFilters} aria-controls="task-filters">
            <SlidersHorizontal className="size-4" /> <span className="hidden sm:inline">Filtreler</span>{activeFilters > 0 && <span className="rounded-full bg-accent px-1.5 text-[11px] text-on-accent tabular-nums">{activeFilters}</span>}
          </button>
          <div className="inline-flex shrink-0 rounded-lg bg-surface p-1">
            <button onClick={() => changeView("cards")} aria-label="Kart görünümü" aria-pressed={view === "cards"} title="Liste (kart)"
              className={`rounded-md p-2 ${view === "cards" ? "bg-ink/10 text-ink" : "text-muted hover:text-ink"}`}><LayoutGrid className="size-4" /></button>
            <button onClick={() => changeView("list")} aria-label="Liste görünümü" aria-pressed={view === "list"} title="Tablo"
              className={`rounded-md p-2 ${view === "list" ? "bg-ink/10 text-ink" : "text-muted hover:text-ink"}`}><List className="size-4" /></button>
            <button onClick={() => changeView("board")} aria-label="Kanban görünümü" aria-pressed={view === "board"} title="Kanban"
              className={`rounded-md p-2 ${view === "board" ? "bg-ink/10 text-ink" : "text-muted hover:text-ink"}`}><KanbanSquare className="size-4" /></button>
          </div>
        </div>
      </div>

      {showFilters && data && (
        <div id="task-filters" className="card mb-3 grid animate-fade-in gap-3 p-4 sm:grid-cols-2 lg:grid-cols-4">
          <label className="block"><span className="label">Durum</span>
            <select className="input" value={status} onChange={(e) => setStatus(e.target.value as TaskStatus | "")} aria-label="Duruma göre filtrele">
              <option value="">Tüm durumlar</option>
              {TASK_STATUSES.map((s) => <option key={s} value={s}>{TASK_STATUS_META[s].label}</option>)}
            </select></label>
          <label className="block"><span className="label">Departman</span>
            <select className="input" value={dept} onChange={(e) => setDept(e.target.value)} aria-label="Departmana göre filtrele">
              <option value="">Tüm departmanlar</option>
              {data.departments.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
            </select></label>
          <label className="block"><span className="label">Sorumlu</span>
            <select className="input" value={assignee} onChange={(e) => setAssignee(e.target.value)} aria-label="Sorumluya göre filtrele">
              <option value="">Herkes</option>
              {data.dir.filter((d) => d.is_active).map((d) => <option key={d.id} value={d.id}>{fullName(d)}</option>)}
            </select></label>
          <label className="block"><span className="label">Öncelik</span>
            <select className="input" value={priority} onChange={(e) => setPriority(e.target.value as TaskPriority | "")} aria-label="Önceliğe göre filtrele">
              <option value="">Tüm öncelikler</option>
              {PRIORITIES.map((p) => <option key={p} value={p}>{PRIORITY_META[p].label}</option>)}
            </select></label>
          <label className="block"><span className="label">Proje</span>
            <select className="input" value={project} onChange={(e) => setProject(e.target.value)} aria-label="Projeye göre filtrele">
              <option value="">Tüm projeler</option>
              <option value="none">Projesiz görevler</option>
              {data.projects.map((p) => <option key={p.id} value={p.id}>{p.code} — {p.name}</option>)}
            </select></label>
          <label className="block"><span className="label">Teslim (en erken)</span>
            <input type="date" className="input" value={from} onChange={(e) => setFrom(e.target.value)} aria-label="Teslim tarihi en erken" /></label>
          <label className="block"><span className="label">Teslim (en geç)</span>
            <input type="date" className="input" value={to} min={from || undefined} onChange={(e) => setTo(e.target.value)} aria-label="Teslim tarihi en geç" /></label>
          <div className="flex items-end">
            <button className="btn-ghost w-full" onClick={clearFilters} disabled={!activeFilters && !quick}><X className="size-4" /> Filtreleri temizle</button>
          </div>
        </div>
      )}

      {(quick || activeFilters > 0) && data && (
        <div className="mb-3 flex flex-wrap items-center gap-2 text-sm text-muted">
          {quick && QUICK_LABEL[quick as Exclude<Quick, "">] && (
            <button onClick={() => setParams({}, { replace: true })} className="inline-flex min-h-8 items-center gap-1.5 rounded-full bg-accent/15 px-3 text-xs font-medium text-accent-2 hover:bg-accent/25">
              {QUICK_LABEL[quick as Exclude<Quick, "">]} <X className="size-3.5" aria-label="Hızlı filtreyi kaldır" />
            </button>
          )}
          <span className="tabular-nums">{filtered.length} görev</span>
        </div>
      )}

      {loading && !data ? <LoadingState variant="list" /> : error || !data ? <ErrorState message={error ?? ""} onRetry={reload} /> : filtered.length === 0 ? (
        <EmptyState icon={<ClipboardList className="size-6" />}
          title={data.tasks.length === 0 ? "Henüz görev yok" : "Filtrelere uyan görev bulunamadı"}
          description={data.tasks.length === 0 ? (isManager ? "İlk görevi oluşturup ekip üyelerine atayın." : "Size bir görev atandığında burada listelenecek.") : "Arama metnini veya filtreleri değiştirmeyi deneyin."}
          action={data.tasks.length === 0 && isManager ? <Link to="/yonetim/gorev-olustur" className="btn-primary"><Plus className="size-4" /> Görev oluştur</Link>
            : (activeFilters || quick) ? <button className="btn-secondary" onClick={clearFilters}>Filtreleri temizle</button> : undefined} />
      ) : view === "board" ? (
        <Board tasks={filtered} names={data.names} canManage={canManage} onMoved={refresh} />
      ) : view === "cards" ? (
        <div className="stagger grid gap-3 sm:grid-cols-2 xl:grid-cols-3" data-testid="task-cards">
          {filtered.map((t, i) => (
            <article key={t.id} className="card card-link relative flex flex-col gap-3 p-4" style={{ "--i": i } as CSSProperties} data-testid="task-item">
              <div className="flex items-start justify-between gap-2">
                <span className="code-tag">{t.code}{t.parent_id && <GitBranch className="ml-1 inline size-3 text-faint" aria-label="alt görev" />}</span>
                <TaskStatusBadge status={t.status} />
              </div>
              <FlightTrack status={t.status} />
              <h2 className="line-clamp-2 font-medium leading-snug"><Link to={`/gorevler/${t.id}`} className="after:absolute after:inset-0 after:rounded-2xl">{t.title}</Link></h2>
              <p className="line-clamp-2 min-h-8 text-xs text-muted">{t.status === "BLOCKED" && t.blocked_reason ? `Bloke: ${t.blocked_reason}` : t.description || "Açıklama girilmemiş."}</p>
              <ProgressCell t={t} />
              <div className="mt-auto flex flex-wrap items-center gap-x-3 gap-y-2 border-t border-line-soft pt-3">
                <PriorityBadge priority={t.priority} />
                <TCountdown dueDate={t.due_date} status={t.status} />
                <span className="ml-auto truncate text-xs text-muted">{t.department?.name}{t.project_id ? ` · ${projectName(t.project_id)}` : ""}</span>
              </div>
              <div className="-my-1 flex min-h-10 items-center justify-between gap-2">
                <p className="flex min-w-0 items-center gap-1.5 truncate text-xs text-muted"><Users className="size-3.5 shrink-0" />{assigneeNames(t, data.names)}</p>
                {canManage(t) && <AdminActions task={t} />}
              </div>
            </article>
          ))}
        </div>
      ) : (
        <div className="card overflow-hidden" data-testid="task-list">
          {/* Mobil: satırlar kart gibi yığılır; masaüstü: tablo */}
          <div className="hidden overflow-x-auto md:block">
            <table className="w-full">
              <thead className="border-b border-line-soft">
                <tr><th className="th">Kod</th><th className="th">Görev</th><th className="th">Departman</th><th className="th">Sorumlu</th><th className="th">Öncelik</th><th className="th">İlerleme</th><th className="th">Teslim</th><th className="th">Durum</th>{isManager && <th className="th text-right">İşlem</th>}</tr>
              </thead>
              <tbody className="divide-y divide-line-soft">
                {filtered.map((t) => (
                  <tr key={t.id} className="transition-colors hover:bg-ink/[0.04]" data-testid="task-item">
                    <td className="td whitespace-nowrap"><Link to={`/gorevler/${t.id}`} className="code-tag hover:underline">{t.code}</Link></td>
                    <td className="td max-w-xs"><Link to={`/gorevler/${t.id}`} className="line-clamp-1 hover:text-accent-2">{t.title}</Link></td>
                    <td className="td whitespace-nowrap text-muted">{t.department?.name}</td>
                    <td className="td text-muted">{assigneeNames(t, data.names)}</td>
                    <td className="td"><PriorityBadge priority={t.priority} /></td>
                    <td className="td"><ProgressCell t={t} /></td>
                    <td className="td whitespace-nowrap"><TCountdown dueDate={t.due_date} status={t.status} /></td>
                    <td className="td"><TaskStatusBadge status={t.status} /></td>
                    {isManager && <td className="px-2 py-1"><span className="flex justify-end">{canManage(t) && <AdminActions task={t} />}</span></td>}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <ul className="divide-y divide-line-soft md:hidden">
            {filtered.map((t) => (
              <li key={t.id} className="relative space-y-2 p-4" data-testid="task-item">
                <div className="flex items-center justify-between gap-2"><span className="code-tag">{t.code}</span><TaskStatusBadge status={t.status} /></div>
                <p className="text-sm font-medium"><Link to={`/gorevler/${t.id}`} className="after:absolute after:inset-0">{t.title}</Link></p>
                <ProgressCell t={t} />
                <div className="flex min-h-10 items-center justify-between gap-3">
                  <span className="flex flex-wrap items-center gap-3"><PriorityBadge priority={t.priority} /><TCountdown dueDate={t.due_date} status={t.status} /></span>
                  {canManage(t) && <AdminActions task={t} />}
                </div>
              </li>
            ))}
          </ul>
        </div>
      )}
    </>
  );
}
