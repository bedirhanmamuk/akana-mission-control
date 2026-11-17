import { useMemo, useState } from "react";
import { GanttChart } from "lucide-react";
import { supabase } from "../lib/supabase";
import { unwrap, useAsync } from "../lib/useAsync";
import { fetchDepartments, fetchProjects, fetchTasks } from "../lib/api";
import { CLOSED_STATUSES } from "../lib/constants";
import Gantt, { GanttLegend, type GanttGroup, type GanttZoom } from "../components/Gantt";
import { EmptyState, ErrorState, LoadingState, PageHeader, Segmented } from "../components/ui";

type GroupBy = "project" | "department";

export default function Timeline() {
  const [zoom, setZoom] = useState<GanttZoom>("week");
  const [groupBy, setGroupBy] = useState<GroupBy>("project");
  const [project, setProject] = useState("");
  const [dept, setDept] = useState("");
  const [hideClosed, setHideClosed] = useState(true);

  const { data, loading, error, reload } = useAsync(async () => {
    const [tasks, projects, departments, deps] = await Promise.all([
      fetchTasks(), fetchProjects(), fetchDepartments(),
      supabase.from("task_dependencies").select("task_id,depends_on_id").then(unwrap<{ task_id: string; depends_on_id: string }[]>),
    ]);
    return { tasks, projects, departments, deps };
  }, []);

  const { groups, milestones } = useMemo(() => {
    if (!data) return { groups: [] as GanttGroup[], milestones: [] };
    const tasks = data.tasks
      .filter((t) => (!hideClosed || !CLOSED_STATUSES.includes(t.status)) && t.status !== "CANCELLED")
      .filter((t) => !project || t.project_id === project)
      .filter((t) => !dept || t.department_id === dept)
      .sort((a, b) => a.start_date.localeCompare(b.start_date) || a.due_date.localeCompare(b.due_date));
    let gs: GanttGroup[];
    if (groupBy === "project") {
      gs = data.projects.map((p) => ({ key: p.id, label: `${p.code} — ${p.name}`, tasks: tasks.filter((t) => t.project_id === p.id) }));
      gs.push({ key: "none", label: "Projesiz görevler", tasks: tasks.filter((t) => !t.project_id) });
    } else {
      gs = data.departments.map((d) => ({ key: d.id, label: d.name, tasks: tasks.filter((t) => t.department_id === d.id) }));
    }
    const ms = data.projects
      .filter((p) => (!project || p.id === project) && p.status !== "CANCELLED")
      .map((p) => ({ date: p.target_date, label: `${p.code} hedef teslim` }));
    return { groups: gs.filter((g) => g.tasks.length > 0), milestones: ms };
  }, [data, groupBy, project, dept, hideClosed]);

  return (
    <>
      <PageHeader title="Zaman Çizelgesi" description="Görevlerin süreleri, aralarındaki bağımlılıklar ve proje hedef tarihleri. Çubuğa tıklayarak göreve gidin." />
      <div className="mb-4 flex flex-col gap-3 lg:flex-row lg:flex-wrap lg:items-center">
        <Segmented label="Yakınlaştırma" value={zoom} onChange={setZoom} options={[["day", "Gün"], ["week", "Hafta"], ["month", "Ay"]] as const} />
        <Segmented label="Gruplama" value={groupBy} onChange={setGroupBy} options={[["project", "Projeye göre"], ["department", "Departmana göre"]] as const} />
        {data && (
          <div className="flex flex-1 flex-col gap-2 sm:flex-row">
            <select className="input sm:w-56" value={project} onChange={(e) => setProject(e.target.value)} aria-label="Proje filtresi">
              <option value="">Tüm projeler</option>
              {data.projects.map((p) => <option key={p.id} value={p.id}>{p.code} — {p.name}</option>)}
            </select>
            <select className="input sm:w-48" value={dept} onChange={(e) => setDept(e.target.value)} aria-label="Departman filtresi">
              <option value="">Tüm departmanlar</option>
              {data.departments.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
            </select>
            <label className="flex min-h-10 items-center gap-2 text-sm text-muted">
              <input type="checkbox" className="size-4" checked={hideClosed} onChange={(e) => setHideClosed(e.target.checked)} /> Kapanan görevleri gizle
            </label>
          </div>
        )}
      </div>
      {loading && !data ? <LoadingState /> : error || !data ? <ErrorState message={error ?? ""} onRetry={reload} /> : groups.length === 0 ? (
        <EmptyState icon={<GanttChart className="size-6" />} title="Gösterilecek görev yok" description="Filtreleri değiştirin veya görev oluşturun. Zaman çizelgesi erişiminiz olan görevleri gösterir." />
      ) : (
        <>
          <Gantt groups={groups} dependencies={data.deps} milestones={milestones} zoom={zoom} />
          <div className="mt-3"><GanttLegend /></div>
        </>
      )}
    </>
  );
}
