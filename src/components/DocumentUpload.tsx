import { useRef, useState, type DragEvent, type FormEvent } from "react";
import { CheckCircle2, UploadCloud, X } from "lucide-react";
import { supabase } from "../lib/supabase";
import {
  ACCEPT_ATTR, DOCUMENTS_BUCKET, FILE_RULES, PICKABLE_EXTENSIONS, fileExtension, removeOrphans, safeObjectName,
  sha256Hex, uploadWithProgress, validateFile,
} from "../lib/files";
import { errorMessage } from "../lib/errors";
import { formatBytes } from "../lib/format";
import { DOCUMENT_CATEGORIES, DOCUMENT_CATEGORY_LABEL } from "../lib/constants";
import { useAuth } from "../context/AuthContext";
import type { Department, DocumentCategory, DocumentRecord, Project, TaskWithRelations } from "../lib/types";
import { fileIcon } from "./FileList";
import { Field, FormError, Modal, Spinner } from "./ui";

/** Sürükle-bırak dosya seçici (tek dosya). Doğrulama istemcide UX içindir; bağlayıcı kontrol sunucudadır. */
export function FileDrop({ file, onFile, maxBytes, disabled, progress }: {
  file: File | null; onFile: (f: File | null, error: string | null) => void; maxBytes: number; disabled?: boolean; progress?: number | null;
}) {
  const ref = useRef<HTMLInputElement>(null);
  const [over, setOver] = useState(false);
  const [checking, setChecking] = useState(false);

  async function take(f: File | undefined) {
    if (!f) return;
    setChecking(true);
    const err = await validateFile(f, maxBytes);
    setChecking(false);
    onFile(err ? null : f, err);
  }
  function drop(e: DragEvent) {
    e.preventDefault(); setOver(false);
    if (!disabled) void take(e.dataTransfer.files[0]);
  }

  if (file) {
    const Icon = fileIcon(fileExtension(file.name));
    return (
      <div className="rounded-xl bg-surface p-3">
        <div className="flex items-center gap-3">
          <Icon className="size-6 shrink-0 text-accent-2" />
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm" title={file.name}>{file.name}</p>
            <p className="text-xs text-muted">{fileExtension(file.name).toUpperCase()} · {formatBytes(file.size)}</p>
          </div>
          {progress === 100 ? <CheckCircle2 className="size-5 text-success" /> : !disabled && (
            <button type="button" className="flex size-9 items-center justify-center rounded-md text-muted hover:bg-ink/5 hover:text-ink" onClick={() => onFile(null, null)} aria-label={`${file.name} dosyasını kaldır`}><X className="size-4" /></button>
          )}
        </div>
        {progress != null && (
          <div className="mt-2 flex items-center gap-2">
            <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-ink/8"><div className="h-full rounded-full bg-accent transition-[width] duration-200" style={{ width: `${progress}%` }} /></div>
            <span className="w-10 text-right text-xs text-muted tabular-nums" data-testid="doc-upload-percent">%{progress}</span>
          </div>
        )}
      </div>
    );
  }
  return (
    <div onDragOver={(e) => { e.preventDefault(); setOver(true); }} onDragLeave={() => setOver(false)} onDrop={drop}
      className={`flex flex-col items-center justify-center gap-2 rounded-xl border-2 border-dashed px-4 py-8 text-center transition-colors ${over ? "border-accent bg-accent/8" : "border-line hover:border-line-strong"}`}>
      {checking ? <Spinner className="size-6" /> : <UploadCloud className="size-7 text-muted" />}
      <p className="text-sm">Dosyayı buraya sürükleyin veya <button type="button" className="font-medium text-accent-2 underline-offset-2 hover:underline" onClick={() => ref.current?.click()} disabled={disabled}>bilgisayardan seçin</button></p>
      <p className="text-xs text-muted">{PICKABLE_EXTENSIONS.join(", ").toUpperCase()} · en fazla {Math.round(maxBytes / 1048576)} MB</p>
      <input ref={ref} type="file" accept={ACCEPT_ATTR} className="hidden" data-testid="doc-file-input"
        onChange={(e) => { void take(e.target.files?.[0]); e.target.value = ""; }} />
    </div>
  );
}

/** Dosyayı Storage'a yükler ve sunucuda doğrulanmış yeni sürüm olarak kaydeder. */
export async function uploadDocumentVersion(documentId: string, file: File, note: string, onProgress: (pct: number) => void): Promise<void> {
  const { data: s } = await supabase.auth.getSession();
  const token = s.session?.access_token;
  if (!token) throw new Error("Oturumunuzun süresi doldu. Lütfen tekrar giriş yapın.");
  const ext = fileExtension(file.name);
  const path = `${documentId}/${crypto.randomUUID()}/${safeObjectName(file.name, 0)}`;
  const hash = await sha256Hex(file);
  await uploadWithProgress(path, file, FILE_RULES[ext].mime, token, (l, t) => onProgress(Math.round((l / t) * 100)), undefined, DOCUMENTS_BUCKET);
  const { error } = await supabase.rpc("add_document_version", { p_document_id: documentId, p_path: path, p_name: file.name, p_sha256: hash, p_note: note });
  if (error) {
    await removeOrphans([path], DOCUMENTS_BUCKET);
    throw error;
  }
}

export function NewVersionForm({ documentId, maxBytes, onDone }: { documentId: string; maxBytes: number; onDone: () => void }) {
  const [file, setFile] = useState<File | null>(null);
  const [note, setNote] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [progress, setProgress] = useState<number | null>(null);
  const busy = progress !== null;
  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!file) return setError("Bir dosya seçin.");
    setError(null); setProgress(0);
    try {
      await uploadDocumentVersion(documentId, file, note, setProgress);
      setFile(null); setNote(""); setProgress(null);
      onDone();
    } catch (err) {
      setProgress(null);
      setError(errorMessage(err));
    }
  }
  return (
    <form onSubmit={submit} className="space-y-3">
      <FileDrop file={file} onFile={(f, err) => { setFile(f); setError(err); }} maxBytes={maxBytes} disabled={busy} progress={progress} />
      <Field label="Sürüm notu" hint="Bu sürümde ne değişti?"><input className="input" value={note} maxLength={2000} onChange={(e) => setNote(e.target.value)} disabled={busy} placeholder="Örn. Kanatçık kök kalınlığı 3 mm'ye çıkarıldı" /></Field>
      <FormError>{error}</FormError>
      <button className="btn-primary w-full" disabled={busy || !file}>{busy ? <Spinner className="size-4 text-current" /> : <UploadCloud className="size-4" />} Yeni sürümü yükle ve onaya gönder</button>
    </form>
  );
}

export function NewDocumentModal({ departments, projects, tasks, presetTaskId, presetProjectId, maxBytes, onClose, onCreated }: {
  departments: Department[]; projects: Pick<Project, "id" | "code" | "name">[]; tasks: TaskWithRelations[];
  presetTaskId?: string | null; presetProjectId?: string | null; maxBytes: number;
  onClose: () => void; onCreated: (doc: DocumentRecord) => void;
}) {
  const { profile } = useAuth();
  const presetTask = tasks.find((t) => t.id === presetTaskId) ?? null;
  const [form, setForm] = useState({
    title: "", description: "", category: "REPORT" as DocumentCategory,
    department_id: presetTask?.department_id ?? profile?.department_id ?? "",
    project_id: presetTask?.project_id ?? presetProjectId ?? "", task_id: presetTask?.id ?? "", is_restricted: false,
  });
  const [file, setFile] = useState<File | null>(null);
  const [note, setNote] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [progress, setProgress] = useState<number | null>(null);
  const busy = progress !== null;

  async function submit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    if (form.title.trim().length < 3) return setError("Doküman başlığı en az 3 karakter olmalıdır.");
    if (!file) return setError("Yüklenecek dosyayı seçin.");
    setProgress(0);
    const { data, error: err } = await supabase.rpc("create_document", {
      p_title: form.title.trim(), p_description: form.description, p_category: form.category,
      p_department_id: form.department_id || null, p_project_id: form.project_id || null,
      p_task_id: form.task_id || null, p_is_restricted: form.is_restricted,
    });
    if (err) { setProgress(null); return setError(errorMessage(err)); }
    const doc = data as DocumentRecord;
    try {
      await uploadDocumentVersion(doc.id, file, note, setProgress);
      onCreated(doc);
    } catch (upErr) {
      // Dosyası yüklenemeyen taslak kalmasın
      await supabase.rpc("delete_document", { p_document_id: doc.id });
      setProgress(null);
      setError(errorMessage(upErr));
    }
  }

  return (
    <Modal open onClose={busy ? () => undefined : onClose} title="Doküman yükle" wide
      footer={<><button className="btn-secondary" onClick={onClose} disabled={busy}>Vazgeç</button>
        <button className="btn-primary" type="submit" form="doc-form" disabled={busy}>{busy ? <Spinner className="size-4 text-current" /> : <UploadCloud className="size-4" />} Yükle ve onaya gönder</button></>}>
      <form id="doc-form" onSubmit={submit} className="space-y-4">
        <FileDrop file={file} onFile={(f, er) => { setFile(f); setError(er); if (f && !form.title) setForm((x) => ({ ...x, title: f.name.replace(/\.[^.]+$/, "").slice(0, 160) })); }} maxBytes={maxBytes} disabled={busy} progress={progress} />
        <Field label="Başlık" required><input className="input" name="doc-title" value={form.title} maxLength={160} onChange={(e) => setForm({ ...form, title: e.target.value })} disabled={busy} /></Field>
        <Field label="Açıklama"><textarea className="input min-h-20" value={form.description} maxLength={5000} onChange={(e) => setForm({ ...form, description: e.target.value })} disabled={busy} placeholder="İçerik, revizyon, kullanılan analiz yöntemi…" /></Field>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Kategori"><select className="input" name="doc-category" value={form.category} onChange={(e) => setForm({ ...form, category: e.target.value as DocumentCategory })} disabled={busy}>
            {DOCUMENT_CATEGORIES.map((c) => <option key={c} value={c}>{DOCUMENT_CATEGORY_LABEL[c]}</option>)}</select></Field>
          <Field label="Departman" hint="Onayı bu departmanın sorumlusu veya yönetici verir."><select className="input" name="doc-department" value={form.department_id} onChange={(e) => setForm({ ...form, department_id: e.target.value })} disabled={busy}>
            <option value="">Departmanlar arası (yönetici onaylar)</option>{departments.filter((d) => d.is_active).map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}</select></Field>
          <Field label="Proje"><select className="input" value={form.project_id} onChange={(e) => setForm({ ...form, project_id: e.target.value })} disabled={busy}>
            <option value="">Projesiz</option>{projects.map((p) => <option key={p.id} value={p.id}>{p.code} — {p.name}</option>)}</select></Field>
          <Field label="İlgili görev"><select className="input" value={form.task_id} onChange={(e) => setForm({ ...form, task_id: e.target.value })} disabled={busy}>
            <option value="">Görevsiz</option>{tasks.map((t) => <option key={t.id} value={t.id}>{t.code} — {t.title}</option>)}</select></Field>
        </div>
        <Field label="Sürüm notu"><input className="input" value={note} maxLength={2000} onChange={(e) => setNote(e.target.value)} disabled={busy} placeholder="İlk sürüm" /></Field>
        <label className="flex items-start gap-3 rounded-lg bg-surface px-3 py-2.5">
          <input type="checkbox" className="mt-0.5 size-4" checked={form.is_restricted} onChange={(e) => setForm({ ...form, is_restricted: e.target.checked })} disabled={busy} />
          <span className="text-sm">Erişimi kısıtla<span className="block text-xs text-muted">Yalnızca departman üyeleri ve yöneticiler görür.</span></span>
        </label>
        <FormError>{error}</FormError>
      </form>
    </Modal>
  );
}
