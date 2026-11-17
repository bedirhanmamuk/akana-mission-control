import { useMemo } from "react";
import { Link, useParams } from "react-router-dom";
import { ArrowLeft, FileText, Plus, Settings2, ShieldAlert, UserRound } from "lucide-react";
import { supabase } from "../lib/supabase";
import { useAuth } from "../context/AuthContext";
import { unwrap, useAsync } from "../lib/useAsync";
import { fetchActivity, fetchDepartmentStats, fetchDepartments, fetchDirectory, fetchDocuments, fetchRisks, nameMap, TASK_SELECT } from "../lib/api";
import { ACTION_LABEL, CLOSED_STATUSES, DOCUMENT_CATEGORY_LABEL, POSITION_META } from "../lib/constants";
import { daysUntil, fullName, timeAgo } from "../lib/format";
import type { TaskWithRelations } from "../lib/types";
import Gantt from "../components/Gantt";
import TCountdown from "../components/TCountdown";
import {
  Avatar, Badge, Card, DocumentStatusBadge, EmptyState, ErrorState, LoadingState, PageHeader, ProgressBar, RiskScore,
  SectionTitle, TaskStatusBadge, Unauthorized,
} from "../components/ui";

export default function DepartmentDetail() {
  const { id = "" } = useParams();
  const { profile, isAdmin, canManageDepartment } = useAuth();
  const canSeeInternals = isAdmin || profile?.department_id === id || canManageDepartment(id);

  const { data, loading, error, reload } = useAsync(async () => {
    const [departments, dir, tasks, stats, docs, risks, deps] = await Promise.all([
      fetchDepartments(), fetchDirectory(),
      supabase.from("tasks").select(TASK_SELECT).eq("department_id", id).order("due_date").then(unwrap<TaskWithRelations[]>),
      fetchDepartmentStats(), fetchDocuments({ departmentId: id }), fetchRisks(),
      supabase.from("task_dependencies").select("task_id,depends_on_id").then(unwrap<{ task_id: string; depends_on_id: string }[]>),
    ]);
    const department = departments.find((d) => d.id === id) ?? null;
    return { department, dir, names: nameMap(dir), tasks, stats: stats.find((s) => s.department_id === id) ?? null, docs, risks: risks.filter((r) => r.department_id === id && r.status !== "CLOSED"), deps };
  }, [id]);
  const activity = useAsync(async () => (canSeeInternals ? fetchActivity(id, 12) : []), [id, canSeeInternals]);

  const derived = useMemo(() => {
    if (!data) return null;
    const open = data.tasks.filter((t) => !CLOSED_STATUSES.includes(t.status));
    const overdue = open.filter((t) => t.status === "OVERDUE" || daysUntil(t.due_date) < 0);
    const done = data.tasks.filter((t) => t.status === "COMPLETED" || t.status === "APPROVED");
    const onTime = done.filter((t) => t.completed_at ? t.completed_at.slice(0, 10) <= t.due_date : true);
    const active = data.tasks.filter((t) => t.status !== "CANCELLED");
    const plan = open.filter((t) => daysUntil(t.due_date) <= 45).sort((a, b) => a.start_date.localeCompare(b.start_date));
    return { open, overdue, done, onTime, active, plan };
  }, [data]);

  if (loading && !data) return <LoadingState />;
  if (error) return <ErrorState message={error} onRetry={reload} />;
  if (!data?.department || !derived) return <Unauthorized />;
  const d = data.department;
  const members = data.dir.filter((p) => p.department_id === id && p.is_active)
    .sort((a, b) => (a.id === d.lead_id ? -1 : b.id === d.lead_id ? 1 : fullName(a).localeCompare(fullName(b), "tr")));
  const lead = d.lead_id ? data.names.get(d.lead_id) : undefined;
  const rate = derived.active.length ? Math.round((derived.done.length / derived.active.length) * 100) : 0;

  return (
    <>
      <Link to="/departmanlar" className="mb-4 inline-flex items-center gap-1.5 text-sm text-muted hover:text-ink"><ArrowLeft className="size-4" /> Departmanlar</Link>
      <PageHeader title={d.name} description={d.description || undefined}
        actions={<>
          {canManageDepartment(id) && <Link to="/yonetim/gorev-olustur" className="btn-secondary"><Plus className="size-4" /> Görev oluştur</Link>}
          {isAdmin && <Link to="/yonetim" className="btn-secondary"><Settings2 className="size-4" /> Departmanı yönet</Link>}
        </>} />

      <div className="grid gap-4 lg:grid-cols-[320px_minmax(0,1fr)]">
        <Card className="p-5">
          <div className="flex items-center gap-3">
            <div className="flex size-12 items-center justify-center rounded-xl bg-accent/15 font-mono text-sm font-bold text-accent-2">{d.code}</div>
            <div className="min-w-0">
              <p className="text-xs text-faint">Departman sorumlusu</p>
              {lead ? <Link to={`/ekip/${lead.id}`} className="flex items-center gap-2 font-medium hover:text-accent-2"><Avatar person={lead} size={24} />{fullName(lead)}</Link>
                : <p className="flex items-center gap-1.5 text-sm text-warning"><UserRound className="size-4" /> Atanmadı</p>}
            </div>
          </div>
          {!d.is_active && <Badge>Pasif departman</Badge>}
          <div className="mt-5">
            <div className="mb-1.5 flex items-baseline justify-between"><span className="text-sm text-muted">Tamamlanma</span><span className="num text-2xl font-semibold">%{rate}</span></div>
            <ProgressBar value={rate} tone="success" label={`${d.name} tamamlanma oranı`} />
          </div>
          <dl className="mt-5 grid grid-cols-2 gap-3">
            {[
              ["Üye", data.stats?.member_count ?? members.length], ["Aktif görev", derived.open.length],
              ["Tamamlanan", derived.done.length], ["Geciken", derived.overdue.length],
              ["Zamanında", derived.done.length ? `%${Math.round((derived.onTime.length / derived.done.length) * 100)}` : "—"], ["Bekleyen rapor", data.stats?.pending_reports ?? "—"],
            ].map(([k, v]) => (
              <div key={k as string} className="rounded-lg bg-surface px-3 py-2"><dt className="text-[11px] text-muted">{k}</dt><dd className={`num text-lg font-semibold ${k === "Geciken" && Number(v) > 0 ? "text-danger" : ""}`}>{v}</dd></div>
            ))}
          </dl>
          {!canSeeInternals && <p className="mt-4 rounded-lg bg-surface px-3 py-2 text-xs text-muted">Görev ayrıntılarını yalnızca departman üyeleri ve yöneticiler görür.</p>}
        </Card>

        <div className="min-w-0 space-y-4">
          <Card className="p-5">
            <SectionTitle aside={<span className="text-xs text-muted">{members.length} kişi</span>}>Ekip</SectionTitle>
            {members.length === 0 ? <p className="text-sm text-muted">Bu departmanda aktif üye yok.</p> : (
              <ul className="grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
                {members.map((m) => (
                  <li key={m.id}>
                    <Link to={`/ekip/${m.id}`} className="flex items-center gap-3 rounded-lg px-2 py-2 hover:bg-ink/5">
                      <Avatar person={m} size={34} />
                      <span className="min-w-0"><span className="block truncate text-sm font-medium">{fullName(m)}</span>
                        <span className="block truncate text-xs text-muted">{m.id === d.lead_id ? "Departman sorumlusu" : m.title || POSITION_META[m.team_position ?? "MEMBER"].label}</span></span>
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </Card>
          <section>
            <h2 className="mb-2 text-[15px] font-semibold">Çalışma planı (önümüzdeki 45 gün)</h2>
            {derived.plan.length === 0 ? <p className="card p-5 text-sm text-muted">Önümüzdeki 45 gün için açık görev yok.</p>
              : <Gantt groups={[{ key: id, label: d.name, tasks: derived.plan }]} dependencies={data.deps} zoom="day" />}
          </section>
        </div>
      </div>

      <div className="mt-4 grid gap-4 xl:grid-cols-3">
        <Card className="p-5 xl:col-span-2">
          <SectionTitle aside={<Link to="/gorevler" className="text-xs text-accent-2 hover:underline">Görevler</Link>}>Aktif görevler</SectionTitle>
          {derived.open.length === 0 ? <EmptyState title="Açık görev yok" /> : (
            <ul className="divide-y divide-line-soft">
              {derived.open.slice(0, 15).map((t) => (
                <li key={t.id}>
                  <Link to={`/gorevler/${t.id}`} className="flex items-center gap-3 py-2.5 hover:opacity-80">
                    <span className="min-w-0 flex-1"><span className="block truncate text-sm"><span className="code-tag mr-2">{t.code}</span>{t.title}</span>
                      <span className="block truncate text-xs text-muted">{t.task_assignees.map((a) => fullName(data.names.get(a.user_id))).join(", ")} · %{t.progress}</span></span>
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
            <SectionTitle>Departman aktiviteleri</SectionTitle>
            {!canSeeInternals ? <p className="text-sm text-muted">Yalnızca departman üyeleri ve yöneticiler görebilir.</p>
              : activity.loading && !activity.data ? <LoadingState variant="compact" /> : (activity.data ?? []).length === 0 ? <p className="text-sm text-muted">Henüz kayıt yok.</p> : (
                <ul className="space-y-2.5">{activity.data!.map((a) => (
                  <li key={a.id}><p className="text-sm leading-snug">{a.summary || ACTION_LABEL[a.action]}</p><p className="text-xs text-muted">{a.actor} · {timeAgo(a.created_at)}</p></li>
                ))}</ul>
              )}
          </Card>
          <Card className="p-5">
            <SectionTitle aside={<Link to="/riskler" className="text-xs text-accent-2 hover:underline">Tümü</Link>}><span className="flex items-center gap-2"><ShieldAlert className="size-4 text-muted" /> Açık riskler</span></SectionTitle>
            {data.risks.length === 0 ? <p className="text-sm text-muted">Açık risk yok.</p> : (
              <ul className="divide-y divide-line-soft">{data.risks.slice(0, 6).map((r) => (
                <li key={r.id}><Link to={`/riskler/${r.id}`} className="flex items-center gap-3 py-2 hover:opacity-80"><span className="min-w-0 flex-1 truncate text-sm">{r.title}</span><RiskScore score={r.score} /></Link></li>
              ))}</ul>
            )}
          </Card>
          <Card className="p-5">
            <SectionTitle aside={<Link to="/dokumanlar" className="text-xs text-accent-2 hover:underline">Tümü</Link>}><span className="flex items-center gap-2"><FileText className="size-4 text-muted" /> Departman raporları</span></SectionTitle>
            {data.docs.length === 0 ? <p className="text-sm text-muted">Bu departmana ait doküman yok.</p> : (
              <ul className="divide-y divide-line-soft">{data.docs.slice(0, 6).map((doc) => (
                <li key={doc.id}><Link to={`/dokumanlar/${doc.id}`} className="flex items-center gap-3 py-2 hover:opacity-80">
                  <span className="min-w-0 flex-1"><span className="block truncate text-sm">{doc.title}</span><span className="text-xs text-muted">{DOCUMENT_CATEGORY_LABEL[doc.category]}</span></span><DocumentStatusBadge status={doc.status} />
                </Link></li>
              ))}</ul>
            )}
          </Card>
        </div>
      </div>
    </>
  );
}
