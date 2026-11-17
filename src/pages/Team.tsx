import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { Network, Search, UsersRound } from "lucide-react";
import { useAsync } from "../lib/useAsync";
import { fetchDepartments, fetchDirectory } from "../lib/api";
import { POSITION_META } from "../lib/constants";
import { fullName } from "../lib/format";
import { Avatar, EmptyState, ErrorState, LoadingState, PageHeader } from "../components/ui";

export default function Team() {
  const [q, setQ] = useState("");
  const [dept, setDept] = useState("");
  const { data, loading, error, reload } = useAsync(async () => {
    const [dir, departments] = await Promise.all([fetchDirectory(), fetchDepartments()]);
    return { dir: dir.filter((d) => d.is_active), departments };
  }, []);

  const list = useMemo(() => {
    if (!data) return [];
    const term = q.trim().toLocaleLowerCase("tr-TR");
    return data.dir
      .filter((p) => !dept || p.department_id === dept)
      .filter((p) => !term || `${fullName(p)} ${p.title ?? ""} ${p.university ?? ""} ${p.major ?? ""} ${(p.skills ?? []).join(" ")}`.toLocaleLowerCase("tr-TR").includes(term))
      .sort((a, b) => POSITION_META[a.team_position ?? "MEMBER"].rank - POSITION_META[b.team_position ?? "MEMBER"].rank || fullName(a).localeCompare(fullName(b), "tr"));
  }, [data, q, dept]);
  const deptName = (id: string | null) => data?.departments.find((d) => d.id === id)?.name ?? "Departmansız";

  return (
    <>
      <PageHeader title="Ekip" description="Takım üyeleri, pozisyonları ve teknik yetkinlikleri. Yetkinliğe göre arayarak bir iş için doğru kişiyi bulun."
        actions={<Link to="/organizasyon" className="btn-secondary"><Network className="size-4" /> Organizasyon şeması</Link>} />
      <div className="mb-4 flex flex-col gap-2 sm:flex-row">
        <div className="relative flex-1">
          <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted" />
          <input className="input pl-9" placeholder="Ad, unvan, üniversite veya yetkinlik (ör. ANSYS, STM32)…" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Ekipte ara" />
        </div>
        {data && <select className="input sm:w-56" value={dept} onChange={(e) => setDept(e.target.value)} aria-label="Departman">
          <option value="">Tüm departmanlar</option>{data.departments.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}</select>}
      </div>
      {loading && !data ? <LoadingState variant="list" /> : error || !data ? <ErrorState message={error ?? ""} onRetry={reload} /> : list.length === 0 ? (
        <EmptyState icon={<UsersRound className="size-6" />} title="Eşleşen üye yok" description="Arama metnini veya departman filtresini değiştirin." />
      ) : (
        <ul className="stagger grid gap-3 sm:grid-cols-2 xl:grid-cols-3" data-testid="team-list">
          {list.map((p) => (
            <li key={p.id} className="card card-link relative flex gap-3 p-4" data-testid="team-card">
              <Avatar person={p} size={48} />
              <div className="min-w-0 flex-1">
                <Link to={`/ekip/${p.id}`} className="block truncate font-medium after:absolute after:inset-0 after:rounded-2xl">{fullName(p)}</Link>
                <p className="truncate text-xs text-accent-2">{p.title || POSITION_META[p.team_position ?? "MEMBER"].label}</p>
                <p className="truncate text-xs text-muted">{deptName(p.department_id)}{p.university ? ` · ${p.university}` : ""}</p>
                {(p.skills ?? []).length > 0 && (
                  <p className="mt-2 flex flex-wrap gap-1">{p.skills!.slice(0, 4).map((s) => <span key={s} className="rounded-md bg-ink/6 px-1.5 py-0.5 text-[11px] text-muted">{s}</span>)}{p.skills!.length > 4 && <span className="text-[11px] text-faint">+{p.skills!.length - 4}</span>}</p>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}
    </>
  );
}
