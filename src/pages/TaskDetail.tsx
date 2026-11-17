import { useEffect, useMemo, useState, type FormEvent } from "react";
import { Link, useNavigate, useParams, useSearchParams } from "react-router-dom";
import {
  ArrowLeft, Ban, CornerDownRight, FileText, GitBranch, History, Link2, MessageSquare, Pencil, Play, Plus, Send,
  ShieldCheck, Trash2, Unlock, Users, X,
} from "lucide-react";
import { supabase } from "../lib/supabase";
import { useAuth } from "../context/AuthContext";
import { useToast } from "../context/ToastContext";
import { unwrap, useAsync } from "../lib/useAsync";
import {
  canUploadNewVersion, fetchComments, fetchDependencies, fetchDirectory, fetchDocuments, fetchMaxFileSizeMb,
  fetchProjectList, fetchSubtasks, fetchTask, fetchTaskHistory, fetchTasks, fetchVersions, nameMap,
} from "../lib/api";
import { errorMessage } from "../lib/errors";
import {
  ACTION_LABEL, CLOSED_STATUSES, DOCUMENT_CATEGORY_LABEL, PRIORITIES, PRIORITY_META, TASK_STATUS_META, TASK_STATUSES,
} from "../lib/constants";
import { PICKABLE_EXTENSIONS } from "../lib/files";
import { formatDate, formatDateTime, fullName, timeAgo } from "../lib/format";
import type { DirectoryEntry, Project, Report, TaskPriority, TaskStatus, TaskWithRelations } from "../lib/types";
import ReportUploadForm from "../components/ReportUploadForm";
import VersionHistory from "../components/VersionHistory";
import FlightProfile from "../components/FlightProfile";
import TCountdown from "../components/TCountdown";
import {
  Avatar, Card, DocumentStatusBadge, ErrorState, Field, FormError, InfoRow, LoadingState, Modal, PriorityBadge,
  ProgressBar, ReportStatusBadge, SectionTitle, Spinner, TaskStatusBadge, Unauthorized,
} from "../components/ui";

type ProjectLite = Pick<Project, "id" | "code" | "name" | "status">;

function EditTaskModal({ task, projects, onClose, onSaved }: {
  task: TaskWithRelations; projects: ProjectLite[]; onClose: () => void; onSaved: () => void;
}) {
  const toast = useToast();
  const [form, setForm] = useState({
    title: task.title, description: task.description, start_date: task.start_date, due_date: task.due_date,
    priority: task.priority, notes: task.notes, required_file_types: task.required_file_types,
    project_id: task.project_id ?? "", difficulty: task.difficulty,
  });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function save(e: FormEvent) {
    e.preventDefault();
    setError(null);
    if (form.title.trim().length < 3) return setError("Görev başlığı en az 3 karakter olmalıdır.");
    if (form.due_date < form.start_date) return setError("Son teslim tarihi başlangıç tarihinden önce olamaz.");
    setBusy(true);
    const { error: err } = await supabase.from("tasks")
      .update({ ...form, title: form.title.trim(), project_id: form.project_id || null }).eq("id", task.id);
    setBusy(false);
    if (err) return setError(errorMessage(err));
    toast.success("Görev güncellendi.");
    onSaved();
  }

  return (
    <Modal open onClose={onClose} title={`${task.code} — görevi düzenle`} wide
      footer={<><button className="btn-secondary" onClick={onClose} disabled={busy}>Vazgeç</button>
        <button className="btn-primary" form="edit-task" type="submit" disabled={busy}>{busy && <Spinner className="size-4 text-current" />} Kaydet</button></>}>
      <form id="edit-task" onSubmit={save} className="space-y-4">
        <Field label="Görev başlığı" required><input className="input" value={form.title} maxLength={160} onChange={(e) => setForm({ ...form, title: e.target.value })} /></Field>
        <Field label="Açıklama"><textarea className="input min-h-28" value={form.description} maxLength={5000} onChange={(e) => setForm({ ...form, description: e.target.value })} /></Field>
        <div className="grid gap-4 sm:grid-cols-3">
          <Field label="Başlangıç" required><input type="date" className="input" value={form.start_date} onChange={(e) => setForm({ ...form, start_date: e.target.value })} /></Field>
          <Field label="Son teslim" required><input type="date" className="input" value={form.due_date} min={form.start_date} onChange={(e) => setForm({ ...form, due_date: e.target.value })} /></Field>
          <Field label="Öncelik"><select className="input" value={form.priority} onChange={(e) => setForm({ ...form, priority: e.target.value as TaskPriority })}>
            {PRIORITIES.map((p) => <option key={p} value={p}>{PRIORITY_META[p].label}</option>)}</select></Field>
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Proje"><select className="input" value={form.project_id} onChange={(e) => setForm({ ...form, project_id: e.target.value })}>
            <option value="">Projesiz</option>
            {projects.map((p) => <option key={p.id} value={p.id}>{p.code} — {p.name}</option>)}</select></Field>
          <Field label="Zorluk (1–5)" hint="Performans puanında iş yükü ağırlığı olarak kullanılır.">
            <select className="input" value={form.difficulty} onChange={(e) => setForm({ ...form, difficulty: Number(e.target.value) })}>
              {[1, 2, 3, 4, 5].map((n) => <option key={n} value={n}>{n} — {["", "Çok kolay", "Kolay", "Orta", "Zor", "Çok zor"][n]}</option>)}</select></Field>
        </div>
        <div>
          <span className="label">İstenen dosya türü</span>
          <div className="flex flex-wrap gap-2">
            {PICKABLE_EXTENSIONS.map((ext) => {
              const on = form.required_file_types.includes(ext);
              return <button type="button" key={ext} aria-pressed={on}
                onClick={() => setForm({ ...form, required_file_types: on ? form.required_file_types.filter((x) => x !== ext) : [...form.required_file_types, ext] })}
                className={`min-h-9 rounded-md border px-2.5 font-mono text-xs uppercase ${on ? "border-accent bg-accent/20 text-accent-2" : "border-line text-muted hover:text-ink"}`}>{ext}</button>;
            })}
          </div>
        </div>
        <Field label="Ek açıklamalar"><textarea className="input min-h-16" value={form.notes} maxLength={2000} onChange={(e) => setForm({ ...form, notes: e.target.value })} /></Field>
        <FormError>{error}</FormError>
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
        <button className="btn-primary" onClick={() => void save()} disabled={busy}>{busy && <Spinner className="size-4 text-current" />} Kaydet</button></>}>
      <ul className="max-h-80 space-y-1 overflow-y-auto">
        {people.map((p) => (
          <li key={p.id}>
            <label className="flex min-h-10 cursor-pointer items-center gap-3 rounded-lg px-2 py-1.5 hover:bg-ink/5">
              <input type="checkbox" className="size-4" checked={ids.includes(p.id)}
                onChange={(e) => setIds(e.target.checked ? [...ids, p.id] : ids.filter((x) => x !== p.id))} />
              <Avatar person={p} size={26} />
              <span className="flex-1 text-sm">{fullName(p)}</span>
              {p.department_id === task.department_id && <span className="text-[11px] text-muted">{task.department?.name}</span>}
            </label>
          </li>
        ))}
      </ul>
      <div className="mt-3"><FormError>{error}</FormError></div>
    </Modal>
  );
}

function BlockModal({ task, onClose, onSaved }: { task: TaskWithRelations; onClose: () => void; onSaved: () => void }) {
  const toast = useToast();
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  async function save() {
    if (reason.trim().length < 3) return setError("Engelin ne olduğunu kısaca yazın (en az 3 karakter).");
    setBusy(true);
    const { error: err } = await supabase.rpc("set_task_blocked", { p_task_id: task.id, p_blocked: true, p_reason: reason });
    setBusy(false);
    if (err) return setError(errorMessage(err));
    toast.success("Görev bloke olarak işaretlendi; yöneticiler bilgilendirildi.");
    onSaved();
  }
  return (
    <Modal open onClose={onClose} title="Görevi bloke et"
      footer={<><button className="btn-secondary" onClick={onClose} disabled={busy}>Vazgeç</button>
        <button className="btn-danger" onClick={() => void save()} disabled={busy}>{busy ? <Spinner className="size-4" /> : <Ban className="size-4" />} Bloke et</button></>}>
      <Field label="Bloke nedeni" required hint="Örn. malzeme tedariki, bekleyen tasarım onayı, arızalı test düzeneği. Yöneticiye ve departman sorumlusuna iletilir.">
        <textarea className="input min-h-24" value={reason} maxLength={1000} onChange={(e) => setReason(e.target.value)} autoFocus />
      </Field>
      <div className="mt-3"><FormError>{error}</FormError></div>
    </Modal>
  );
}

function ProgressCard({ task, editable, onSaved }: { task: TaskWithRelations; editable: boolean; onSaved: () => void }) {
  const toast = useToast();
  const [value, setValue] = useState(task.progress);
  const [busy, setBusy] = useState(false);
  useEffect(() => setValue(task.progress), [task.progress]);
  const closed = CLOSED_STATUSES.includes(task.status);
  async function save() {
    setBusy(true);
    const { error } = await supabase.rpc("update_task_progress", { p_task_id: task.id, p_progress: value });
    setBusy(false);
    if (error) return toast.error(errorMessage(error));
    toast.success(`İlerleme %${value} olarak kaydedildi.`);
    onSaved();
  }
  return (
    <Card className="p-5">
      <SectionTitle aside={<span className="num text-2xl font-semibold tabular-nums">%{editable && !closed ? value : task.progress}</span>}>İlerleme</SectionTitle>
      {editable && !closed ? (
        <div className="space-y-3">
          <input type="range" min={0} max={100} step={5} value={value} onChange={(e) => setValue(Number(e.target.value))}
            className="w-full accent-[var(--color-accent)]" aria-label="İlerleme yüzdesi" />
          <div className="flex items-center justify-between gap-3">
            <p className="text-xs text-muted">Sorumlular ve departman sorumlusu güncelleyebilir. %0 üstü değer yeni görevi “Devam ediyor” yapar.</p>
            <button className="btn-secondary shrink-0" disabled={busy || value === task.progress} onClick={() => void save()}>
              {busy && <Spinner className="size-4" />} İlerlemeyi güncelle
            </button>
          </div>
        </div>
      ) : (
        <ProgressBar value={task.progress} tone={task.status === "BLOCKED" ? "danger" : task.progress >= 100 ? "success" : "accent"} />
      )}
    </Card>
  );
}

function Dependencies({ task, canManage, onChanged }: { task: TaskWithRelations; canManage: boolean; onChanged: () => void }) {
  const toast = useToast();
  const deps = useAsync(() => fetchDependencies(task.id), [task.id]);
  const [adding, setAdding] = useState(false);
  const [candidates, setCandidates] = useState<TaskWithRelations[]>([]);
  const [choice, setChoice] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!adding) return;
    void fetchTasks().then((all) => setCandidates(all.filter((t) => t.id !== task.id)), () => setCandidates([]));
  }, [adding, task.id]);

  async function add() {
    if (!choice) return;
    setBusy(true);
    const { error } = await supabase.rpc("add_task_dependency", { p_task_id: task.id, p_depends_on_id: choice });
    setBusy(false);
    if (error) return toast.error(errorMessage(error));
    toast.success("Ön koşul eklendi.");
    setAdding(false); setChoice("");
    deps.reload(); onChanged();
  }
  async function remove(dependsOn: string) {
    const { error } = await supabase.rpc("remove_task_dependency", { p_task_id: task.id, p_depends_on_id: dependsOn });
    if (error) return toast.error(errorMessage(error));
    toast.success("Bağımlılık kaldırıldı.");
    deps.reload(); onChanged();
  }

  const list = deps.data ?? [];
  const pre = list.filter((d) => d.direction === "depends_on");
  const post = list.filter((d) => d.direction === "blocks");
  const openPre = pre.filter((d) => !CLOSED_STATUSES.includes(d.status)).length;
  const existing = new Set(pre.map((d) => d.task_id));

  const row = (d: typeof list[number], removable: boolean) => (
    <li key={`${d.direction}-${d.task_id}`} className="flex items-center gap-3 py-2">
      <span className="min-w-0 flex-1">
        {d.can_open
          ? <Link to={`/gorevler/${d.task_id}`} className="block truncate text-sm hover:text-accent-2"><span className="code-tag mr-2">{d.code}</span>{d.title}</Link>
          : <span className="block truncate text-sm"><span className="code-tag mr-2">{d.code}</span>{d.title}</span>}
        <span className="block text-xs text-muted">{d.department_name} · teslim {formatDate(d.due_date)}</span>
      </span>
      <TaskStatusBadge status={d.status} />
      {removable && (
        <button className="flex size-9 items-center justify-center rounded-md text-muted hover:bg-danger/12 hover:text-danger" onClick={() => void remove(d.task_id)} aria-label={`${d.code} bağımlılığını kaldır`}>
          <X className="size-4" />
        </button>
      )}
    </li>
  );

  return (
    <Card className="p-5">
      <SectionTitle aside={canManage && !adding && <button className="text-xs text-accent-2 hover:underline" onClick={() => setAdding(true)}>Ön koşul ekle</button>}>
        <span className="flex items-center gap-2"><Link2 className="size-4 text-muted" /> Bağımlılıklar</span>
      </SectionTitle>
      {deps.loading && !deps.data ? <LoadingState variant="compact" /> : (
        <>
          {openPre > 0 && (
            <p className="mb-3 rounded-lg bg-warning/10 px-3 py-2 text-xs text-warning">
              {openPre} ön koşul görevi henüz tamamlanmadı. Ön koşullar bitmeden bu görev “Tamamlandı” yapılamaz.
            </p>
          )}
          <p className="text-xs font-medium text-faint">Bu görevin beklediği (ön koşul)</p>
          {pre.length === 0 ? <p className="py-2 text-sm text-muted">Ön koşul tanımlanmamış.</p> : <ul className="divide-y divide-line-soft">{pre.map((d) => row(d, canManage))}</ul>}
          <p className="mt-4 text-xs font-medium text-faint">Bu görevi bekleyenler</p>
          {post.length === 0 ? <p className="py-2 text-sm text-muted">Bu göreve bağlı başka görev yok.</p> : <ul className="divide-y divide-line-soft">{post.map((d) => row(d, false))}</ul>}
        </>
      )}
      {adding && (
        <div className="mt-4 flex flex-col gap-2 rounded-xl bg-surface p-3 sm:flex-row">
          <select className="input flex-1" value={choice} onChange={(e) => setChoice(e.target.value)} aria-label="Ön koşul görevi">
            <option value="">Ön koşul görevi seçin (departmanlar arası olabilir)…</option>
            {candidates.filter((c) => !existing.has(c.id)).map((c) => <option key={c.id} value={c.id}>{c.code} — {c.title} ({c.department?.name})</option>)}
          </select>
          <div className="flex gap-2">
            <button className="btn-secondary flex-1" onClick={() => { setAdding(false); setChoice(""); }}>Vazgeç</button>
            <button className="btn-primary flex-1" disabled={!choice || busy} onClick={() => void add()}>{busy && <Spinner className="size-4 text-current" />} Ekle</button>
          </div>
        </div>
      )}
    </Card>
  );
}

function Comments({ taskId, names, uid, canModerate }: { taskId: string; names: Map<string, DirectoryEntry>; uid: string; canModerate: boolean }) {
  const toast = useToast();
  const { data, loading, reload } = useAsync(() => fetchComments(taskId), [taskId]);
  const [body, setBody] = useState("");
  const [busy, setBusy] = useState(false);

  async function send(e: FormEvent) {
    e.preventDefault();
    const text = body.trim();
    if (!text) return;
    setBusy(true);
    const { error } = await supabase.from("task_comments").insert({ task_id: taskId, body: text });
    setBusy(false);
    if (error) return toast.error(errorMessage(error));
    setBody("");
    reload();
  }
  async function remove(id: string) {
    const { error } = await supabase.from("task_comments").delete().eq("id", id);
    if (error) return toast.error(errorMessage(error));
    reload();
  }

  return (
    <Card className="p-5">
      <SectionTitle aside={<span className="text-xs text-muted">{data?.length ?? 0} yorum</span>}>
        <span className="flex items-center gap-2"><MessageSquare className="size-4 text-muted" /> Yorumlar</span>
      </SectionTitle>
      {loading && !data ? <LoadingState variant="compact" /> : (data ?? []).length === 0 ? (
        <p className="pb-3 text-sm text-muted">Henüz yorum yok. Görevle ilgili soru, karar veya durum notu yazabilirsiniz; sorumlulara bildirim gider.</p>
      ) : (
        <ul className="mb-4 space-y-4" data-testid="comment-list">
          {data!.map((c) => {
            const author = c.author_id ? names.get(c.author_id) : undefined;
            return (
              <li key={c.id} className="flex gap-3" data-testid="comment-item">
                <Avatar person={author} size={32} />
                <div className="min-w-0 flex-1">
                  <p className="flex flex-wrap items-baseline gap-x-2 text-sm">
                    <span className="font-medium">{author ? fullName(author) : "Eski üye"}</span>
                    <span className="text-xs text-muted" title={formatDateTime(c.created_at)}>{timeAgo(c.created_at)}{c.updated_at !== c.created_at && " · düzenlendi"}</span>
                  </p>
                  <p className="mt-0.5 whitespace-pre-wrap break-words text-sm leading-relaxed">{c.body}</p>
                </div>
                {(c.author_id === uid || canModerate) && (
                  <button className="flex size-8 shrink-0 items-center justify-center rounded-md text-faint hover:bg-danger/12 hover:text-danger" onClick={() => void remove(c.id)} aria-label="Yorumu sil">
                    <Trash2 className="size-3.5" />
                  </button>
                )}
              </li>
            );
          })}
        </ul>
      )}
      <form onSubmit={send} className="flex items-end gap-2">
        <textarea className="input min-h-11 flex-1 resize-y" rows={2} placeholder="Yorum yazın…" value={body} maxLength={4000}
          onChange={(e) => setBody(e.target.value)} aria-label="Yorum"
          onKeyDown={(e) => { if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) { e.preventDefault(); void send(e as unknown as FormEvent); } }} />
        <button className="btn-primary shrink-0" disabled={busy || !body.trim()} aria-label="Yorumu gönder">{busy ? <Spinner className="size-4 text-current" /> : <Send className="size-4" />}<span className="hidden sm:inline">Gönder</span></button>
      </form>
    </Card>
  );
}

function HistoryCard({ taskId }: { taskId: string }) {
  const [open, setOpen] = useState(false);
  const { data, loading } = useAsync(async () => (open ? fetchTaskHistory(taskId) : []), [taskId, open]);
  return (
    <Card className="p-5">
      <SectionTitle aside={<button className="text-xs text-accent-2 hover:underline" onClick={() => setOpen((o) => !o)} aria-expanded={open}>{open ? "Gizle" : "Göster"}</button>}>
        <span className="flex items-center gap-2"><History className="size-4 text-muted" /> Görev geçmişi</span>
      </SectionTitle>
      {!open ? <p className="text-sm text-muted">Oluşturma, atama, durum, ilerleme, rapor ve yorum kayıtlarının zaman çizelgesi.</p>
        : loading ? <LoadingState variant="compact" /> : (data ?? []).length === 0 ? <p className="text-sm text-muted">Kayıt yok.</p> : (
          <ol className="relative space-y-3 before:absolute before:top-1 before:bottom-1 before:left-[3px] before:w-px before:bg-line" data-testid="task-history">
            {data!.map((h) => (
              <li key={h.id} className="relative pl-5">
                <span className="absolute top-1.5 left-0 size-[7px] rounded-full bg-accent" />
                <p className="text-sm">{h.summary || ACTION_LABEL[h.action] || h.action}</p>
                <p className="text-xs text-muted">{ACTION_LABEL[h.action] ?? h.action} · {h.actor} · {formatDateTime(h.created_at)}</p>
              </li>
            ))}
          </ol>
        )}
    </Card>
  );
}

export default function TaskDetail() {
  const { id = "" } = useParams();
  const { profile, canManageDepartment } = useAuth();
  const uid = profile!.id;
  const toast = useToast();
  const navigate = useNavigate();
  const [modal, setModal] = useState<"edit" | "assignees" | "delete" | "block" | null>(null);
  const [params, setParams] = useSearchParams();
  const [busy, setBusy] = useState(false);

  const { data, loading, error, reload, refresh } = useAsync(async () => {
    const task = await fetchTask(id);
    if (!task) return null;
    const [dir, reports, maxMb, subtasks, docs, projects, parent] = await Promise.all([
      fetchDirectory(),
      supabase.from("reports").select("*").eq("task_id", id).order("updated_at", { ascending: false }).then(unwrap<Report[]>),
      fetchMaxFileSizeMb(),
      fetchSubtasks(id),
      fetchDocuments({ taskId: id }),
      fetchProjectList(),
      task.parent_id ? fetchTask(task.parent_id).catch(() => null) : Promise.resolve(null),
    ]);
    const mine = reports.find((r) => r.uploaded_by === uid) ?? null;
    const versions = mine ? await fetchVersions(mine.id) : [];
    return { task, dir, names: nameMap(dir), reports, mine, versions, maxMb, subtasks, docs, projects, parent };
  }, [id, uid]);

  const canManage = useMemo(() => (data ? canManageDepartment(data.task.department_id) : false), [data, canManageDepartment]);

  // Görev listesindeki "düzenle / sil" kısayolları: ?islem=duzenle | sil
  const action = params.get("islem");
  const ready = Boolean(data);
  useEffect(() => {
    if (!ready || !action) return;
    if (canManage) setModal(action === "duzenle" ? "edit" : action === "sil" ? "delete" : null);
    setParams({}, { replace: true });
  }, [ready, action, canManage, setParams]);

  if (loading && !data) return <LoadingState />;
  if (error) return <ErrorState message={error} onRetry={reload} />;
  // RLS görevi döndürmediyse: ya yok ya da yetki yok — ikisi de aynı ekranı görür.
  if (!data) return <Unauthorized />;

  const { task, names, reports, mine, versions, subtasks, docs, projects, parent } = data;
  const isAssignee = task.task_assignees.some((a) => a.user_id === uid);
  const canUpload = isAssignee && task.status !== "COMPLETED" && task.status !== "CANCELLED" && canUploadNewVersion(mine);
  const closed = CLOSED_STATUSES.includes(task.status);
  const project = projects.find((p) => p.id === task.project_id);

  async function run(fn: () => PromiseLike<{ error: unknown }>, ok: string) {
    setBusy(true);
    const { error: err } = await fn();
    setBusy(false);
    if (err) return toast.error(errorMessage(err));
    toast.success(ok);
    refresh();
  }

  async function remove() {
    setBusy(true);
    const { error: err } = await supabase.from("tasks").delete().eq("id", task.id);
    setBusy(false);
    if (err) {
      setModal(null);
      return toast.error((err as { code?: string }).code === "23503"
        ? "Bu göreve rapor yüklendiği için silinemez. Rapor geçmişi korunur; görevi 'Tamamlandı' veya 'İptal edildi' olarak işaretleyebilirsiniz."
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
            <span key={task.status} className="inline-flex animate-pop"><TaskStatusBadge status={task.status} /></span>
            <PriorityBadge priority={task.priority} />
            <TCountdown dueDate={task.due_date} status={task.status} showDate={false} />
          </div>
          <h1 className="display text-2xl font-semibold sm:text-[28px]">{task.title}</h1>
          {(parent || project) && (
            <p className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-muted">
              {project && <Link to={`/projeler/${project.id}`} className="hover:text-accent-2">Proje: <span className="code-tag">{project.code}</span> {project.name}</Link>}
              {parent && <Link to={`/gorevler/${parent.id}`} className="inline-flex items-center gap-1 hover:text-accent-2"><CornerDownRight className="size-3.5" /> Üst görev: <span className="code-tag">{parent.code}</span></Link>}
            </p>
          )}
        </div>
        <div className="flex flex-wrap gap-2 [&>*]:flex-1 sm:[&>*]:flex-none">
          {isAssignee && task.status === "NEW" && (
            <button className="btn-secondary" disabled={busy} onClick={() => void run(() => supabase.rpc("start_task", { p_task_id: task.id }), "Görev 'Devam ediyor' olarak işaretlendi.")}>
              <Play className="size-4" /> Göreve başla
            </button>
          )}
          {(isAssignee || canManage) && !closed && (task.status === "BLOCKED" ? (
            <button className="btn-secondary" disabled={busy} onClick={() => void run(() => supabase.rpc("set_task_blocked", { p_task_id: task.id, p_blocked: false }), "Blokaj kaldırıldı; görev 'Devam ediyor'.")}>
              <Unlock className="size-4" /> Blokajı kaldır
            </button>
          ) : (
            <button className="btn-secondary" onClick={() => setModal("block")}><Ban className="size-4" /> Bloke et</button>
          ))}
          {canManage && (
            <>
              <button className="btn-secondary" onClick={() => setModal("edit")}><Pencil className="size-4" /> Düzenle</button>
              <button className="btn-danger" onClick={() => setModal("delete")}><Trash2 className="size-4" /> Sil</button>
            </>
          )}
        </div>
      </div>

      {task.status === "BLOCKED" && (
        <div className="mb-4 flex items-start gap-3 rounded-2xl bg-danger/10 px-4 py-3" role="status" data-testid="blocked-banner">
          <Ban className="mt-0.5 size-5 shrink-0 text-danger" />
          <div>
            <p className="text-sm font-medium text-danger">Görev bloke</p>
            <p className="text-sm">{task.blocked_reason || "Neden belirtilmedi."}</p>
          </div>
        </div>
      )}

      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_340px]">
        <div className="min-w-0 space-y-4">
          <Card className="px-5 pt-5 pb-9">
            <SectionTitle>Görev aşaması</SectionTitle>
            <FlightProfile status={task.status} />
          </Card>
          <Card className="p-5">
            <SectionTitle>Görev açıklaması</SectionTitle>
            <p className="whitespace-pre-wrap text-sm leading-relaxed">{task.description || <span className="text-muted">Açıklama girilmemiş.</span>}</p>
            {task.notes && (
              <div className="mt-4 rounded-lg bg-surface p-3">
                <p className="text-xs font-semibold text-muted">Ek açıklamalar</p>
                <p className="mt-1 whitespace-pre-wrap text-sm">{task.notes}</p>
              </div>
            )}
          </Card>

          <ProgressCard task={task} editable={isAssignee || canManage} onSaved={refresh} />

          {!task.parent_id && (
            <Card className="p-5">
              <SectionTitle aside={canManage && <Link to={`/yonetim/gorev-olustur?ust=${task.id}`} className="inline-flex items-center gap-1 text-xs text-accent-2 hover:underline"><Plus className="size-3.5" /> Alt görev ekle</Link>}>
                <span className="flex items-center gap-2"><GitBranch className="size-4 text-muted" /> Alt görevler</span>
              </SectionTitle>
              {subtasks.length === 0 ? <p className="text-sm text-muted">Alt görev yok. Büyük işleri sorumlusu ve teslim tarihi ayrı parçalara bölebilirsiniz.</p> : (
                <>
                  <ProgressBar className="mb-3" value={(subtasks.filter((s) => ["COMPLETED", "APPROVED"].includes(s.status)).length / subtasks.length) * 100} tone="success"
                    label="Tamamlanan alt görev oranı" />
                  <ul className="divide-y divide-line-soft" data-testid="subtask-list">
                    {subtasks.map((s) => (
                      <li key={s.id}>
                        <Link to={`/gorevler/${s.id}`} className="flex items-center gap-3 py-2.5 hover:opacity-80">
                          <span className="min-w-0 flex-1">
                            <span className="block truncate text-sm"><span className="code-tag mr-2">{s.code}</span>{s.title}</span>
                            <span className="block text-xs text-muted">{s.task_assignees.map((a) => fullName(names.get(a.user_id))).join(", ") || "—"} · %{s.progress}</span>
                          </span>
                          <TCountdown dueDate={s.due_date} status={s.status} showDate={false} />
                          <TaskStatusBadge status={s.status} />
                        </Link>
                      </li>
                    ))}
                  </ul>
                </>
              )}
            </Card>
          )}

          <Dependencies task={task} canManage={canManage} onChanged={refresh} />

          {isAssignee && (
            <Card className="p-5">
              <SectionTitle aside={mine && <ReportStatusBadge status={mine.status} />}>
                {mine ? "Raporum (tamamlanma kanıtı)" : "Rapor yükle (tamamlanma kanıtı)"}
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
                    : task.status === "CANCELLED" ? "Görev iptal edildi."
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

          {canManage && (
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

          <Card className="p-5">
            <SectionTitle aside={<Link to={`/dokumanlar?gorev=${task.id}&yeni=1`} className="inline-flex items-center gap-1 text-xs text-accent-2 hover:underline"><Plus className="size-3.5" /> Dosya ekle</Link>}>
              <span className="flex items-center gap-2"><FileText className="size-4 text-muted" /> Ek dosyalar ve dokümanlar</span>
            </SectionTitle>
            {docs.length === 0 ? <p className="text-sm text-muted">Bu göreve bağlı doküman yok. CAD modelleri, analiz dosyaları ve test verileri Doküman Merkezi'nden göreve bağlanır.</p> : (
              <ul className="divide-y divide-line-soft">
                {docs.map((d) => (
                  <li key={d.id}>
                    <Link to={`/dokumanlar/${d.id}`} className="flex items-center gap-3 py-2.5 hover:opacity-80">
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-sm"><span className="code-tag mr-2">{d.code}</span>{d.title}</span>
                        <span className="block text-xs text-muted">{DOCUMENT_CATEGORY_LABEL[d.category]} · V{d.current_version}</span>
                      </span>
                      <DocumentStatusBadge status={d.status} />
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </Card>

          <Comments taskId={task.id} names={names} uid={uid} canModerate={canManage} />
          <HistoryCard taskId={task.id} />
        </div>

        <div className="space-y-4">
          <Card className="p-5">
            <SectionTitle>Görev bilgileri</SectionTitle>
            <dl className="divide-y divide-line-soft">
              <InfoRow label="Departman">{task.department ? <Link to={`/departmanlar/${task.department.id}`} className="hover:text-accent-2">{task.department.name}</Link> : "—"}</InfoRow>
              <InfoRow label="Proje">{project ? <Link to={`/projeler/${project.id}`} className="hover:text-accent-2">{project.code} — {project.name}</Link> : "—"}</InfoRow>
              <InfoRow label="Başlangıç">{formatDate(task.start_date)}</InfoRow>
              <InfoRow label="Son teslim"><span data-testid="due-date">{formatDate(task.due_date)}</span></InfoRow>
              <InfoRow label="Zorluk">{task.difficulty} / 5</InfoRow>
              <InfoRow label="İstenen dosya">{task.required_file_types.length ? task.required_file_types.join(", ").toUpperCase() : "Belirtilmedi"}</InfoRow>
              <InfoRow label="Oluşturan">{task.created_by ? fullName(names.get(task.created_by)) : "—"}</InfoRow>
              <InfoRow label="Oluşturulma">{formatDateTime(task.created_at)}</InfoRow>
              {task.completed_at && <InfoRow label="Tamamlanma">{formatDateTime(task.completed_at)}</InfoRow>}
            </dl>
          </Card>

          <Card className="p-5">
            <SectionTitle aside={canManage && <button className="text-xs text-accent-2 hover:underline" onClick={() => setModal("assignees")}>Düzenle</button>}>
              <span className="flex items-center gap-2"><Users className="size-4" /> Sorumlular</span>
            </SectionTitle>
            <ul className="space-y-2">
              {task.task_assignees.length === 0 && <li className="text-sm text-muted">Sorumlu atanmadı.</li>}
              {task.task_assignees.map((a) => (
                <li key={a.user_id}>
                  <Link to={`/ekip/${a.user_id}`} className="flex items-center gap-2 text-sm hover:text-accent-2">
                    <Avatar person={names.get(a.user_id)} size={28} />
                    {fullName(names.get(a.user_id))}{a.user_id === uid && <span className="text-xs text-muted">(siz)</span>}
                  </Link>
                </li>
              ))}
            </ul>
          </Card>

          {canManage && (
            <Card className="p-5">
              <SectionTitle><span className="flex items-center gap-2"><ShieldCheck className="size-4 text-muted" /> Durum yönetimi</span></SectionTitle>
              <Field label="Görev durumu" hint="Durum rapor yükleme ve inceleme adımlarında otomatik de güncellenir. Bloke için nedenli “Bloke et” düğmesini kullanın.">
                <select className="input" value={task.status} disabled={busy} name="task-status"
                  onChange={(e) => void run(() => supabase.from("tasks").update({ status: e.target.value as TaskStatus }).eq("id", task.id), "Görev durumu güncellendi.")}>
                  {TASK_STATUSES.map((s) => <option key={s} value={s}>{TASK_STATUS_META[s].label}</option>)}
                </select>
              </Field>
            </Card>
          )}
        </div>
      </div>

      {modal === "edit" && <EditTaskModal task={task} projects={projects} onClose={() => setModal(null)} onSaved={() => { setModal(null); reload(); }} />}
      {modal === "assignees" && <AssigneesModal task={task} directory={data.dir} onClose={() => setModal(null)} onSaved={() => { setModal(null); reload(); }} />}
      {modal === "block" && <BlockModal task={task} onClose={() => setModal(null)} onSaved={() => { setModal(null); refresh(); }} />}
      <Modal open={modal === "delete"} onClose={() => setModal(null)} title="Görevi sil"
        footer={<><button className="btn-secondary" onClick={() => setModal(null)} disabled={busy}>Vazgeç</button>
          <button className="btn-danger" onClick={() => void remove()} disabled={busy}>{busy && <Spinner className="size-4" />} Evet, sil</button></>}>
        <p className="text-sm"><span className="code-tag">{task.code}</span> görevi kalıcı olarak silinecek. Rapor yüklenmiş görevler silinemez; alt görevler üst görevden ayrılır.</p>
      </Modal>
    </>
  );
}
