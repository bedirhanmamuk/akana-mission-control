import { useMemo, useState, type CSSProperties } from "react";
import { Link } from "react-router-dom";
import { ClipboardList, LayoutGrid, List, Plus, Search, Users } from "lucide-react";
import { useAuth } from "../context/AuthContext";
import { useAsync } from "../lib/useAsync";
import { fetchDirectory, fetchTasks, nameMap } from "../lib/api";
import { TASK_STATUS_META, TASK_STATUSES } from "../lib/constants";
import { fullName } from "../lib/format";
import TCountdown from "../components/TCountdown";
import { FlightTrack } from "../components/FlightProfile";
import type { DirectoryEntry, TaskStatus, TaskWithRelations } from "../lib/types";
import {
  EmptyState, ErrorState, LoadingState, PageHeader, PriorityBadge, TaskStatusBadge,
} from "../components/ui";

type Scope = "mine" | "all";
type View = "cards" | "list";

function assigneeNames(t: TaskWithRelations, names: Map<string, DirectoryEntry>): string {
  const list = t.task_assignees.map((a) => fullName(names.get(a.user_id)));
  if (list.length === 0) return "—";
  return list.length <= 2 ? list.join(", ") : `${list.slice(0, 2).join(", ")} +${list.length - 2}`;
}

function DueText({ task }: { task: TaskWithRelations }) {
  return <TCountdown dueDate={task.due_date} status={task.status} />;
}

export default function MyTasks() {
  const { profile, isAdmin } = useAuth();
  const uid = profile!.id;
  const [scope, setScope] = useState<Scope>(isAdmin ? "all" : "mine");
  const [view, setView] = useState<View>(() => (localStorage.getItem("amc.taskView") === "list" ? "list" : "cards"));
  const [status, setStatus] = useState<TaskStatus | "">("");
  const [query, setQuery] = useState("");

  const { data, loading, error, reload } = useAsync(async () => {
    const [tasks, dir] = await Promise.all([fetchTasks(), fetchDirectory()]);
    return { tasks, names: nameMap(dir) };
  }, []);

  const filtered = useMemo(() => {
    if (!data) return [];
    const q = query.trim().toLocaleLowerCase("tr-TR");
    return data.tasks.filter((t) => {
      if (scope === "mine" && !t.task_assignees.some((a) => a.user_id === uid)) return false;
      if (status && t.status !== status) return false;
      if (q && !(`${t.code} ${t.title}`.toLocaleLowerCase("tr-TR").includes(q))) return false;
      return true;
    });
  }, [data, scope, status, query, uid]);

  function changeView(v: View) {
    setView(v);
    localStorage.setItem("amc.taskView", v);
  }

  return (
    <>
      <PageHeader
        title="Görevlerim"
        description={isAdmin ? "Tüm departmanların görevleri ve size atanan görevler." : "Size atanan görevler ve departmanınızın görevleri."}
        actions={isAdmin && <Link to="/yonetim/gorev-olustur" className="btn-primary"><Plus className="size-4" /> Görev oluştur</Link>}
      />

      <div className="mb-4 flex flex-col gap-3 lg:flex-row lg:items-center">
        <div className="inline-flex self-start rounded-lg bg-surface p-1" role="tablist">
          {([["mine", "Bana atananlar"], ["all", isAdmin ? "Tüm görevler" : "Departman görevleri"]] as const).map(([k, label]) => (
            <button key={k} role="tab" aria-selected={scope === k} onClick={() => setScope(k)}
              className={`min-h-9 rounded-md px-3 text-sm transition-colors ${scope === k ? "bg-accent text-white" : "text-muted hover:text-ink"}`}>
              {label}
            </button>
          ))}
        </div>
        <div className="relative flex-1">
          <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted" />
          <input className="input pl-9" placeholder="Görev kodu veya başlığı ara…" value={query} onChange={(e) => setQuery(e.target.value)} aria-label="Görev ara" />
        </div>
        <select className="input lg:w-52" value={status} onChange={(e) => setStatus(e.target.value as TaskStatus | "")} aria-label="Duruma göre filtrele">
          <option value="">Tüm durumlar</option>
          {TASK_STATUSES.map((s) => <option key={s} value={s}>{TASK_STATUS_META[s].label}</option>)}
        </select>
        <div className="inline-flex self-start rounded-lg bg-surface p-1">
          <button onClick={() => changeView("cards")} aria-label="Kart görünümü" aria-pressed={view === "cards"}
            className={`rounded-md p-2 ${view === "cards" ? "bg-white/10 text-ink" : "text-muted hover:text-ink"}`}><LayoutGrid className="size-4" /></button>
          <button onClick={() => changeView("list")} aria-label="Liste görünümü" aria-pressed={view === "list"}
            className={`rounded-md p-2 ${view === "list" ? "bg-white/10 text-ink" : "text-muted hover:text-ink"}`}><List className="size-4" /></button>
        </div>
      </div>

      {loading ? <LoadingState /> : error || !data ? <ErrorState message={error ?? ""} onRetry={reload} /> : filtered.length === 0 ? (
        <EmptyState icon={<ClipboardList className="size-6" />}
          title={data.tasks.length === 0 ? "Henüz görev yok" : "Filtrelere uyan görev bulunamadı"}
          description={data.tasks.length === 0 ? "Size bir görev atandığında burada listelenecek." : "Arama metnini veya filtreleri değiştirmeyi deneyin."} />
      ) : view === "cards" ? (
        <div className="stagger grid gap-3 sm:grid-cols-2 xl:grid-cols-3" data-testid="task-cards">
          {filtered.map((t, i) => (
            <Link key={t.id} to={`/gorevler/${t.id}`} className="card card-link flex flex-col gap-3 p-4" style={{ "--i": i } as CSSProperties} data-testid="task-item">
              <div className="flex items-start justify-between gap-2">
                <span className="code-tag">{t.code}</span>
                <TaskStatusBadge status={t.status} />
              </div>
              <FlightTrack status={t.status} />
              <p className="line-clamp-2 font-medium leading-snug">{t.title}</p>
              <p className="line-clamp-2 min-h-8 text-xs text-muted">{t.description || "Açıklama girilmemiş."}</p>
              <div className="mt-auto flex flex-wrap items-center gap-x-3 gap-y-2 border-t border-line-soft pt-3">
                <PriorityBadge priority={t.priority} />
                <DueText task={t} />
                <span className="ml-auto text-xs text-muted">{t.department?.name}</span>
              </div>
              <p className="flex items-center gap-1.5 truncate text-xs text-muted"><Users className="size-3.5 shrink-0" />{assigneeNames(t, data.names)}</p>
            </Link>
          ))}
        </div>
      ) : (
        <div className="card overflow-hidden" data-testid="task-list">
          {/* Mobil: satırlar kart gibi yığılır; masaüstü: tablo */}
          <table className="hidden w-full md:table">
            <thead className="border-b border-line-soft">
              <tr><th className="th">Kod</th><th className="th">Görev</th><th className="th">Departman</th><th className="th">Sorumlu</th><th className="th">Öncelik</th><th className="th">Teslim</th><th className="th">Durum</th></tr>
            </thead>
            <tbody className="divide-y divide-line-soft">
              {filtered.map((t) => (
                <tr key={t.id} className="transition-colors hover:bg-white/[0.03]" data-testid="task-item">
                  <td className="td whitespace-nowrap"><Link to={`/gorevler/${t.id}`} className="code-tag hover:underline">{t.code}</Link></td>
                  <td className="td max-w-xs"><Link to={`/gorevler/${t.id}`} className="line-clamp-1 hover:text-accent-2">{t.title}</Link></td>
                  <td className="td whitespace-nowrap text-muted">{t.department?.name}</td>
                  <td className="td text-muted">{assigneeNames(t, data.names)}</td>
                  <td className="td"><PriorityBadge priority={t.priority} /></td>
                  <td className="td whitespace-nowrap"><DueText task={t} /></td>
                  <td className="td"><TaskStatusBadge status={t.status} /></td>
                </tr>
              ))}
            </tbody>
          </table>
          <ul className="divide-y divide-line-soft md:hidden">
            {filtered.map((t) => (
              <li key={t.id} data-testid="task-item">
                <Link to={`/gorevler/${t.id}`} className="block space-y-2 p-4">
                  <div className="flex items-center justify-between gap-2"><span className="code-tag">{t.code}</span><TaskStatusBadge status={t.status} /></div>
                  <p className="text-sm font-medium">{t.title}</p>
                  <div className="flex flex-wrap items-center gap-3"><PriorityBadge priority={t.priority} /><DueText task={t} /></div>
                </Link>
              </li>
            ))}
          </ul>
        </div>
      )}
    </>
  );
}
