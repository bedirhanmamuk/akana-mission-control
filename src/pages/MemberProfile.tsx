import { Link, useParams } from "react-router-dom";
import { ArrowLeft, GraduationCap, Pencil, ShieldCheck } from "lucide-react";
import { useAuth } from "../context/AuthContext";
import { useAsync } from "../lib/useAsync";
import { fetchDepartments, fetchDirectory, fetchProjectList, fetchTasks } from "../lib/api";
import { CLOSED_STATUSES, POSITION_META } from "../lib/constants";
import { fullName } from "../lib/format";
import TCountdown from "../components/TCountdown";
import { Avatar, Badge, Card, ErrorState, LoadingState, SectionTitle, TaskStatusBadge, Unauthorized } from "../components/ui";

export default function MemberProfile() {
  const { id = "" } = useParams();
  const { profile, isAdmin } = useAuth();
  const { data, loading, error, reload } = useAsync(async () => {
    const [dir, departments, tasks, projects] = await Promise.all([fetchDirectory(), fetchDepartments(), fetchTasks(), fetchProjectList()]);
    const person = dir.find((d) => d.id === id) ?? null;
    return { person, departments, tasks: tasks.filter((t) => t.task_assignees.some((a) => a.user_id === id)), projects };
  }, [id]);

  if (loading && !data) return <LoadingState />;
  if (error) return <ErrorState message={error} onRetry={reload} />;
  if (!data?.person) return <Unauthorized />;
  const p = data.person;
  const dept = data.departments.find((d) => d.id === p.department_id);
  const leads = data.departments.filter((d) => d.lead_id === p.id);
  const active = data.tasks.filter((t) => !CLOSED_STATUSES.includes(t.status));
  const done = data.tasks.filter((t) => t.status === "COMPLETED" || t.status === "APPROVED");
  const projectIds = new Set(data.tasks.map((t) => t.project_id).filter(Boolean));
  const projects = data.projects.filter((pr) => projectIds.has(pr.id));
  const isMe = profile?.id === p.id;
  const position = POSITION_META[p.team_position ?? "MEMBER"].label;

  return (
    <>
      <Link to="/ekip" className="mb-4 inline-flex items-center gap-1.5 text-sm text-muted hover:text-ink"><ArrowLeft className="size-4" /> Ekip</Link>
      <Card className="mb-4 flex flex-col gap-5 p-6 sm:flex-row sm:items-center">
        <Avatar person={p} size={88} />
        <div className="min-w-0 flex-1">
          <h1 className="display text-2xl font-semibold sm:text-[28px]">{fullName(p)}</h1>
          <p className="text-accent-2">{p.title || position}</p>
          <p className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-muted">
            {dept && <Link to={`/departmanlar/${dept.id}`} className="hover:text-ink">{dept.name}</Link>}
            {(p.university || p.major) && <span className="inline-flex items-center gap-1"><GraduationCap className="size-4" /> {[p.university, p.major].filter(Boolean).join(" · ")}</span>}
          </p>
        </div>
        {(isMe || isAdmin) && <Link to={isMe ? "/profil" : "/yonetim/uyeler"} className="btn-secondary"><Pencil className="size-4" /> {isMe ? "Profilimi düzenle" : "Üye yönetimi"}</Link>}
      </Card>

      <div className="grid gap-4 lg:grid-cols-[320px_minmax(0,1fr)]">
        <div className="space-y-4">
          <Card className="p-5">
            <SectionTitle><span className="flex items-center gap-2"><ShieldCheck className="size-4 text-muted" /> Pozisyon ve yetkiler</span></SectionTitle>
            <ul className="space-y-2 text-sm">
              <li className="flex items-center justify-between gap-2"><span className="text-muted">Takım pozisyonu</span><Badge tone="accent">{position}</Badge></li>
              {leads.map((d) => <li key={d.id} className="flex items-center justify-between gap-2"><span className="text-muted">Sorumlu olduğu departman</span><span>{d.name}</span></li>)}
              <li className="rounded-lg bg-surface px-3 py-2 text-xs text-muted">
                {p.team_position === "CAPTAIN" || p.team_position === "VICE_CAPTAIN" ? "Kaptan ve kaptan yardımcısı yönetici yetkisiyle tüm modülleri yönetir."
                  : leads.length ? "Departman sorumlusu kendi departmanında görev oluşturur, atar, rapor ve doküman onaylar, takvime etkinlik ekler."
                  : "Takım üyesi atandığı görevleri yürütür, ilerleme ve rapor yükler, doküman ve risk kaydeder."}
              </li>
            </ul>
          </Card>
          <Card className="p-5">
            <SectionTitle>Teknik yetkinlikler</SectionTitle>
            {(p.skills ?? []).length === 0 ? <p className="text-sm text-muted">{isMe ? "Profil ekranından yetkinliklerinizi ekleyin." : "Yetkinlik eklenmemiş."}</p> : (
              <p className="flex flex-wrap gap-1.5">{p.skills!.map((s) => <span key={s} className="rounded-md bg-ink/6 px-2 py-1 text-xs">{s}</span>)}</p>
            )}
          </Card>
          <Card className="p-5">
            <SectionTitle>Katıldığı projeler</SectionTitle>
            {projects.length === 0 ? <p className="text-sm text-muted">Görebildiğiniz bir proje görevi yok.</p> : (
              <ul className="space-y-1.5">{projects.map((pr) => <li key={pr.id}><Link to={`/projeler/${pr.id}`} className="text-sm hover:text-accent-2"><span className="code-tag mr-2">{pr.code}</span>{pr.name}</Link></li>)}</ul>
            )}
          </Card>
        </div>
        <div className="space-y-4">
          <Card className="p-5">
            <SectionTitle aside={<span className="text-xs text-muted">{active.length}</span>}>Aktif görevler</SectionTitle>
            {active.length === 0 ? <p className="text-sm text-muted">Görebildiğiniz aktif görev yok.</p> : (
              <ul className="divide-y divide-line-soft">{active.map((t) => (
                <li key={t.id}><Link to={`/gorevler/${t.id}`} className="flex items-center gap-3 py-2.5 hover:opacity-80">
                  <span className="min-w-0 flex-1 truncate text-sm"><span className="code-tag mr-2">{t.code}</span>{t.title}</span>
                  <TCountdown dueDate={t.due_date} status={t.status} showDate={false} /><TaskStatusBadge status={t.status} />
                </Link></li>
              ))}</ul>
            )}
          </Card>
          <Card className="p-5">
            <SectionTitle aside={<span className="text-xs text-muted">{done.length}</span>}>Tamamlanan görevler</SectionTitle>
            {done.length === 0 ? <p className="text-sm text-muted">Görebildiğiniz tamamlanmış görev yok.</p> : (
              <ul className="divide-y divide-line-soft">{done.slice(0, 20).map((t) => (
                <li key={t.id}><Link to={`/gorevler/${t.id}`} className="flex items-center gap-3 py-2.5 hover:opacity-80">
                  <span className="min-w-0 flex-1 truncate text-sm"><span className="code-tag mr-2">{t.code}</span>{t.title}</span><TaskStatusBadge status={t.status} />
                </Link></li>
              ))}</ul>
            )}
          </Card>
        </div>
      </div>
    </>
  );
}
