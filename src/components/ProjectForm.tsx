import { useState, type FormEvent } from "react";
import { supabase } from "../lib/supabase";
import { useToast } from "../context/ToastContext";
import { errorMessage } from "../lib/errors";
import { PROJECT_STATUSES, PROJECT_STATUS_META } from "../lib/constants";
import { fullName, todayISO } from "../lib/format";
import type { Department, DirectoryEntry, ProjectOverview, ProjectStatus } from "../lib/types";
import { Field, FormError, Modal, Spinner } from "./ui";

/** Proje oluşturma/düzenleme penceresi. Yazma yetkisi sunucuda (RLS) kontrol edilir. */
export default function ProjectForm({ project, departments, people, onClose, onSaved }: {
  project: ProjectOverview | null; departments: Department[]; people: DirectoryEntry[];
  onClose: () => void; onSaved: (id: string) => void;
}) {
  const toast = useToast();
  const [form, setForm] = useState({
    name: project?.name ?? "", description: project?.description ?? "",
    owner_id: project?.owner_id ?? "", department_id: project?.department_id ?? "",
    start_date: project?.start_date ?? todayISO(), target_date: project?.target_date ?? "",
    status: (project?.status ?? "ACTIVE") as ProjectStatus,
  });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function save(e: FormEvent) {
    e.preventDefault();
    setError(null);
    if (form.name.trim().length < 3) return setError("Proje adı en az 3 karakter olmalıdır.");
    if (!form.target_date) return setError("Hedef teslim tarihini seçin.");
    if (form.target_date < form.start_date) return setError("Hedef tarih başlangıçtan önce olamaz.");
    setBusy(true);
    const payload = { ...form, name: form.name.trim(), owner_id: form.owner_id || null, department_id: form.department_id || null };
    const res = project
      ? await supabase.from("projects").update(payload).eq("id", project.id).select("id").single()
      : await supabase.from("projects").insert(payload).select("id").single();
    setBusy(false);
    if (res.error) return setError(errorMessage(res.error));
    toast.success(project ? "Proje güncellendi." : "Proje oluşturuldu.");
    onSaved((res.data as { id: string }).id);
  }

  return (
    <Modal open onClose={onClose} title={project ? `${project.code} — projeyi düzenle` : "Yeni proje"} wide
      footer={<><button className="btn-secondary" onClick={onClose} disabled={busy}>Vazgeç</button>
        <button className="btn-primary" type="submit" form="project-form" disabled={busy}>{busy && <Spinner className="size-4 text-current" />} {project ? "Kaydet" : "Projeyi oluştur"}</button></>}>
      <form id="project-form" onSubmit={save} className="space-y-4">
        <Field label="Proje adı" required><input className="input" name="name" value={form.name} maxLength={120} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="Örn. TEKNOFEST 2027 Orta İrtifa Roketi" /></Field>
        <Field label="Açıklama"><textarea className="input min-h-24" value={form.description} maxLength={5000} onChange={(e) => setForm({ ...form, description: e.target.value })} placeholder="Kapsam, hedef irtifa, yarışma takvimi, kabul ölçütleri…" /></Field>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Proje sorumlusu"><select className="input" name="owner" value={form.owner_id} onChange={(e) => setForm({ ...form, owner_id: e.target.value })}>
            <option value="">Atanmadı</option>{people.filter((p) => p.is_active).map((p) => <option key={p.id} value={p.id}>{fullName(p)}</option>)}</select></Field>
          <Field label="Ana departman"><select className="input" value={form.department_id} onChange={(e) => setForm({ ...form, department_id: e.target.value })}>
            <option value="">Departmanlar arası</option>{departments.filter((d) => d.is_active).map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}</select></Field>
        </div>
        <div className="grid gap-4 sm:grid-cols-3">
          <Field label="Başlangıç" required><input type="date" className="input" value={form.start_date} onChange={(e) => setForm({ ...form, start_date: e.target.value })} /></Field>
          <Field label="Hedef teslim" required><input type="date" className="input" name="target_date" value={form.target_date} min={form.start_date} onChange={(e) => setForm({ ...form, target_date: e.target.value })} /></Field>
          <Field label="Durum"><select className="input" value={form.status} onChange={(e) => setForm({ ...form, status: e.target.value as ProjectStatus })}>
            {PROJECT_STATUSES.map((s) => <option key={s} value={s}>{PROJECT_STATUS_META[s].label}</option>)}</select></Field>
        </div>
        <FormError>{error}</FormError>
      </form>
    </Modal>
  );
}
