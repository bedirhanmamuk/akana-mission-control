import { Link } from "react-router-dom";
import {
  AlertOctagon, Ban, CalendarClock, CalendarDays, Clock4, FolderKanban, ShieldAlert,
} from "lucide-react";
import { Area, AreaChart, Bar, BarChart, CartesianGrid, Legend, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { supabase } from "../lib/supabase";
import { useAuth } from "../context/AuthContext";
import { unwrap, useAsync } from "../lib/useAsync";
import { usePolling } from "../lib/usePolling";
import { fetchActivity, fetchMissionOverview } from "../lib/api";
import { ACTION_LABEL, EVENT_TYPE_META, REPORT_STATUS_META, REPORT_STATUSES } from "../lib/constants";
import { daysUntil, formatDate, formatDateTime, formatMonth, fullName, timeAgo } from "../lib/format";
import TCountdown from "../components/TCountdown";
import type { DashboardStats, MissionOverview, MissionTaskRow, ReportStatus } from "../lib/types";
import {
  Badge, Card, EmptyState, ErrorState, LoadingState, PageHeader, PriorityBadge, ProgressBar, ProjectStatusBadge,
  Readout, ReadoutGroup, ReportStatusBadge, RiskScore, SectionTitle,
} from "../components/ui";

const AXIS = { fill: "var(--color-muted)", fontSize: 11 };
const GRID = "var(--color-line-soft)";

function ChartTooltip({ active, payload, label }: {
  active?: boolean; payload?: { value?: number | string; name?: string; color?: string }[]; label?: string | number;
}) {
  if (!active || !payload?.length) return null;
  return (
    <div className="rounded-lg bg-surface px-3 py-2 text-xs shadow-xl">
      <p className="mb-1 text-muted">{label}</p>
      {payload.map((p) => (
        <p key={p.name} className="flex items-center gap-2 font-medium text-ink tabular-nums">
          <span className="size-2 rounded-sm" style={{ background: p.color }} /> {p.name}: {p.value}
        </p>
      ))}
    </div>
  );
}

function ChartEmpty({ text }: { text: string }) {
  return <div className="flex h-48 items-center justify-center text-sm text-muted">{text}</div>;
}

/** Proje ilerleme paneli: her proje için sorumlu, tarihler, yüzde ve durum */
function ProjectPanel({ projects }: { projects: MissionOverview["projects"] }) {
  return (
    <Card className="p-5">
      <SectionTitle aside={<Link to="/projeler" className="text-xs text-accent-2 hover:underline">Tüm projeler</Link>}>
        <span className="flex items-center gap-2"><FolderKanban className="size-4 text-muted" /> Proje ilerlemesi</span>
      </SectionTitle>
      {projects.length === 0 ? (
        <EmptyState title="Aktif proje yok"
          action={<Link to="/projeler" className="btn-secondary">Projelere git</Link>} />
      ) : (
        <ul className="divide-y divide-line-soft" data-testid="project-progress">
          {projects.map((p) => {
            const late = p.status === "ACTIVE" && daysUntil(p.target_date) < 0 && p.progress < 100;
            return (
              <li key={p.id} className="py-3 first:pt-0 last:pb-0">
                <Link to={`/projeler/${p.id}`} className="group block">
                  <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
                    <p className="min-w-0 flex-1 truncate text-sm font-medium group-hover:text-accent-2">
                      <span className="code-tag mr-2">{p.code}</span>{p.name}
                    </p>
                    <span className="num text-lg font-semibold tabular-nums">%{p.progress}</span>
                  </div>
                  <ProgressBar value={p.progress} tone={late ? "danger" : p.progress >= 100 ? "success" : "accent"} className="my-2" label={`${p.name} ilerlemesi yüzde ${p.progress}`} />
                  <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted">
                    <ProjectStatusBadge status={p.status} />
                    <span>Sorumlu: {p.owner_name || "Atanmadı"}</span>
                    <span className="tabular-nums">{formatDate(p.start_date)} – {formatDate(p.target_date)}</span>
                    <span className="tabular-nums">{p.completed_tasks}/{p.total_tasks} görev</span>
                    {p.overdue_tasks > 0 && <span className="text-danger">{p.overdue_tasks} geciken</span>}
                    {p.blocked_tasks > 0 && <span className="text-danger">{p.blocked_tasks} bloke</span>}
                  </div>
                </Link>
              </li>
            );
          })}
        </ul>
      )}
    </Card>
  );
}

const REASON: Record<NonNullable<MissionTaskRow["reason"]>, { label: string; icon: typeof Ban; cls: string }> = {
  blocked: { label: "Bloke", icon: Ban, cls: "text-danger" },
  overdue: { label: "Gecikti", icon: Clock4, cls: "text-danger" },
  priority: { label: "Yüksek öncelik", icon: AlertOctagon, cls: "text-warning" },
};

function CriticalOps({ rows }: { rows: MissionTaskRow[] }) {
  return (
    <Card className="p-5">
      <SectionTitle aside={<Link to="/gorevler?filtre=kritik" className="text-xs text-accent-2 hover:underline">Tümü</Link>}>
        <span className="flex items-center gap-2"><AlertOctagon className="size-4 text-danger" /> Kritik operasyonlar</span>
      </SectionTitle>
      {rows.length === 0 ? (
        <p className="rounded-lg bg-success/8 px-3 py-6 text-center text-sm text-success">Geciken, bloke veya yüksek öncelikli açık görev yok.</p>
      ) : (
        <ul className="space-y-1" data-testid="critical-ops">
          {rows.map((t) => {
            const r = REASON[t.reason ?? "priority"];
            const Icon = r.icon;
            return (
              <li key={t.id}>
                <Link to={`/gorevler/${t.id}`} className="flex items-start gap-3 rounded-lg px-2 py-2 hover:bg-ink/5">
                  <Icon className={`mt-0.5 size-4 shrink-0 ${r.cls}`} aria-label={r.label} />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm"><span className="code-tag mr-2">{t.code}</span>{t.title}</span>
                    <span className="block truncate text-xs text-muted">
                      {t.department_name} · {r.label}{t.reason === "blocked" && t.blocked_reason ? `: ${t.blocked_reason}` : ""}
                    </span>
                  </span>
                  <span className="shrink-0"><TCountdown dueDate={t.due_date} status={t.status} showDate={false} /></span>
                </Link>
              </li>
            );
          })}
        </ul>
      )}
    </Card>
  );
}

function Upcoming({ rows }: { rows: MissionTaskRow[] }) {
  return (
    <Card className="p-5">
      <SectionTitle aside={<span className="text-xs text-muted">önümüzdeki 7 gün</span>}>
        <span className="flex items-center gap-2"><CalendarClock className="size-4 text-muted" /> Yaklaşan teslimler</span>
      </SectionTitle>
      {rows.length === 0 ? (
        <EmptyState title="Bu hafta teslim yok" description="7 gün içinde teslim yok." icon={<CalendarClock className="size-6" />} />
      ) : (
        <ul className="divide-y divide-line-soft" data-testid="upcoming-list">
          {rows.map((t) => (
            <li key={t.id}>
              <Link to={`/gorevler/${t.id}`} className="flex items-center gap-3 py-2.5 hover:opacity-80">
                <TCountdown dueDate={t.due_date} status={t.status} showDate={false} />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm">{t.title}</span>
                  <span className="block truncate text-xs text-muted"><span className="code-tag mr-1.5">{t.code}</span>{t.department_name}{t.mine ? " · size atandı" : ""}</span>
                </span>
                <PriorityBadge priority={t.priority} />
              </Link>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}

function DepartmentPerformance({ rows, scope }: { rows: MissionOverview["departments"]; scope: MissionOverview["scope"] }) {
  const data = rows.map((d) => ({
    name: d.name, Kapanan: d.completed, Aktif: d.active - d.overdue, Geciken: d.overdue,
    rate: d.total ? Math.round((d.completed / d.total) * 100) : 0,
  }));
  const any = rows.some((d) => d.total > 0);
  return (
    <Card className="p-5">
      <SectionTitle aside={<span className="text-xs text-muted">{scope === "all" ? "tüm departmanlar" : "erişiminiz olan departmanlar"}</span>}>
        Departman performansı ve iş yükü
      </SectionTitle>
      {!any ? <ChartEmpty text="Henüz görev oluşturulmadı." /> : (
        <>
          <div style={{ height: Math.max(180, data.length * 34 + 40) }}>
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={data} layout="vertical" margin={{ top: 0, right: 12, bottom: 0, left: 0 }} barCategoryGap={8}>
                <CartesianGrid horizontal={false} stroke={GRID} />
                <XAxis type="number" allowDecimals={false} tick={AXIS} axisLine={false} tickLine={false} />
                <YAxis type="category" dataKey="name" width={112} tick={{ ...AXIS, fill: "var(--color-ink)" }} axisLine={false} tickLine={false} />
                <Tooltip cursor={{ fill: "color-mix(in srgb, var(--color-ink) 5%, transparent)" }} content={<ChartTooltip />} />
                <Legend iconType="square" iconSize={8} wrapperStyle={{ fontSize: 11, color: "var(--color-muted)" }} />
                <Bar dataKey="Kapanan" stackId="a" fill="var(--color-success)" maxBarSize={16} animationDuration={700} />
                <Bar dataKey="Aktif" stackId="a" fill="var(--color-accent)" maxBarSize={16} animationDuration={700} />
                <Bar dataKey="Geciken" stackId="a" fill="var(--color-danger)" radius={[0, 3, 3, 0]} maxBarSize={16} animationDuration={700} />
              </BarChart>
            </ResponsiveContainer>
          </div>
          <p className="mt-4 mb-1.5 text-xs text-faint">Tamamlanma oranı (kapanan / iptal hariç toplam)</p>
          <ul className="grid gap-x-6 gap-y-1.5 sm:grid-cols-2">
            {data.map((d) => (
              <li key={d.name} className="flex items-center justify-between gap-3 text-xs">
                <span className="min-w-0 truncate text-muted" title={d.name}>{d.name}</span>
                <span className="shrink-0 font-semibold text-ink tabular-nums">%{d.rate}</span>
              </li>
            ))}
          </ul>
        </>
      )}
    </Card>
  );
}

function SidePanels({ data }: { data: MissionOverview }) {
  const activity = useAsync(() => fetchActivity(null, 10), []);
  return (
    <div className="mt-4 grid gap-4 lg:grid-cols-3">
      <Card className="p-5">
        <SectionTitle aside={<Link to="/riskler" className="text-xs text-accent-2 hover:underline">Risk kaydı</Link>}>
          <span className="flex items-center gap-2"><ShieldAlert className="size-4 text-danger" /> Kritik riskler</span>
        </SectionTitle>
        {data.critical_risks.length === 0 ? (
          <p className="py-4 text-sm text-muted">Puanı 15 ve üzeri açık risk yok.</p>
        ) : (
          <ul className="divide-y divide-line-soft">
            {data.critical_risks.map((r) => (
              <li key={r.id}>
                <Link to={`/riskler/${r.id}`} className="flex items-center gap-3 py-2.5 hover:opacity-80">
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm">{r.title}</span>
                    <span className="block text-xs text-muted"><span className="code-tag mr-1.5">{r.code}</span>O{r.probability} × E{r.impact}</span>
                  </span>
                  <RiskScore score={r.score} />
                </Link>
              </li>
            ))}
          </ul>
        )}
      </Card>
      <Card className="p-5">
        <SectionTitle aside={<Link to="/takvim" className="text-xs text-accent-2 hover:underline">Takvim</Link>}>
          <span className="flex items-center gap-2"><CalendarDays className="size-4 text-muted" /> Yaklaşan etkinlikler</span>
        </SectionTitle>
        {data.upcoming_events.length === 0 ? (
          <p className="py-4 text-sm text-muted">14 gün içinde etkinlik yok.</p>
        ) : (
          <ul className="space-y-2">
            {data.upcoming_events.map((e) => (
              <li key={e.id} className="flex items-start gap-3">
                <span className="mt-1.5 size-2 shrink-0 rounded-full" style={{ background: EVENT_TYPE_META[e.type].color }} />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm">{e.title}</span>
                  <span className="block text-xs text-muted">{EVENT_TYPE_META[e.type].label} · {e.all_day ? formatDate(e.starts_at) : formatDateTime(e.starts_at)}{e.location ? ` · ${e.location}` : ""}</span>
                </span>
              </li>
            ))}
          </ul>
        )}
      </Card>
      <Card className="p-5">
        <SectionTitle>Son aktiviteler</SectionTitle>
        {activity.loading && !activity.data ? <LoadingState variant="compact" /> : (activity.data ?? []).length === 0 ? (
          <p className="py-4 text-sm text-muted">Henüz görüntüleyebileceğiniz bir işlem yok.</p>
        ) : (
          <ol className="relative space-y-3 before:absolute before:top-1 before:bottom-1 before:left-[3px] before:w-px before:bg-line" data-testid="activity-feed">
            {activity.data!.map((a) => (
              <li key={a.id} className="relative pl-5">
                <span className="absolute top-1.5 left-0 size-[7px] rounded-full bg-accent" />
                <p className="text-sm leading-snug">{a.summary || ACTION_LABEL[a.action] || a.action}</p>
                <p className="text-xs text-muted">{a.actor} · {timeAgo(a.created_at)}</p>
              </li>
            ))}
          </ol>
        )}
      </Card>
    </div>
  );
}

/** Yönetici: rapor akışı grafikleri (dashboard_stats; tamamı gerçek veriden) */
function ReportFlow() {
  const { data, loading, error, reload } = useAsync<DashboardStats>(async () => unwrap(await supabase.rpc("dashboard_stats")), []);
  if (loading && !data) return <LoadingState variant="compact" />;
  if (error || !data) return <ErrorState message={error ?? "Veri alınamadı."} onRetry={reload} />;
  const monthly = data.monthly_uploads.map((m) => ({ ...m, label: formatMonth(m.month) }));
  const totalUploads = monthly.reduce((s, m) => s + m.count, 0);
  const reportTotal = data.report_status.reduce((s, r) => s + r.count, 0);
  const reportCount = (s: ReportStatus) => data.report_status.find((r) => r.status === s)?.count ?? 0;
  return (
    <section className="mt-8" aria-label="Rapor akışı">
      <h2 className="display mb-3 text-lg font-semibold">Rapor akışı</h2>
      <div className="grid gap-4 xl:grid-cols-3">
        <Card className="p-5 xl:col-span-2">
          <SectionTitle aside={<span className="text-xs text-muted">son 12 ay · {totalUploads} yükleme</span>}>Aylık rapor yükleme</SectionTitle>
          {totalUploads === 0 ? <ChartEmpty text="Henüz rapor yüklenmedi." /> : (
            <div className="h-52">
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={monthly} margin={{ top: 8, right: 12, bottom: 0, left: -18 }}>
                  <defs>
                    <linearGradient id="uploads" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor="var(--color-accent)" stopOpacity={0.3} />
                      <stop offset="100%" stopColor="var(--color-accent)" stopOpacity={0} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid vertical={false} stroke={GRID} />
                  <XAxis dataKey="label" tick={AXIS} axisLine={false} tickLine={false} interval="preserveStartEnd" minTickGap={18} />
                  <YAxis allowDecimals={false} tick={AXIS} axisLine={false} tickLine={false} />
                  <Tooltip cursor={{ stroke: "var(--color-accent)", strokeOpacity: 0.4 }} content={<ChartTooltip />} />
                  <Area type="monotone" dataKey="count" name="Yükleme" stroke="var(--color-accent)" strokeWidth={2} fill="url(#uploads)" animationDuration={700}
                    dot={{ r: 2.5, fill: "var(--color-accent)", strokeWidth: 0 }} activeDot={{ r: 5, stroke: "var(--color-card)", strokeWidth: 2 }} />
                </AreaChart>
              </ResponsiveContainer>
            </div>
          )}
        </Card>
        <Card className="p-5">
          <SectionTitle aside={<span className="text-xs text-muted">{reportTotal} rapor</span>}>Rapor onay ve revizyon oranları</SectionTitle>
          {reportTotal === 0 ? <ChartEmpty text="Henüz rapor yüklenmedi." /> : (
            <>
              <div className="flex h-3 gap-0.5 overflow-hidden rounded-full" role="img" aria-label="Rapor durumlarının dağılımı">
                {REPORT_STATUSES.filter((s) => reportCount(s) > 0).map((s) => (
                  <div key={s} title={`${REPORT_STATUS_META[s].label}: ${reportCount(s)}`}
                    style={{ width: `${(reportCount(s) / reportTotal) * 100}%`, background: REPORT_STATUS_META[s].color }} />
                ))}
              </div>
              <ul className="mt-5 space-y-2.5">
                {REPORT_STATUSES.map((s) => {
                  const c = reportCount(s);
                  return (
                    <li key={s} className="flex items-center gap-3 text-sm">
                      <span className="size-2.5 shrink-0 rounded-sm" style={{ background: REPORT_STATUS_META[s].color }} />
                      <span className="flex-1">{REPORT_STATUS_META[s].label}</span>
                      <span className="text-muted tabular-nums">{c}</span>
                      <span className="w-12 text-right font-semibold tabular-nums">%{Math.round((c / reportTotal) * 100)}</span>
                    </li>
                  );
                })}
              </ul>
            </>
          )}
        </Card>
      </div>
      <Card className="mt-4 p-5">
        <SectionTitle aside={<Link to="/yonetim/rapor-inceleme" className="text-xs text-accent-2 hover:underline">Tümü</Link>}>Son yüklenen raporlar</SectionTitle>
        {data.recent_reports.length === 0 ? <p className="py-6 text-center text-sm text-muted">Henüz rapor yüklenmedi.</p> : (
          <ul className="grid gap-x-8 divide-y divide-line-soft md:grid-cols-2 md:divide-y-0">
            {data.recent_reports.map((r) => (
              <li key={`${r.report_id}-${r.version}`}>
                <Link to={`/yonetim/rapor-inceleme/${r.report_id}`} className="flex items-center gap-3 py-2.5 hover:opacity-80">
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm">{r.title}</p>
                    <p className="truncate text-xs text-muted"><span className="code-tag">{r.task_code}</span> · V{r.version} · {r.uploader} · {timeAgo(r.created_at)}</p>
                  </div>
                  <ReportStatusBadge status={r.status} />
                </Link>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </section>
  );
}

function Overview() {
  const { isAdmin } = useAuth();
  const { data, loading, error, reload, refresh } = useAsync(fetchMissionOverview, []);
  usePolling(refresh, 60_000);
  // Yönetici şeridindeki "Toplam görev / ekip / onaylanan rapor" dashboard_stats ile aynı kaynaktan gelir
  const admin = useAsync<DashboardStats | null>(async () => (isAdmin ? unwrap(await supabase.rpc("dashboard_stats")) : null), [isAdmin]);

  if (loading && !data) return <LoadingState label="Kontrol merkezi verileri yükleniyor…" />;
  if (error || !data) return <ErrorState message={error ?? "Veri alınamadı."} onRetry={reload} />;

  return (
    <>
      <section className="card grid divide-y divide-ink/5 lg:grid-cols-[1fr_1.9fr_1.4fr] lg:divide-x lg:divide-y-0"
        data-testid={data.scope === "all" ? "admin-stats" : "mission-stats"} aria-label="Özet göstergeler">
        <ReadoutGroup title="Projeler" cols={2}>
          <Readout label="Toplam proje" value={data.total_projects} to="/projeler" />
          <Readout label="Aktif proje" value={data.active_projects} to="/projeler" />
        </ReadoutGroup>
        <ReadoutGroup title={data.scope === "member" ? "Görevler (departmanım ve bana atananlar)" : "Görevler"}>
          {isAdmin && admin.data ? <Readout label="Toplam görev" value={admin.data.total_tasks} to="/gorevler" /> : <Readout label="Görünen görev" value={data.total_tasks} to="/gorevler" />}
          <Readout label="Aktif görev" value={data.active_tasks} to="/gorevler?filtre=acik" />
          <Readout label="Devam eden" value={data.in_progress_tasks} to="/gorevler?filtre=devam" />
          <Readout label="Tamamlanan görev" value={isAdmin && admin.data ? admin.data.completed_tasks : data.completed_tasks} to="/gorevler?filtre=tamamlanan" tone="success" />
          <Readout label="Geciken görev" value={data.overdue_tasks} to="/gorevler?filtre=geciken" tone="danger" />
          <Readout label="Bloke görev" value={data.blocked_tasks} to="/gorevler?filtre=bloke" tone="danger" />
        </ReadoutGroup>
        <ReadoutGroup title="Onay ve ekip" cols={2}>
          <Readout label="Bekleyen onay" value={data.pending_approvals} to={data.scope === "member" ? "/arsiv" : "/yonetim/rapor-inceleme"} tone="warning" />
          {isAdmin && admin.data && <Readout label="Onaylanan rapor" value={admin.data.approved_reports} to="/arsiv" tone="success" />}
          <Readout label={isAdmin ? "Toplam ekip üyesi" : "Aktif ekip üyesi"} value={isAdmin && admin.data ? admin.data.total_members : data.active_members} to="/ekip" />
          {!isAdmin && <Readout label="Açık görevim" value={data.my_open_tasks} to="/gorevler" />}
        </ReadoutGroup>
      </section>

      <div className="mt-4 grid gap-4 xl:grid-cols-[minmax(0,1.5fr)_minmax(0,1fr)]">
        <ProjectPanel projects={data.projects} />
        <CriticalOps rows={data.critical} />
      </div>
      <div className="mt-4 grid gap-4 xl:grid-cols-2">
        <DepartmentPerformance rows={data.departments} scope={data.scope} />
        <Upcoming rows={data.upcoming} />
      </div>
      <SidePanels data={data} />
      {isAdmin && <ReportFlow />}
    </>
  );
}

export default function Dashboard() {
  const { profile, isAdmin, isManager } = useAuth();
  return (
    <>
      <PageHeader
        title="Kontrol Merkezi"
        description={isAdmin
          ? "Takımın güncel durumu. Veriler dakikada bir yenilenir."
          : `Hoş geldin, ${fullName(profile)}. ${isManager ? "Sorumlu olduğun departmanların" : "Departmanının ve sana atanan görevlerin"} güncel durumu.`}
        actions={isManager && <Badge tone="accent">{isAdmin ? "Yönetici görünümü" : "Departman sorumlusu"}</Badge>}
      />
      <Overview />
    </>
  );
}
