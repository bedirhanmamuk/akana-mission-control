import { Link } from "react-router-dom";
import { Network } from "lucide-react";
import { useAsync } from "../lib/useAsync";
import { fetchDepartments, fetchDirectory } from "../lib/api";
import { fullName } from "../lib/format";
import type { DirectoryEntry } from "../lib/types";
import { Avatar, EmptyState, ErrorState, LoadingState, PageHeader } from "../components/ui";

function Person({ p, role, emphasis }: { p: DirectoryEntry; role: string; emphasis?: boolean }) {
  return (
    <Link to={`/ekip/${p.id}`} className={`card card-link flex items-center gap-3 px-3 py-2.5 ${emphasis ? "ring-1 ring-accent/50" : ""}`}>
      <Avatar person={p} size={emphasis ? 44 : 34} />
      <span className="min-w-0 text-left">
        <span className="block truncate text-sm font-medium">{fullName(p)}</span>
        <span className="block truncate text-xs text-accent-2">{role}</span>
      </span>
    </Link>
  );
}

/** Hiyerarşi: Kaptan → Kaptan yardımcısı → Departman sorumluları → Takım üyeleri */
export default function OrgChart() {
  const { data, loading, error, reload } = useAsync(async () => {
    const [dir, departments] = await Promise.all([fetchDirectory(), fetchDepartments()]);
    return { dir: dir.filter((d) => d.is_active), departments: departments.filter((d) => d.is_active) };
  }, []);

  if (loading && !data) return <><PageHeader title="Organizasyon Şeması" /><LoadingState /></>;
  if (error || !data) return <><PageHeader title="Organizasyon Şeması" /><ErrorState message={error ?? ""} onRetry={reload} /></>;

  const captains = data.dir.filter((p) => p.team_position === "CAPTAIN");
  const vices = data.dir.filter((p) => p.team_position === "VICE_CAPTAIN");
  const byId = new Map(data.dir.map((p) => [p.id, p]));

  return (
    <>
      <PageHeader title="Organizasyon Şeması" description="Pozisyonlar Üye Yönetimi'nden, departman sorumluları Yönetim Paneli'nden atanır." />
      {data.dir.length === 0 ? <EmptyState icon={<Network className="size-6" />} title="Ekip boş" /> : (
        <div className="flex flex-col items-center gap-0" data-testid="org-chart">
          <div className="flex flex-wrap justify-center gap-3">
            {captains.length ? captains.map((p) => <Person key={p.id} p={p} role="Takım Kaptanı" emphasis />)
              : <p className="rounded-xl border border-dashed border-line px-4 py-3 text-sm text-muted">Takım kaptanı atanmadı</p>}
          </div>
          <div className="h-6 w-px bg-line" aria-hidden />
          <div className="flex flex-wrap justify-center gap-3">
            {vices.length ? vices.map((p) => <Person key={p.id} p={p} role={p.title || "Kaptan Yardımcısı"} emphasis />)
              : <p className="rounded-xl border border-dashed border-line px-4 py-3 text-sm text-muted">Kaptan yardımcısı atanmadı</p>}
          </div>
          <div className="h-6 w-px bg-line" aria-hidden />
          <div className="w-full border-t border-line pt-6">
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
              {data.departments.map((d) => {
                const lead = d.lead_id ? byId.get(d.lead_id) : undefined;
                const members = data.dir.filter((p) => p.department_id === d.id && p.id !== d.lead_id && p.team_position !== "CAPTAIN" && p.team_position !== "VICE_CAPTAIN");
                return (
                  <section key={d.id} className="rounded-2xl bg-surface/70 p-3" aria-label={d.name}>
                    <Link to={`/departmanlar/${d.id}`} className="mb-2 flex items-center justify-between px-1 hover:text-accent-2">
                      <h2 className="text-sm font-semibold">{d.name}</h2><span className="font-mono text-[11px] text-faint">{d.code}</span>
                    </Link>
                    {lead ? <Person p={lead} role="Departman Sorumlusu" /> : <p className="rounded-xl border border-dashed border-line px-3 py-2.5 text-xs text-warning">Sorumlu atanmadı</p>}
                    {members.length > 0 && (
                      <ul className="mt-2 space-y-1 border-l border-line pl-3">
                        {members.map((m) => (
                          <li key={m.id}><Link to={`/ekip/${m.id}`} className="flex items-center gap-2 rounded-lg px-1.5 py-1.5 hover:bg-ink/5">
                            <Avatar person={m} size={24} /><span className="min-w-0 truncate text-sm">{fullName(m)}</span>
                            {m.title && <span className="ml-auto hidden truncate text-[11px] text-muted xl:inline">{m.title}</span>}
                          </Link></li>
                        ))}
                      </ul>
                    )}
                    <p className="mt-2 px-1 text-[11px] text-faint">{members.length + (lead ? 1 : 0)} kişi</p>
                  </section>
                );
              })}
            </div>
          </div>
        </div>
      )}
    </>
  );
}
