import { useMemo, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { Plus, Search, ShieldAlert, X } from "lucide-react";
import { useAsync } from "../lib/useAsync";
import { fetchDepartments, fetchDirectory, fetchProjectList, fetchRisks, nameMap } from "../lib/api";
import { RISK_STATUSES, RISK_STATUS_META } from "../lib/constants";
import { daysUntil, formatDate, fullName } from "../lib/format";
import type { RiskStatus } from "../lib/types";
import RiskMatrix from "../components/RiskMatrix";
import RiskForm from "../components/RiskForm";
import { Card, EmptyState, ErrorState, LoadingState, PageHeader, RiskScore, RiskStatusBadge, SectionTitle } from "../components/ui";

export default function Risks() {
  const navigate = useNavigate();
  const [cell, setCell] = useState<{ p: number; i: number } | null>(null);
  const [status, setStatus] = useState<RiskStatus | "" | "active">("active");
  const [dept, setDept] = useState("");
  const [project, setProject] = useState("");
  const [q, setQ] = useState("");
  const [creating, setCreating] = useState(false);

  const { data, loading, error, reload } = useAsync(async () => {
    const [risks, departments, projects, dir] = await Promise.all([fetchRisks(), fetchDepartments(), fetchProjectList(), fetchDirectory()]);
    return { risks, departments, projects, dir, names: nameMap(dir) };
  }, []);

  const list = useMemo(() => {
    if (!data) return [];
    const term = q.trim().toLocaleLowerCase("tr-TR");
    return data.risks.filter((r) => {
      if (status === "active" ? r.status === "CLOSED" : status && r.status !== status) return false;
      if (cell && (r.probability !== cell.p || r.impact !== cell.i)) return false;
      if (dept && r.department_id !== dept) return false;
      if (project && r.project_id !== project) return false;
      if (term && !`${r.code} ${r.title} ${r.description}`.toLocaleLowerCase("tr-TR").includes(term)) return false;
      return true;
    });
  }, [data, status, cell, dept, project, q]);

  const stats = useMemo(() => {
    const open = (data?.risks ?? []).filter((r) => r.status !== "CLOSED");
    return {
      open: open.length,
      critical: open.filter((r) => r.score >= 15).length,
      stale: open.filter((r) => daysUntil(r.last_reviewed_at) < -30).length,
      unowned: open.filter((r) => !r.owner_id).length,
    };
  }, [data]);

  return (
    <>
      <PageHeader title="Risk Yönetimi" description="Puan = olasılık × etki. 15 ve üzeri kritiktir."
        actions={<button className="btn-primary" onClick={() => setCreating(true)}><Plus className="size-4" /> Risk kaydet</button>} />

      {loading && !data ? <LoadingState /> : error || !data ? <ErrorState message={error ?? ""} onRetry={reload} /> : (
        <>
          <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.1fr)]">
            <Card className="p-5">
              <SectionTitle aside={cell && <button className="inline-flex items-center gap-1 text-xs text-accent-2 hover:underline" onClick={() => setCell(null)}><X className="size-3.5" /> Seçimi kaldır</button>}>Risk matrisi (açık riskler)</SectionTitle>
              <RiskMatrix risks={data.risks} selected={cell} onSelect={setCell} />
            </Card>
            <Card className="grid grid-cols-2 content-start gap-4 p-5">
              {[
                ["Açık risk", stats.open, ""], ["Kritik (≥15)", stats.critical, stats.critical ? "text-danger" : ""],
                ["30 günden uzun süredir değerlendirilmemiş", stats.stale, stats.stale ? "text-warning" : ""], ["Sorumlusu atanmamış", stats.unowned, stats.unowned ? "text-warning" : ""],
              ].map(([label, value, cls]) => (
                <div key={label as string}>
                  <p className="min-h-[2.5em] text-[13px] leading-tight text-muted">{label}</p>
                  <p className={`num text-[34px] font-semibold leading-none ${cls}`}>{value}</p>
                </div>
              ))}
              <p className="col-span-2 rounded-lg bg-surface px-3 py-2 text-xs text-muted">Puan bandı: 1–4 düşük, 5–9 orta, 10–14 yüksek, 15–25 kritik. Kritik risklerde önleyici faaliyet ve B planı zorunludur.</p>
            </Card>
          </div>

          <div className="mt-4 mb-3 grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
            <div className="relative sm:col-span-2 lg:col-span-1">
              <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted" />
              <input className="input pl-9" placeholder="Risk ara…" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Risk ara" />
            </div>
            <select className="input" value={status} onChange={(e) => setStatus(e.target.value as RiskStatus | "" | "active")} aria-label="Risk durumu">
              <option value="active">Kapanmamış riskler</option><option value="">Tüm durumlar</option>
              {RISK_STATUSES.map((s) => <option key={s} value={s}>{RISK_STATUS_META[s].label}</option>)}
            </select>
            <select className="input" value={dept} onChange={(e) => setDept(e.target.value)} aria-label="Departman">
              <option value="">Tüm departmanlar</option>{data.departments.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
            </select>
            <select className="input" value={project} onChange={(e) => setProject(e.target.value)} aria-label="Proje">
              <option value="">Tüm projeler</option>{data.projects.map((p) => <option key={p.id} value={p.id}>{p.code} — {p.name}</option>)}
            </select>
          </div>

          {list.length === 0 ? (
            <EmptyState icon={<ShieldAlert className="size-6" />} title={data.risks.length === 0 ? "Henüz risk kaydı yok" : "Filtrelere uyan risk yok"}
              description={data.risks.length === 0 ? "İlk riski kaydedin." : "Matris seçimini veya filtreleri değiştirin."}
              action={<button className="btn-primary" onClick={() => setCreating(true)}><Plus className="size-4" /> Risk kaydet</button>} />
          ) : (
            <div className="card overflow-hidden" data-testid="risk-list">
              <div className="hidden overflow-x-auto md:block">
                <table className="w-full">
                  <thead className="border-b border-line-soft"><tr>
                    <th className="th">Risk</th><th className="th">Puan</th><th className="th">O × E</th><th className="th">Sorumlu</th><th className="th">Son değerlendirme</th><th className="th">Durum</th>
                  </tr></thead>
                  <tbody className="divide-y divide-line-soft">
                    {list.map((r) => (
                      <tr key={r.id} className="cursor-pointer transition-colors hover:bg-ink/[0.04]" onClick={() => navigate(`/riskler/${r.id}`)} data-testid="risk-row">
                        <td className="td max-w-md"><Link to={`/riskler/${r.id}`} className="block truncate hover:text-accent-2" onClick={(e) => e.stopPropagation()}>{r.title}</Link><span className="code-tag">{r.code}</span></td>
                        <td className="td"><RiskScore score={r.score} /></td>
                        <td className="td font-mono text-xs text-muted">{r.probability} × {r.impact}</td>
                        <td className="td whitespace-nowrap text-muted">{r.owner_id ? fullName(data.names.get(r.owner_id)) : <span className="text-warning">Atanmadı</span>}</td>
                        <td className={`td whitespace-nowrap ${r.status !== "CLOSED" && daysUntil(r.last_reviewed_at) < -30 ? "text-warning" : "text-muted"}`}>{formatDate(r.last_reviewed_at)}</td>
                        <td className="td"><RiskStatusBadge status={r.status} /></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <ul className="divide-y divide-line-soft md:hidden">
                {list.map((r) => (
                  <li key={r.id} className="relative space-y-1.5 p-4" data-testid="risk-row">
                    <div className="flex items-center justify-between gap-2"><span className="code-tag">{r.code}</span><RiskScore score={r.score} /></div>
                    <p className="text-sm font-medium"><Link to={`/riskler/${r.id}`} className="after:absolute after:inset-0">{r.title}</Link></p>
                    <div className="flex items-center justify-between text-xs text-muted"><span>O{r.probability} × E{r.impact} · {r.owner_id ? fullName(data.names.get(r.owner_id)) : "sorumlu yok"}</span><RiskStatusBadge status={r.status} /></div>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </>
      )}

      {creating && data && <RiskForm risk={null} departments={data.departments} projects={data.projects} people={data.dir}
        onClose={() => setCreating(false)} onSaved={(id) => { setCreating(false); navigate(`/riskler/${id}`); }} />}
    </>
  );
}
