import { useMemo, useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { Library, Lock, Plus, Search } from "lucide-react";
import { useAuth } from "../context/AuthContext";
import { useAsync } from "../lib/useAsync";
import { fetchDepartments, fetchDirectory, fetchDocuments, fetchMaxFileSizeMb, fetchProjectList, fetchTasks, nameMap } from "../lib/api";
import { DOCUMENT_CATEGORIES, DOCUMENT_CATEGORY_LABEL, DOCUMENT_STATUS_META } from "../lib/constants";
import { formatDate, fullName } from "../lib/format";
import type { DocumentCategory, DocumentStatus } from "../lib/types";
import { NewDocumentModal } from "../components/DocumentUpload";
import { DocumentStatusBadge, EmptyState, ErrorState, LoadingState, PageHeader, Segmented } from "../components/ui";

type Scope = "all" | "pending" | "mine";

export default function Documents() {
  const { profile, canManageDepartment } = useAuth();
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const presetTask = params.get("gorev");
  const [scope, setScope] = useState<Scope>("all");
  const [q, setQ] = useState("");
  const [category, setCategory] = useState<DocumentCategory | "">("");
  const [dept, setDept] = useState("");
  const [project, setProject] = useState(params.get("proje") ?? "");
  const [status, setStatus] = useState<DocumentStatus | "">("");
  const [creating, setCreating] = useState(params.get("yeni") === "1");

  const { data, loading, error, reload } = useAsync(async () => {
    const [docs, departments, projects, tasks, dir, maxMb] = await Promise.all([
      fetchDocuments(), fetchDepartments(), fetchProjectList(), fetchTasks(), fetchDirectory(), fetchMaxFileSizeMb(),
    ]);
    return { docs, departments, projects, tasks, names: nameMap(dir), maxMb };
  }, []);

  const list = useMemo(() => {
    if (!data) return [];
    const term = q.trim().toLocaleLowerCase("tr-TR");
    return data.docs.filter((d) => {
      if (scope === "mine" && d.created_by !== profile?.id) return false;
      if (scope === "pending" && !(d.status === "PENDING" && canManageDepartment(d.department_id))) return false;
      if (category && d.category !== category) return false;
      if (dept && d.department_id !== dept) return false;
      if (project && d.project_id !== project) return false;
      if (status && d.status !== status) return false;
      if (term && !`${d.code} ${d.title} ${d.description}`.toLocaleLowerCase("tr-TR").includes(term)) return false;
      return true;
    });
  }, [data, scope, q, category, dept, project, status, profile?.id, canManageDepartment]);

  const deptName = (id: string | null) => (id ? data?.departments.find((d) => d.id === id)?.name ?? "—" : "Departmanlar arası");
  const pendingCount = (data?.docs ?? []).filter((d) => d.status === "PENDING" && canManageDepartment(d.department_id)).length;

  return (
    <>
      <PageHeader title="Doküman Merkezi" description="Teknik raporlar, CAD (STL, STEP), analiz ve test dosyaları."
        actions={<button className="btn-primary" onClick={() => setCreating(true)}><Plus className="size-4" /> Doküman yükle</button>} />
      <div className="mb-3 flex flex-col gap-3 lg:flex-row lg:items-center">
        <Segmented label="Doküman kapsamı" value={scope} onChange={setScope}
          options={[["all", "Tümü"], ["pending", `Onayımı bekleyen${pendingCount ? ` (${pendingCount})` : ""}`], ["mine", "Yüklediklerim"]] as const} />
        <div className="relative flex-1">
          <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted" />
          <input className="input pl-9" placeholder="Kod, başlık veya açıklama ara…" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Doküman ara" />
        </div>
      </div>
      {data && (
        <div className="mb-4 grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
          <select className="input" value={category} onChange={(e) => setCategory(e.target.value as DocumentCategory | "")} aria-label="Kategori">
            <option value="">Tüm kategoriler</option>{DOCUMENT_CATEGORIES.map((c) => <option key={c} value={c}>{DOCUMENT_CATEGORY_LABEL[c]}</option>)}</select>
          <select className="input" value={dept} onChange={(e) => setDept(e.target.value)} aria-label="Departman">
            <option value="">Tüm departmanlar</option>{data.departments.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}</select>
          <select className="input" value={project} onChange={(e) => { setProject(e.target.value); if (params.get("proje")) setParams({}, { replace: true }); }} aria-label="Proje">
            <option value="">Tüm projeler</option>{data.projects.map((p) => <option key={p.id} value={p.id}>{p.code} — {p.name}</option>)}</select>
          <select className="input" value={status} onChange={(e) => setStatus(e.target.value as DocumentStatus | "")} aria-label="Onay durumu">
            <option value="">Tüm durumlar</option>{(Object.keys(DOCUMENT_STATUS_META) as DocumentStatus[]).map((s) => <option key={s} value={s}>{DOCUMENT_STATUS_META[s].label}</option>)}</select>
        </div>
      )}

      {loading && !data ? <LoadingState variant="list" /> : error || !data ? <ErrorState message={error ?? ""} onRetry={reload} /> : list.length === 0 ? (
        <EmptyState icon={<Library className="size-6" />} title={data.docs.length === 0 ? "Henüz doküman yok" : "Filtrelere uyan doküman yok"}
          description={data.docs.length === 0 ? "İlk dokümanı yükleyin." : "Arama metnini veya filtreleri değiştirin."}
          action={<button className="btn-primary" onClick={() => setCreating(true)}><Plus className="size-4" /> Doküman yükle</button>} />
      ) : (
        <div className="card overflow-hidden" data-testid="document-list">
          <div className="hidden overflow-x-auto md:block">
            <table className="w-full">
              <thead className="border-b border-line-soft"><tr>
                <th className="th">Doküman</th><th className="th">Kategori</th><th className="th">Departman</th><th className="th">Sürüm</th><th className="th">Yükleyen</th><th className="th">Güncelleme</th><th className="th">Durum</th>
              </tr></thead>
              <tbody className="divide-y divide-line-soft">
                {list.map((d) => (
                  <tr key={d.id} className="cursor-pointer transition-colors hover:bg-ink/[0.04]" onClick={() => navigate(`/dokumanlar/${d.id}`)} data-testid="document-row">
                    <td className="td max-w-sm">
                      <Link to={`/dokumanlar/${d.id}`} className="block truncate hover:text-accent-2" onClick={(e) => e.stopPropagation()}>{d.title}</Link>
                      <span className="flex items-center gap-1.5 text-xs text-muted"><span className="code-tag">{d.code}</span>{d.is_restricted && <Lock className="size-3" aria-label="Kısıtlı erişim" />}</span>
                    </td>
                    <td className="td whitespace-nowrap text-muted">{DOCUMENT_CATEGORY_LABEL[d.category]}</td>
                    <td className="td whitespace-nowrap text-muted">{deptName(d.department_id)}</td>
                    <td className="td font-mono text-xs">V{d.current_version}</td>
                    <td className="td whitespace-nowrap text-muted">{d.created_by ? fullName(data.names.get(d.created_by)) : "—"}</td>
                    <td className="td whitespace-nowrap text-muted">{formatDate(d.updated_at)}</td>
                    <td className="td"><DocumentStatusBadge status={d.status} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <ul className="divide-y divide-line-soft md:hidden">
            {list.map((d) => (
              <li key={d.id} className="relative p-4" data-testid="document-row">
                <div className="flex items-center justify-between gap-2"><span className="code-tag">{d.code}</span><DocumentStatusBadge status={d.status} /></div>
                <p className="mt-1 text-sm font-medium"><Link to={`/dokumanlar/${d.id}`} className="after:absolute after:inset-0">{d.title}</Link></p>
                <p className="mt-1 text-xs text-muted">{DOCUMENT_CATEGORY_LABEL[d.category]} · {deptName(d.department_id)} · V{d.current_version}{d.is_restricted ? " · kısıtlı" : ""}</p>
              </li>
            ))}
          </ul>
        </div>
      )}

      {creating && data && (
        <NewDocumentModal departments={data.departments} projects={data.projects} tasks={data.tasks}
          presetTaskId={presetTask} presetProjectId={project || null} maxBytes={data.maxMb * 1048576}
          onClose={() => { setCreating(false); if (params.get("yeni")) setParams({}, { replace: true }); }}
          onCreated={(doc) => { setCreating(false); navigate(`/dokumanlar/${doc.id}`); }} />
      )}
    </>
  );
}
