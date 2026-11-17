import { useEffect, useMemo, useState, type FormEvent } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { FilePlus2, UsersRound } from "lucide-react";
import { supabase } from "../../lib/supabase";
import { useToast } from "../../context/ToastContext";
import { useAuth } from "../../context/AuthContext";
import { useAsync } from "../../lib/useAsync";
import { fetchDepartments, fetchDirectory, fetchProjectList, fetchTask } from "../../lib/api";
import { errorMessage } from "../../lib/errors";
import { PRIORITIES, PRIORITY_META } from "../../lib/constants";
import { PICKABLE_EXTENSIONS } from "../../lib/files";
import { fullName, todayISO } from "../../lib/format";
import type { Task, TaskPriority } from "../../lib/types";
import { Card, ErrorState, Field, LoadingState, PageHeader, Spinner } from "../../components/ui";

export default function TaskCreate() {
  const toast = useToast();
  const navigate = useNavigate();
  const { canManageDepartment, isAdmin } = useAuth();
  const [params] = useSearchParams();
  const parentId = params.get("ust");
  const presetProject = params.get("proje") ?? "";
  const [form, setForm] = useState({
    title: "", description: "", department_id: "", start_date: todayISO(), due_date: "",
    priority: "NORMAL" as TaskPriority, notes: "", project_id: presetProject, difficulty: 3,
  });
  const [types, setTypes] = useState<string[]>([]);
  const [assignees, setAssignees] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const { data, loading, error: loadError, reload } = useAsync(async () => {
    const [departments, people, projects, parent] = await Promise.all([
      fetchDepartments(), fetchDirectory(), fetchProjectList(), parentId ? fetchTask(parentId) : Promise.resolve(null),
    ]);
    return {
      // Departman sorumlusu yalnızca kendi departmanlarına görev açabilir (sunucu da zorlar)
      departments: departments.filter((d) => d.is_active && canManageDepartment(d.id)),
      people: people.filter((p) => p.is_active),
      projects: projects.filter((p) => p.status !== "CANCELLED" && p.status !== "COMPLETED"),
      parent,
    };
  }, [parentId, canManageDepartment]);

  // Alt görev: üst görevin departmanı ve projesi önceden seçilir
  useEffect(() => {
    if (!data?.parent) return;
    const p = data.parent;
    setForm((f) => ({
      ...f,
      department_id: data.departments.some((d) => d.id === p.department_id) ? p.department_id : f.department_id,
      project_id: p.project_id ?? f.project_id,
    }));
  }, [data]);

  const dept = data?.departments.find((d) => d.id === form.department_id) ?? null;
  const { deptPeople, otherPeople } = useMemo(() => {
    const people = data?.people ?? [];
    return {
      deptPeople: people.filter((p) => p.department_id === form.department_id),
      otherPeople: people.filter((p) => p.department_id !== form.department_id),
    };
  }, [data, form.department_id]);

  const toggle = (id: string) => setAssignees((a) => (a.includes(id) ? a.filter((x) => x !== id) : [...a, id]));

  async function submit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    if (form.title.trim().length < 3) return setError("Görev başlığı en az 3 karakter olmalıdır.");
    if (!form.department_id) return setError("İlgili departmanı seçin.");
    if (!form.due_date) return setError("Son teslim tarihini seçin.");
    if (form.due_date < form.start_date) return setError("Son teslim tarihi başlangıç tarihinden önce olamaz.");
    if (assignees.length === 0) return setError("En az bir sorumlu kişi seçin.");
    setBusy(true);
    const { data: task, error: err } = await supabase.rpc("create_task", {
      p_title: form.title, p_description: form.description, p_department_id: form.department_id,
      p_start_date: form.start_date, p_due_date: form.due_date, p_priority: form.priority,
      p_required_file_types: types, p_notes: form.notes, p_assignee_ids: assignees,
      p_project_id: form.project_id || null, p_parent_id: data?.parent?.id ?? null, p_difficulty: form.difficulty,
    });
    setBusy(false);
    if (err) return setError(errorMessage(err));
    const t = task as Task;
    toast.success(`${t.code} görevi oluşturuldu; sorumlulara bildirim gönderildi.`);
    navigate(`/gorevler/${t.id}`);
  }

  if (loading) return <><PageHeader title="Görev Oluştur" /><LoadingState /></>;
  if (loadError || !data) return <><PageHeader title="Görev Oluştur" /><ErrorState message={loadError ?? ""} onRetry={reload} /></>;

  const PersonRow = ({ id, name }: { id: string; name: string }) => (
    <label className="flex min-h-10 cursor-pointer items-center gap-3 rounded-lg px-2 py-1.5 hover:bg-ink/5">
      <input type="checkbox" className="size-4" checked={assignees.includes(id)} onChange={() => toggle(id)} data-testid="assignee-checkbox" />
      <span className="text-sm">{name}</span>
    </label>
  );

  return (
    <>
      <PageHeader title={data.parent ? "Alt Görev Oluştur" : "Görev Oluştur"}
        description={data.parent ? `${data.parent.code} — ${data.parent.title} görevinin altına bir iş paketi ekleyin.` : isAdmin ? "Görevi tanımlayın ve sorumlularını seçin. Görev kodu otomatik verilir." : "Departmanınıza görev tanımlayın. Görev kodu otomatik verilir."} />
      {data.departments.length === 0 && (
        <p className="mb-4 rounded-lg bg-warning/10 px-3 py-2 text-sm text-warning">Görev oluşturabileceğiniz aktif bir departman yok.</p>
      )}
      <form onSubmit={submit} className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_360px]" noValidate>
        <Card className="space-y-4 p-5">
          <Field label="Görev başlığı" required>
            <input className="input" value={form.title} maxLength={160} onChange={(e) => setForm({ ...form, title: e.target.value })} name="title" placeholder="Örn. Motor bloğu yapısal analiz raporu" />
          </Field>
          <Field label="Görev açıklaması">
            <textarea className="input min-h-32" value={form.description} maxLength={5000} onChange={(e) => setForm({ ...form, description: e.target.value })} name="description"
              placeholder="Kapsam, beklenen çıktı, kabul ölçütü" />
          </Field>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="İlgili departman" required>
              <select className="input" value={form.department_id} name="department"
                onChange={(e) => { setForm({ ...form, department_id: e.target.value }); setAssignees([]); }}>
                <option value="">Departman seçin…</option>
                {data.departments.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
              </select>
            </Field>
            <Field label="Görev kodu" hint="Kaydedildiğinde sistem tarafından atanır.">
              <input className="input font-mono" readOnly disabled value={dept ? `AK-${dept.code}-${String(dept.task_seq + 1).padStart(3, "0")}` : "AK-___-000"} data-testid="code-preview" />
            </Field>
          </div>
          <div className="grid gap-4 sm:grid-cols-3">
            <Field label="Başlangıç tarihi" required><input type="date" className="input" value={form.start_date} onChange={(e) => setForm({ ...form, start_date: e.target.value })} name="start_date" /></Field>
            <Field label="Son teslim tarihi" required><input type="date" className="input" value={form.due_date} min={form.start_date} onChange={(e) => setForm({ ...form, due_date: e.target.value })} name="due_date" /></Field>
            <Field label="Öncelik" required>
              <select className="input" value={form.priority} onChange={(e) => setForm({ ...form, priority: e.target.value as TaskPriority })} name="priority">
                {PRIORITIES.map((p) => <option key={p} value={p}>{PRIORITY_META[p].label}</option>)}
              </select>
            </Field>
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Proje" hint="Görev, projenin ilerleme ve Gantt hesabına dahil edilir.">
              <select className="input" value={form.project_id} name="project" onChange={(e) => setForm({ ...form, project_id: e.target.value })}>
                <option value="">Projesiz</option>
                {data.projects.map((p) => <option key={p.id} value={p.id}>{p.code} — {p.name}</option>)}
              </select>
            </Field>
            <Field label="Zorluk" hint="1 çok kolay – 5 çok zor. Performans puanında ağırlık olarak kullanılır.">
              <select className="input" value={form.difficulty} name="difficulty" onChange={(e) => setForm({ ...form, difficulty: Number(e.target.value) })}>
                {[1, 2, 3, 4, 5].map((n) => <option key={n} value={n}>{n} — {["", "Çok kolay", "Kolay", "Orta", "Zor", "Çok zor"][n]}</option>)}
              </select>
            </Field>
          </div>
          <div>
            <span className="label">İstenen dosya türü</span>
            <div className="flex flex-wrap gap-2">
              {PICKABLE_EXTENSIONS.map((ext) => {
                const on = types.includes(ext);
                return <button type="button" key={ext} aria-pressed={on} onClick={() => setTypes(on ? types.filter((x) => x !== ext) : [...types, ext])}
                  className={`min-h-9 rounded-md border px-2.5 font-mono text-xs uppercase transition-colors ${on ? "border-accent bg-accent/20 text-accent-2" : "border-line text-muted hover:text-ink"}`}>{ext}</button>;
              })}
            </div>
            <span className="mt-1 block text-xs text-muted">Seçilmezse izin verilen tüm türler kabul edilir.</span>
          </div>
          <Field label="Ek açıklamalar">
            <textarea className="input min-h-20" value={form.notes} maxLength={2000} onChange={(e) => setForm({ ...form, notes: e.target.value })} name="notes" placeholder="Referans, şablon, dikkat edilecekler" />
          </Field>
        </Card>

        <div className="space-y-4">
          <Card className="p-5">
            <div className="mb-3 flex items-center justify-between">
              <h2 className="text-sm font-semibold">Sorumlu kişi veya ekip <span className="text-danger">*</span></h2>
              <span className="text-xs text-muted">{assignees.length} seçili</span>
            </div>
            {!form.department_id ? (
              <p className="rounded-lg bg-surface px-3 py-6 text-center text-sm text-muted">Önce departman seçin.</p>
            ) : (
              <>
                {deptPeople.length > 0 && (
                  <button type="button" className="btn-secondary mb-3 w-full" data-testid="assign-team"
                    onClick={() => setAssignees((a) => Array.from(new Set([...a, ...deptPeople.map((p) => p.id)])))}>
                    <UsersRound className="size-4" /> Tüm {dept?.name} ekibini ata
                  </button>
                )}
                <div className="max-h-80 overflow-y-auto">
                  <p className="mb-1 px-2 text-xs font-medium text-faint">{dept?.name} üyeleri</p>
                  {deptPeople.length === 0 && <p className="px-2 py-2 text-sm text-muted">Bu departmanda aktif üye yok.</p>}
                  {deptPeople.map((p) => <PersonRow key={p.id} id={p.id} name={fullName(p)} />)}
                  {otherPeople.length > 0 && <p className="mt-3 mb-1 px-2 text-xs font-medium text-faint">Diğer üyeler</p>}
                  {otherPeople.map((p) => <PersonRow key={p.id} id={p.id} name={fullName(p)} />)}
                </div>
              </>
            )}
          </Card>

          {error && <p className="rounded-lg border border-danger/40 bg-danger/10 px-3 py-2.5 text-sm text-danger" role="alert">{error}</p>}
          <button type="submit" className="btn-primary w-full" disabled={busy}>
            {busy ? <Spinner className="size-4 text-current" /> : <FilePlus2 className="size-4" />} Görevi oluştur ve ata
          </button>
        </div>
      </form>
    </>
  );
}
