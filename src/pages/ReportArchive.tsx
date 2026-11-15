import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { Archive, ArrowDownUp, FilterX, Search } from "lucide-react";
import { supabase } from "../lib/supabase";
import { useAuth } from "../context/AuthContext";
import { unwrap, useAsync } from "../lib/useAsync";
import { fetchDepartments, fetchDirectory } from "../lib/api";
import { REPORT_STATUS_META, REPORT_STATUSES } from "../lib/constants";
import { ALLOWED_EXTENSIONS } from "../lib/files";
import { formatBytes, formatDateTime, fullName } from "../lib/format";
import type { ReportOverview, ReportStatus } from "../lib/types";
import { EmptyState, ErrorState, LoadingState, PageHeader, ReportStatusBadge } from "../components/ui";

const PAGE_SIZE = 25;

interface Filters {
  q: string; code: string; department: string; uploader: string; status: ReportStatus | "";
  ext: string; from: string; to: string;
}
const EMPTY: Filters = { q: "", code: "", department: "", uploader: "", status: "", ext: "", from: "", to: "" };

function useDebounced<T>(value: T, ms: number): T {
  const [v, setV] = useState(value);
  useEffect(() => {
    const t = window.setTimeout(() => setV(value), ms);
    return () => window.clearTimeout(t);
  }, [value, ms]);
  return v;
}

/** PostgREST ilike kalıbındaki özel karakterleri etkisizleştirir. */
function like(s: string): string {
  return `%${s.trim().replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
}

export default function ReportArchive() {
  const { isAdmin } = useAuth();
  const [filters, setFilters] = useState<Filters>(EMPTY);
  const [asc, setAsc] = useState(false);
  const [page, setPage] = useState(0);
  const debounced = useDebounced(filters, 300);
  const set = (patch: Partial<Filters>) => { setFilters((f) => ({ ...f, ...patch })); setPage(0); };

  const meta = useAsync(async () => {
    const [departments, directory] = await Promise.all([fetchDepartments(), isAdmin ? fetchDirectory() : Promise.resolve([])]);
    return { departments, directory };
  }, [isAdmin]);

  // Tüm filtreler sunucuda uygulanır; RLS üyeye yalnızca kendi raporlarını döndürür.
  const result = useAsync(async () => {
    let q = supabase.from("report_overview").select("*", { count: "exact" });
    if (debounced.q.trim()) q = q.ilike("title", like(debounced.q));
    if (debounced.code.trim()) q = q.ilike("task_code", like(debounced.code));
    if (debounced.department) q = q.eq("department_id", debounced.department);
    if (debounced.uploader) q = q.eq("uploaded_by", debounced.uploader);
    if (debounced.status) q = q.eq("status", debounced.status);
    if (debounced.ext) q = q.contains("file_extensions", debounced.ext === "jpg" ? ["jpg"] : [debounced.ext]);
    if (debounced.from) q = q.gte("updated_at", new Date(`${debounced.from}T00:00:00`).toISOString());
    if (debounced.to) q = q.lte("updated_at", new Date(`${debounced.to}T23:59:59.999`).toISOString());
    const res = await q.order("updated_at", { ascending: asc }).range(page * PAGE_SIZE, page * PAGE_SIZE + PAGE_SIZE - 1);
    return { rows: unwrap(res) as ReportOverview[], count: res.count ?? 0 };
  }, [debounced, asc, page]);

  const active = Object.values(filters).some(Boolean);
  const rows = result.data?.rows ?? [];
  const total = result.data?.count ?? 0;
  const detailPath = (r: ReportOverview) => (isAdmin ? `/yonetim/rapor-inceleme/${r.id}` : `/raporlar/${r.id}`);

  return (
    <>
      <PageHeader title="Rapor Arşivi" description={isAdmin ? "Tüm departmanların raporları." : "Yüklediğiniz raporlar ve inceleme durumları."} />

      <div className="card mb-4 grid gap-3 p-4 sm:grid-cols-2 lg:grid-cols-4">
        <div className="relative sm:col-span-2">
          <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted" />
          <input className="input pl-9" placeholder="Rapor başlığında ara…" value={filters.q} onChange={(e) => set({ q: e.target.value })} aria-label="Rapor başlığı" />
        </div>
        <input className="input font-mono" placeholder="Görev kodu (AK-MEK-001)" value={filters.code} onChange={(e) => set({ code: e.target.value })} aria-label="Görev kodu" />
        <select className="input" value={filters.status} onChange={(e) => set({ status: e.target.value as ReportStatus | "" })} aria-label="Rapor durumu">
          <option value="">Tüm durumlar</option>
          {REPORT_STATUSES.map((s) => <option key={s} value={s}>{REPORT_STATUS_META[s].label}</option>)}
        </select>
        <select className="input" value={filters.department} onChange={(e) => set({ department: e.target.value })} aria-label="Departman">
          <option value="">Tüm departmanlar</option>
          {meta.data?.departments.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
        </select>
        {isAdmin && (
          <select className="input" value={filters.uploader} onChange={(e) => set({ uploader: e.target.value })} aria-label="Yükleyen kişi">
            <option value="">Tüm yükleyenler</option>
            {meta.data?.directory.map((p) => <option key={p.id} value={p.id}>{fullName(p)}</option>)}
          </select>
        )}
        <select className="input" value={filters.ext} onChange={(e) => set({ ext: e.target.value })} aria-label="Dosya formatı">
          <option value="">Tüm formatlar</option>
          {ALLOWED_EXTENSIONS.filter((x) => x !== "jpeg").map((x) => <option key={x} value={x}>{x.toUpperCase()}</option>)}
        </select>
        <div className="flex items-center gap-2 sm:col-span-2 lg:col-span-1">
          <input type="date" className="input" value={filters.from} max={filters.to || undefined} onChange={(e) => set({ from: e.target.value })} aria-label="Başlangıç tarihi" />
          <span className="text-muted">–</span>
          <input type="date" className="input" value={filters.to} min={filters.from || undefined} onChange={(e) => set({ to: e.target.value })} aria-label="Bitiş tarihi" />
        </div>
      </div>

      <div className="mb-3 flex items-center justify-between gap-3 text-sm">
        <span className="text-muted" data-testid="archive-count">{result.loading ? "Aranıyor…" : `${total} rapor`}</span>
        <div className="flex gap-2">
          {active && <button className="btn-ghost min-h-9" onClick={() => { setFilters(EMPTY); setPage(0); }}><FilterX className="size-4" /> Filtreleri temizle</button>}
          <button className="btn-secondary min-h-9" onClick={() => { setAsc((a) => !a); setPage(0); }}>
            <ArrowDownUp className="size-4" /> {asc ? "Eskiden yeniye" : "Yeniden eskiye"}
          </button>
        </div>
      </div>

      {result.loading && !result.data ? <LoadingState /> : result.error ? <ErrorState message={result.error} onRetry={result.reload} /> : rows.length === 0 ? (
        <EmptyState icon={<Archive className="size-6" />} title={active ? "Filtrelere uyan rapor bulunamadı" : "Arşivde henüz rapor yok"}
          description={active ? "Filtreleri değiştirmeyi veya temizlemeyi deneyin." : "Yüklenen raporlar burada listelenir."} />
      ) : (
        <div className={`card overflow-hidden ${result.loading ? "opacity-60" : ""}`}>
          <table className="hidden w-full md:table">
            <thead className="border-b border-line-soft">
              <tr><th className="th">Rapor</th><th className="th">Görev</th><th className="th">Departman</th>{isAdmin && <th className="th">Yükleyen</th>}<th className="th">Dosya</th><th className="th">Güncelleme</th><th className="th">Durum</th></tr>
            </thead>
            <tbody className="divide-y divide-line-soft">
              {rows.map((r) => (
                <tr key={r.id} className="transition-colors hover:bg-white/[0.03]" data-testid="archive-row">
                  <td className="td max-w-xs"><Link to={detailPath(r)} className="line-clamp-1 font-medium hover:text-accent-2">{r.title}</Link><span className="text-xs text-muted">V{r.current_version}</span></td>
                  <td className="td whitespace-nowrap"><Link to={`/gorevler/${r.task_id}`} className="code-tag hover:underline">{r.task_code}</Link></td>
                  <td className="td whitespace-nowrap text-muted">{r.department_name}</td>
                  {isAdmin && <td className="td whitespace-nowrap text-muted">{r.uploader_name || "—"}</td>}
                  <td className="td whitespace-nowrap text-xs text-muted">{r.file_extensions.join(", ").toUpperCase()} · {formatBytes(r.total_bytes)}</td>
                  <td className="td whitespace-nowrap text-muted">{formatDateTime(r.updated_at)}</td>
                  <td className="td"><ReportStatusBadge status={r.status} /></td>
                </tr>
              ))}
            </tbody>
          </table>
          <ul className="divide-y divide-line-soft md:hidden">
            {rows.map((r) => (
              <li key={r.id} data-testid="archive-row">
                <Link to={detailPath(r)} className="block space-y-1.5 p-4">
                  <div className="flex items-center justify-between gap-2"><span className="code-tag">{r.task_code}</span><ReportStatusBadge status={r.status} /></div>
                  <p className="text-sm font-medium">{r.title}</p>
                  <p className="text-xs text-muted">V{r.current_version} · {r.department_name}{isAdmin && r.uploader_name ? ` · ${r.uploader_name}` : ""}</p>
                  <p className="text-xs text-muted">{r.file_extensions.join(", ").toUpperCase()} · {formatDateTime(r.updated_at)}</p>
                </Link>
              </li>
            ))}
          </ul>
        </div>
      )}

      {total > PAGE_SIZE && (
        <div className="mt-4 flex items-center justify-between text-sm">
          <button className="btn-secondary" disabled={page === 0} onClick={() => setPage((p) => p - 1)}>Önceki</button>
          <span className="text-muted">Sayfa {page + 1} / {Math.ceil(total / PAGE_SIZE)}</span>
          <button className="btn-secondary" disabled={(page + 1) * PAGE_SIZE >= total} onClick={() => setPage((p) => p + 1)}>Sonraki</button>
        </div>
      )}
    </>
  );
}
