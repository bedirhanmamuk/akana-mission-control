import { useState, type FormEvent } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { ArrowLeft, Pencil, Play, Trash2, Users } from "lucide-react";
import { supabase } from "../lib/supabase";
import { useAuth } from "../context/AuthContext";
import { useToast } from "../context/ToastContext";
import { unwrap, useAsync } from "../lib/useAsync";
import {
  canUploadNewVersion, fetchDirectory, fetchMaxFileSizeMb, fetchTask, fetchVersions, nameMap,
} from "../lib/api";
import { errorMessage } from "../lib/errors";
import { PRIORITIES, PRIORITY_META, TASK_STATUS_META, TASK_STATUSES } from "../lib/constants";
import { ALLOWED_EXTENSIONS } from "../lib/files";
import { formatDate, formatDateTime, fullName } from "../lib/format";
import type { DirectoryEntry, Report, TaskPriority, TaskStatus, TaskWithRelations } from "../lib/types";
import ReportUploadForm from "../components/ReportUploadForm";
import VersionHistory from "../components/VersionHistory";
import {
  Card, ErrorState, Field, InfoRow, LoadingState, Modal, PriorityBadge, ReportStatusBadge,
  SectionTitle, Spinner, TaskStatusBadge, Unauthorized,
} from "../components/ui";

function EditTaskModal({ task, onClose, onSaved }: { task: TaskWithRelations; onClose: () => void; onSaved: () => void }) {
  const toast = useToast();
  const [form, setForm] = useState({
    title: task.title, description: task.description, start_date: task.start_date, due_date: task.due_date,
    priority: task.priority, notes: task.notes, required_file_types: task.required_file_types,
  });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function save(e: FormEvent) {
    e.preventDefault();
    setError(null);
    if (form.title.trim().length < 3) return setError("Görev başlığı en az 3 karakter olmalıdır.");
    if (form.due_date < form.start_date) return setError("Son teslim tarihi başlangıç tarihinden önce olamaz.");
    setBusy(true);
    const { error: err } = await supabase.from("tasks").update({ ...form, title: form.title.trim() }).eq("id", task.id);
    setBusy(false);
    if (err) return setError(errorMessage(err));
    toast.success("Görev güncellendi.");
    onSaved();
  }

  return (
    <Modal open onClose={onClose} title={`${task.code} — görevi düzenle`} wide
      footer={<><button className="btn-secondary" onClick={onClose} disabled={busy}>Vazgeç</button>
        <button className="btn-primary" form="edit-task" type="submit" disabled={busy}>{busy && <Spinner className="size-4 text-white" />} Kaydet</button></>}>
      <form id="edit-task" onSubmit={save} className="space-y-4">
        <Field label="Görev başlığı" required><input className="input" value={form.title} maxLength={160} onChange={(e) => setForm({ ...form, title: e.target.value })} /></Field>
        <Field label="Açıklama"><textarea className="input min-h-28" value={form.description} maxLength={5000} onChange={(e) => setForm({ ...form, description: e.target.value })} /></Field>
        <div className="grid gap-4 sm:grid-cols-3">
          <Field label="Başlangıç" required><input type="date" className="input" value={form.start_date} onChange={(e) => setForm({ ...form, start_date: e.target.value })} /></Field>
          <Field label="Son teslim" required><input type="date" className="input" value={form.due_date} min={form.start_date} onChange={(e) => setForm({ ...form, due_date: e.target.value })} /></Field>
          <Field label="Öncelik"><select className="input" value={form.priority} onChange={(e) => setForm({ ...form, priority: e.target.value as TaskPriority })}>
            {PRIORITIES.map((p) => <option key={p} value={p}>{PRIORITY_META[p].label}</option>)}</select></Field>
        </div>
        <div>
          <span className="label">İstenen dosya türü</span>
          <div className="flex flex-wrap gap-2">
            {ALLOWED_EXTENSIONS.filter((x) => x !== "jpeg").map((ext) => {
              const on = form.required_file_types.includes(ext);
              return <button type="button" key={ext} aria-pressed={on}
                onClick={() => setForm({ ...form, required_file_types: on ? form.required_file_types.filter((x) => x !== ext) : [...form.required_file_types, ext] })}
                className={`min-h-9 rounded-md border px-2.5 font-mono text-xs uppercase ${on ? "border-accent bg-accent/20 text-accent-2" : "border-line text-muted hover:text-ink"}`}>{ext}</button>;
            })}
          </div>
        </div>
        <Field label="Ek açıklamalar"><textarea className="input min-h-16" value={form.notes} maxLength={2000} onChange={(e) => setForm({ ...form, notes: e.target.value })} /></Field>
        {error && <p className="rounded-lg border border-danger/40 bg-danger/10 px-3 py-2 text-sm text-danger" role="alert">{error}</p>}
      </form>
    </Modal>
  );
}

function AssigneesModal({ task, directory, onClose, onSaved }: {
  task: TaskWithRelations; directory: DirectoryEntry[]; onClose: () => void; onSaved: () => void;
}) {
  const toast = useToast();
  const [ids, setIds] = useState<string[]>(task.task_assignees.map((a) => a.user_id));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const people = directory.filter((d) => d.is_active || ids.includes(d.id))
    .sort((a, b) => Number(b.department_id === task.department_id) - Number(a.department_id === task.department_id));

  async function save() {
    setError(null);
    if (ids.length === 0) return setError("En az bir sorumlu seçilmelidir.");
    setBusy(true);
    const { error: err } = await supabase.rpc("set_task_assignees", { p_task_id: task.id, p_user_ids: ids });
    setBusy(false);
    if (err) return setError(errorMessage(err));
    toast.success("Sorumlular güncellendi.");
    onSaved();
  }

  return (
    <Modal open onClose={onClose} title="Sorumluları düzenle"
      footer={<><button className="btn-secondary" onClick={onClose} disabled={busy}>Vazgeç</button>
        <button className="btn-primary" onClick={() => void save()} disabled={busy}>{busy && <Spinner className="size-4 text-white" />} Kaydet</button></>}>
      <ul className="max-h-80 space-y-1 overflow-y-auto">
        {people.map((p) => (
          <li key={p.id}>
            <label className="flex min-h-10 cursor-pointer items-center gap-3 rounded-lg px-2 py-1.5 hover:bg-white/5">
              <input type="checkbox" className="size-4 accent-[#8065D8]" checked={ids.includes(p.id)}
                onChange={(e) => setIds(e.target.checked ? [...ids, p.id] : ids.filter((x) => x !== p.id))} />
              <span className="flex-1 text-sm">{fullName(p)}</span>
              {p.department_id === task.department_id && <span className="text-[11px] text-muted">{task.department?.name}</span>}
            </label>
          </li>
        ))}
      </ul>
      {error && <p className="mt-3 rounded-lg border border-danger/40 bg-danger/10 px-3 py-2 text-sm text-danger" role="alert">{error}</p>}
    </Modal>
  );
}

export default function TaskDetail() {
  const { id = "" } = useParams();
  const { profile, isAdmin } = useAuth();
  const uid = profile!.id;
  const toast = useToast();
  const navigate = useNavigate();
  const [modal, setModal] = useState<"edit" | "assignees" | "delete" | null>(null);
  const [busy, setBusy] = useState(false);

  const { data, loading, error, reload } = useAsync(async () => {
    const task = await fetchTask(id);
    if (!task) return null;
    const [dir, reports, maxMb] = await Promise.all([
      fetchDirectory(),
      supabase.from("reports").select("*").eq("task_id", id).order("updated_at", { ascending: false }).then(unwrap<Report[]>),
      fetchMaxFileSizeMb(),
    ]);
    const mine = reports.find((r) => r.uploaded_by === uid) ?? null;
    const versions = mine ? await fetchVersions(mine.id) : [];
    return { task, dir, names: nameMap(dir), reports, mine, versions, maxMb };
  }, [id, uid]);

  if (loading) return <LoadingState />;
  if (error) return <ErrorState message={error} onRetry={reload} />;
  // RLS görevi döndürmediyse: ya yok ya da yetki yok — ikisi de aynı ekranı görür.
  if (!data) return <Unauthorized />;

  const { task, names, reports, mine, versions } = data;
  const isAssignee = task.task_assignees.some((a) => a.user_id === uid);
  const canUpload = isAssignee && task.status !== "COMPLETED" && canUploadNewVersion(mine);

  async function run(fn: () => PromiseLike<{ error: unknown }>, ok: string) {
    setBusy(true);
    const { error: err } = await fn();
    setBusy(false);
    if (err) return toast.error(errorMessage(err));
    toast.success(ok);
    reload();
  }

  async function remove() {
    setBusy(true);
    const { error: err } = await supabase.from("tasks").delete().eq("id", task.id);
    setBusy(false);
    if (err) {
      setModal(null);
      return toast.error((err as { code?: string }).code === "23503"
        ? "Bu göreve rapor yüklendiği için silinemez. Rapor geçmişi korunur; görevi 'Tamamlandı' olarak işaretleyebilirsiniz."
        : errorMessage(err));
    }
    toast.success("Görev silindi.");
    navigate("/gorevler");
  }

  return (
    <>
      <Link to="/gorevler" className="mb-4 inline-flex items-center gap-1.5 text-sm text-muted hover:text-ink"><ArrowLeft className="size-4" /> Görevler</Link>
      <div className="mb-6 flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0">
          <div className="mb-2 flex flex-wrap items-center gap-2">
            <span className="code-tag text-sm" data-testid="task-code">{task.code}</span>
            <TaskStatusBadge status={task.status} />
            <PriorityBadge priority={task.priority} />
          </div>
          <h1 className="text-xl font-semibold tracking-tight sm:text-2xl">{task.title}</h1>
        </div>
        <div className="flex flex-wrap gap-2">
          {isAssignee && task.status === "NEW" && (
            <button className="btn-secondary" disabled={busy} onClick={() => void run(() => supabase.rpc("start_task", { p_task_id: task.id }), "Görev 'Devam ediyor' olarak işaretlendi.")}>
              <Play className="size-4" /> Göreve başla
            </button>
          )}
          {isAdmin && (
            <>
              <button className="btn-secondary" onClick={() => setModal("edit")}><Pencil className="size-4" /> Düzenle</button>
              <button className="btn-danger" onClick={() => setModal("delete")} aria-label="Görevi sil"><Trash2 className="size-4" /></button>
            </>
          )}
        </div>
      </div>

      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_340px]">
        <div className="space-y-4">
          <Card className="p-5">
            <SectionTitle>Görev açıklaması</SectionTitle>
            <p className="whitespace-pre-wrap text-sm leading-relaxed">{task.description || <span className="text-muted">Açıklama girilmemiş.</span>}</p>
            {task.notes && (
              <div className="mt-4 rounded-lg border border-line bg-surface p-3">
                <p className="text-xs font-semibold text-muted">Ek açıklamalar</p>
                <p className="mt-1 whitespace-pre-wrap text-sm">{task.notes}</p>
              </div>
            )}
          </Card>

          {isAssignee && (
            <Card className="p-5">
              <SectionTitle aside={mine && <ReportStatusBadge status={mine.status} />}>
                {mine ? "Raporum" : "Rapor yükle"}
              </SectionTitle>
              {mine?.review_note && ["REVISION_REQUESTED", "REJECTED"].includes(mine.status) && (
                <div className={`mb-4 rounded-lg border p-3 ${mine.status === "REJECTED" ? "border-danger/40 bg-danger/5" : "border-warning/40 bg-warning/5"}`} data-testid="revision-note">
                  <p className={`text-xs font-semibold ${mine.status === "REJECTED" ? "text-danger" : "text-warning"}`}>
                    {mine.status === "REJECTED" ? "Ret gerekçesi" : "Revizyon gerekçesi"}
                  </p>
                  <p className="mt-1 whitespace-pre-wrap text-sm">{mine.review_note}</p>
                </div>
              )}
              {canUpload ? (
                <ReportUploadForm task={task} existingReport={mine} maxFileSizeMb={data.maxMb} onDone={reload} />
              ) : (
                <p className="rounded-lg bg-surface px-3 py-3 text-sm text-muted">
                  {task.status === "COMPLETED" ? "Görev tamamlandı; yeni rapor yüklenemez."
                    : mine?.status === "APPROVED" ? "Raporunuz onaylandı."
                    : "Raporunuz inceleniyor; sonuçlanana kadar yeni sürüm yüklenemez."}
                </p>
              )}
              {versions.length > 0 && (
                <div className="mt-6">
                  <SectionTitle>Sürüm geçmişi</SectionTitle>
                  <VersionHistory versions={versions} currentVersion={mine!.current_version} names={names} />
                </div>
              )}
            </Card>
          )}

          {isAdmin && (
            <Card className="p-5">
              <SectionTitle aside={<span className="text-xs text-muted">{reports.length} rapor</span>}>Bu göreve yüklenen raporlar</SectionTitle>
              {reports.length === 0 ? <p className="text-sm text-muted">Henüz rapor yüklenmedi.</p> : (
                <ul className="divide-y divide-line-soft">
                  {reports.map((r) => (
                    <li key={r.id}>
                      <Link to={`/yonetim/rapor-inceleme/${r.id}`} className="flex items-center gap-3 py-2.5 hover:opacity-80">
                        <div className="min-w-0 flex-1">
                          <p className="truncate text-sm">{r.title}</p>
                          <p className="text-xs text-muted">{fullName(names.get(r.uploaded_by))} · V{r.current_version} · {formatDateTime(r.updated_at)}</p>
                        </div>
                        <ReportStatusBadge status={r.status} />
                      </Link>
                    </li>
                  ))}
                </ul>
              )}
            </Card>
          )}
        </div>

        <div className="space-y-4">
          <Card className="p-5">
            <SectionTitle>Görev bilgileri</SectionTitle>
            <dl className="divide-y divide-line-soft">
              <InfoRow label="Departman">{task.department?.name ?? "—"}</InfoRow>
              <InfoRow label="Başlangıç">{formatDate(task.start_date)}</InfoRow>
              <InfoRow label="Son teslim"><span data-testid="due-date">{formatDate(task.due_date)}</span></InfoRow>
              <InfoRow label="İstenen dosya">{task.required_file_types.length ? task.required_file_types.join(", ").toUpperCase() : "Belirtilmedi"}</InfoRow>
              <InfoRow label="Oluşturan">{task.created_by ? fullName(names.get(task.created_by)) : "—"}</InfoRow>
              <InfoRow label="Oluşturulma">{formatDateTime(task.created_at)}</InfoRow>
              {task.completed_at && <InfoRow label="Tamamlanma">{formatDateTime(task.completed_at)}</InfoRow>}
            </dl>
          </Card>

          <Card className="p-5">
            <SectionTitle aside={isAdmin && <button className="text-xs text-accent-2 hover:underline" onClick={() => setModal("assignees")}>Düzenle</button>}>
              <span className="flex items-center gap-2"><Users className="size-4" /> Sorumlular</span>
            </SectionTitle>
            <ul className="space-y-2">
              {task.task_assignees.length === 0 && <li className="text-sm text-muted">Sorumlu atanmadı.</li>}
              {task.task_assignees.map((a) => (
                <li key={a.user_id} className="flex items-center gap-2 text-sm">
                  <span className="flex size-7 items-center justify-center rounded-full bg-accent/20 text-[10px] font-semibold text-accent-2">
                    {(names.get(a.user_id)?.first_name[0] ?? "?").toLocaleUpperCase("tr-TR")}
                  </span>
                  {fullName(names.get(a.user_id))}{a.user_id === uid && <span className="text-xs text-muted">(siz)</span>}
                </li>
              ))}
            </ul>
          </Card>

          {isAdmin && (
            <Card className="p-5">
              <SectionTitle>Durum yönetimi</SectionTitle>
              <Field label="Görev durumu" hint="Durum, rapor yükleme ve inceleme adımlarında otomatik de güncellenir.">
                <select className="input" value={task.status} disabled={busy} name="task-status"
                  onChange={(e) => void run(() => supabase.from("tasks").update({ status: e.target.value as TaskStatus }).eq("id", task.id), "Görev durumu güncellendi.")}>
                  {TASK_STATUSES.map((s) => <option key={s} value={s}>{TASK_STATUS_META[s].label}</option>)}
                </select>
              </Field>
            </Card>
          )}
        </div>
      </div>

      {modal === "edit" && <EditTaskModal task={task} onClose={() => setModal(null)} onSaved={() => { setModal(null); reload(); }} />}
      {modal === "assignees" && <AssigneesModal task={task} directory={data.dir} onClose={() => setModal(null)} onSaved={() => { setModal(null); reload(); }} />}
      <Modal open={modal === "delete"} onClose={() => setModal(null)} title="Görevi sil"
        footer={<><button className="btn-secondary" onClick={() => setModal(null)} disabled={busy}>Vazgeç</button>
          <button className="btn-danger" onClick={() => void remove()} disabled={busy}>{busy && <Spinner className="size-4" />} Evet, sil</button></>}>
        <p className="text-sm"><span className="code-tag">{task.code}</span> görevi kalıcı olarak silinecek. Rapor yüklenmiş görevler silinemez.</p>
      </Modal>
    </>
  );
}
