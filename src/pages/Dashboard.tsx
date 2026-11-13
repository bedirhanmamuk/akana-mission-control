import { Link } from "react-router-dom";
import {
  AlertOctagon, Building2, CalendarClock, CheckCircle2, ClipboardList, FileCheck2, FileClock,
  FileWarning, ListChecks, RotateCcw, Users,
} from "lucide-react";
import { Area, AreaChart, Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { supabase } from "../lib/supabase";
import { useAuth } from "../context/AuthContext";
import { unwrap, useAsync } from "../lib/useAsync";
import { fetchTasks } from "../lib/api";
import { ACTION_LABEL, REPORT_STATUS_META, REPORT_STATUSES } from "../lib/constants";
import { daysUntil, formatDate, formatMonth, fullName, timeAgo } from "../lib/format";
import type { DashboardStats, Report, ReportStatus } from "../lib/types";
import {
  Card, EmptyState, ErrorState, LoadingState, PageHeader, PriorityBadge, ReportStatusBadge,
  SectionTitle, StatCard, TaskStatusBadge,
} from "../components/ui";

const AXIS = { fill: "#9299AE", fontSize: 11 };
const GRID = "#252B45";

function ChartTooltip({ active, payload, label, unit }: {
  active?: boolean; payload?: { value?: number | string }[]; label?: string | number; unit: string;
}) {
  if (!active || !payload?.length) return null;
  return (
    <div className="rounded-lg border border-line bg-surface px-3 py-2 text-xs shadow-xl">
      <p className="text-muted">{label}</p>
      <p className="mt-0.5 font-semibold text-ink tabular-nums">{payload[0].value} {unit}</p>
    </div>
  );
}

function ChartEmpty({ text }: { text: string }) {
  return <div className="flex h-56 items-center justify-center text-sm text-muted">{text}</div>;
}

function AdminDashboard() {
  const { data, loading, error, reload } = useAsync<DashboardStats>(
    async () => unwrap(await supabase.rpc("dashboard_stats")), [],
  );

  if (loading) return <LoadingState label="Kontrol merkezi verileri yükleniyor…" />;
  if (error || !data) return <ErrorState message={error ?? "Veri alınamadı."} onRetry={reload} />;

  const deptData = [...data.tasks_by_department].sort((a, b) => b.total - a.total);
  const monthly = data.monthly_uploads.map((m) => ({ ...m, label: formatMonth(m.month) }));
  const totalUploads = monthly.reduce((s, m) => s + m.count, 0);
  const reportTotal = data.report_status.reduce((s, r) => s + r.count, 0);
  const reportCount = (s: ReportStatus) => data.report_status.find((r) => r.status === s)?.count ?? 0;

  return (
    <>
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4" data-testid="admin-stats">
        <StatCard label="Toplam ekip üyesi" value={data.total_members} icon={<Users className="size-5" />} to="/yonetim/uyeler" />
        <StatCard label="Aktif departman" value={data.active_departments} icon={<Building2 className="size-5" />} to="/departmanlar" />
        <StatCard label="Toplam görev" value={data.total_tasks} icon={<ClipboardList className="size-5" />} to="/gorevler" />
        <StatCard label="Tamamlanan görev" value={data.completed_tasks} icon={<CheckCircle2 className="size-5" />} tone="success" to="/gorevler" />
        <StatCard label="Bekleyen rapor" value={data.pending_reports} icon={<FileClock className="size-5" />} tone="info" to="/yonetim/rapor-inceleme" />
        <StatCard label="Onaylanan rapor" value={data.approved_reports} icon={<FileCheck2 className="size-5" />} tone="success" to="/arsiv" />
        <StatCard label="Revizyon bekleyen rapor" value={data.revision_reports} icon={<RotateCcw className="size-5" />} tone="warning" to="/arsiv" />
        <StatCard label="Geciken görev" value={data.overdue_tasks} icon={<AlertOctagon className="size-5" />} tone="danger" to="/gorevler" />
      </div>

      <div className="mt-6 grid gap-4 xl:grid-cols-2">
        <Card className="p-5">
          <SectionTitle aside={<span className="text-xs text-muted">görev sayısı</span>}>Departmanlara göre görev dağılımı</SectionTitle>
          {data.total_tasks === 0 ? <ChartEmpty text="Henüz görev oluşturulmadı." /> : (
            <div style={{ height: Math.max(220, deptData.length * 38) }}>
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={deptData} layout="vertical" margin={{ top: 0, right: 16, bottom: 0, left: 0 }} barCategoryGap={10}>
                  <CartesianGrid horizontal={false} stroke={GRID} />
                  <XAxis type="number" allowDecimals={false} tick={AXIS} axisLine={false} tickLine={false} />
                  <YAxis type="category" dataKey="name" width={96} tick={{ ...AXIS, fill: "#F4F4F8" }} axisLine={false} tickLine={false} />
                  <Tooltip cursor={{ fill: "rgb(255 255 255 / 0.04)" }} content={<ChartTooltip unit="görev" />} />
                  <Bar dataKey="total" fill="#8065D8" radius={[0, 4, 4, 0]} maxBarSize={18} isAnimationActive={false} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          )}
        </Card>

        <Card className="p-5">
          <SectionTitle aside={<span className="text-xs text-muted">son 12 ay · {totalUploads} yükleme</span>}>Aylık rapor yükleme</SectionTitle>
          {totalUploads === 0 ? <ChartEmpty text="Henüz rapor yüklenmedi." /> : (
            <div className="h-56">
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={monthly} margin={{ top: 8, right: 12, bottom: 0, left: -18 }}>
                  <defs>
                    <linearGradient id="uploads" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor="#8065D8" stopOpacity={0.35} />
                      <stop offset="100%" stopColor="#8065D8" stopOpacity={0} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid vertical={false} stroke={GRID} />
                  <XAxis dataKey="label" tick={AXIS} axisLine={false} tickLine={false} interval="preserveStartEnd" minTickGap={18} />
                  <YAxis allowDecimals={false} tick={AXIS} axisLine={false} tickLine={false} />
                  <Tooltip cursor={{ stroke: "#A78BFA", strokeOpacity: 0.4 }} content={<ChartTooltip unit="yükleme" />} />
                  <Area type="monotone" dataKey="count" stroke="#A78BFA" strokeWidth={2} fill="url(#uploads)" isAnimationActive={false}
                    dot={{ r: 2.5, fill: "#A78BFA", strokeWidth: 0 }} activeDot={{ r: 5, stroke: "#171C30", strokeWidth: 2 }} />
                </AreaChart>
              </ResponsiveContainer>
            </div>
          )}
        </Card>

        <Card className="p-5">
          <SectionTitle aside={<span className="text-xs text-muted">tamamlanan / toplam</span>}>Görev tamamlama oranları</SectionTitle>
          {data.total_tasks === 0 ? <ChartEmpty text="Henüz görev oluşturulmadı." /> : (
            <ul className="space-y-3.5">
              {deptData.map((d) => {
                const pct = d.total > 0 ? Math.round((d.completed / d.total) * 100) : 0;
                return (
                  <li key={d.name}>
                    <div className="mb-1.5 flex items-baseline justify-between gap-3 text-sm">
                      <span className="truncate">{d.name}</span>
                      <span className="shrink-0 text-xs text-muted tabular-nums">
                        {d.completed} / {d.total} <span className="ml-1 font-semibold text-ink">%{pct}</span>
                      </span>
                    </div>
                    <div className="h-2 overflow-hidden rounded-full bg-line" role="img" aria-label={`${d.name}: yüzde ${pct} tamamlandı`}>
                      <div className="h-full rounded-full bg-accent" style={{ width: `${pct}%` }} />
                    </div>
                  </li>
                );
              })}
            </ul>
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

      <div className="mt-6 grid gap-4 xl:grid-cols-2">
        <Card className="p-5">
          <SectionTitle aside={<Link to="/yonetim/rapor-inceleme" className="text-xs text-accent-2 hover:underline">Tümü</Link>}>Son yüklenen raporlar</SectionTitle>
          {data.recent_reports.length === 0 ? <p className="py-6 text-center text-sm text-muted">Henüz rapor yüklenmedi.</p> : (
            <ul className="divide-y divide-line-soft">
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
        <Card className="p-5">
          <SectionTitle aside={<Link to="/yonetim/kayitlar" className="text-xs text-accent-2 hover:underline">Tümü</Link>}>Son işlemler</SectionTitle>
          {data.recent_activity.length === 0 ? <p className="py-6 text-center text-sm text-muted">Henüz kayıt yok.</p> : (
            <ul className="divide-y divide-line-soft">
              {data.recent_activity.map((a) => (
                <li key={a.id} className="py-2.5">
                  <p className="text-sm">{a.summary || ACTION_LABEL[a.action] || a.action}</p>
                  <p className="text-xs text-muted">{a.actor} · {timeAgo(a.created_at)}</p>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>
    </>
  );
}

function MemberDashboard() {
  const { profile } = useAuth();
  const uid = profile!.id;
  const { data, loading, error, reload } = useAsync(async () => {
    const [tasks, reports] = await Promise.all([
      fetchTasks(),
      supabase.from("reports").select("*").eq("uploaded_by", uid).order("updated_at", { ascending: false }).then(unwrap<Report[]>),
    ]);
    return { tasks: tasks.filter((t) => t.task_assignees.some((a) => a.user_id === uid)), reports };
  }, [uid]);

  if (loading) return <LoadingState />;
  if (error || !data) return <ErrorState message={error ?? "Veri alınamadı."} onRetry={reload} />;

  const { tasks, reports } = data;
  const open = tasks.filter((t) => !["COMPLETED", "APPROVED"].includes(t.status));
  const upcoming = [...open].sort((a, b) => a.due_date.localeCompare(b.due_date)).slice(0, 6);
  const count = (s: ReportStatus[]) => reports.filter((r) => s.includes(r.status)).length;

  return (
    <>
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatCard label="Atanan görev" value={tasks.length} icon={<ClipboardList className="size-5" />} to="/gorevler" />
        <StatCard label="Açık görev" value={open.length} icon={<ListChecks className="size-5" />} tone="info" to="/gorevler" />
        <StatCard label="İncelemedeki rapor" value={count(["PENDING", "IN_REVIEW"])} icon={<FileClock className="size-5" />} tone="accent" to="/arsiv" />
        <StatCard label="Revizyon bekleyen" value={count(["REVISION_REQUESTED", "REJECTED"])} icon={<FileWarning className="size-5" />} tone="warning" to="/arsiv" />
      </div>
      <div className="mt-6 grid gap-4 xl:grid-cols-2">
        <Card className="p-5">
          <SectionTitle aside={<Link to="/gorevler" className="text-xs text-accent-2 hover:underline">Tümü</Link>}>Yaklaşan teslimler</SectionTitle>
          {upcoming.length === 0 ? (
            <EmptyState title="Açık göreviniz yok" description="Size yeni bir görev atandığında burada görünecek." icon={<CalendarClock className="size-6" />} />
          ) : (
            <ul className="divide-y divide-line-soft">
              {upcoming.map((t) => {
                const d = daysUntil(t.due_date);
                return (
                  <li key={t.id}>
                    <Link to={`/gorevler/${t.id}`} className="flex items-center gap-3 py-2.5 hover:opacity-80">
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm"><span className="code-tag mr-2">{t.code}</span>{t.title}</p>
                        <p className={`text-xs ${d < 0 ? "text-danger" : d <= 3 ? "text-warning" : "text-muted"}`}>
                          {formatDate(t.due_date)} · {d < 0 ? `${-d} gün gecikti` : d === 0 ? "bugün teslim" : `${d} gün kaldı`}
                        </p>
                      </div>
                      <PriorityBadge priority={t.priority} />
                      <span className="hidden sm:inline"><TaskStatusBadge status={t.status} /></span>
                    </Link>
                  </li>
                );
              })}
            </ul>
          )}
        </Card>
        <Card className="p-5">
          <SectionTitle aside={<Link to="/arsiv" className="text-xs text-accent-2 hover:underline">Tümü</Link>}>Raporlarım</SectionTitle>
          {reports.length === 0 ? (
            <EmptyState title="Henüz rapor yüklemediniz" description="Görevlerinizin raporlarını Rapor Yükle ekranından gönderebilirsiniz."
              action={<Link to="/rapor-yukle" className="btn-primary">Rapor yükle</Link>} />
          ) : (
            <ul className="divide-y divide-line-soft">
              {reports.slice(0, 6).map((r) => (
                <li key={r.id}>
                  <Link to={`/raporlar/${r.id}`} className="flex items-center gap-3 py-2.5 hover:opacity-80">
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm">{r.title}</p>
                      <p className="text-xs text-muted">V{r.current_version} · {timeAgo(r.updated_at)}</p>
                    </div>
                    <ReportStatusBadge status={r.status} />
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>
    </>
  );
}

export default function Dashboard() {
  const { profile, isAdmin } = useAuth();
  return (
    <>
      <PageHeader
        title="Genel Bakış"
        description={isAdmin ? "AKANA Roket Takımı kontrol merkezi — tüm veriler canlı veritabanından gelir." : `Hoş geldin, ${fullName(profile)}.`}
      />
      {isAdmin ? <AdminDashboard /> : <MemberDashboard />}
    </>
  );
}
