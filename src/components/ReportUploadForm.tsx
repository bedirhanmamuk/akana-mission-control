import { useCallback, useEffect, useRef, useState, type DragEvent, type FormEvent } from "react";
import { AlertCircle, CheckCircle2, Trash2, UploadCloud } from "lucide-react";
import { supabase } from "../lib/supabase";
import {
  ACCEPT_ATTR, ALLOWED_EXTENSIONS, FILE_RULES, MAX_FILES_PER_UPLOAD, fileExtension,
  removeOrphans, safeObjectName, sha256Hex, uploadWithProgress, validateFile,
} from "../lib/files";
import { errorMessage } from "../lib/errors";
import { formatBytes } from "../lib/format";
import { useAuth } from "../context/AuthContext";
import { useToast } from "../context/ToastContext";
import { useNotifications } from "../context/NotificationContext";
import type { Report, Task } from "../lib/types";
import { fileIcon } from "./FileList";
import { Field, Spinner } from "./ui";

interface Selected {
  key: string;
  file: File;
  error: string | null;
  checking: boolean;
  loaded: number;
  done: boolean;
}

type Phase = "idle" | "preparing" | "uploading" | "saving";

export const UPLOAD_SUCCESS_MESSAGE = "Raporunuz başarıyla AKANA MISSION CONTROL sistemine yüklendi.";

export default function ReportUploadForm({ task, existingReport, maxFileSizeMb, onDone }: {
  task: Pick<Task, "id" | "code" | "title" | "required_file_types">;
  existingReport: Report | null;
  maxFileSizeMb: number;
  onDone: (reportId: string) => void;
}) {
  const { profile } = useAuth();
  const toast = useToast();
  const { refreshUnread } = useNotifications();
  const [title, setTitle] = useState(existingReport?.title ?? "");
  const [description, setDescription] = useState(existingReport?.description ?? "");
  const [note, setNote] = useState("");
  const [items, setItems] = useState<Selected[]>([]);
  const [phase, setPhase] = useState<Phase>("idle");
  const [error, setError] = useState<string | null>(null);
  const [dragging, setDragging] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const abortRef = useRef<AbortController | null>(null);

  const busy = phase !== "idle";
  const maxBytes = maxFileSizeMb * 1024 * 1024;
  const isRevision = existingReport !== null;

  useEffect(() => {
    setTitle(existingReport?.title ?? "");
    setDescription(existingReport?.description ?? "");
    setNote("");
    setItems([]);
    setError(null);
  }, [task.id, existingReport?.id, existingReport?.title, existingReport?.description]);

  // Yükleme sürerken sayfadan ayrılmayı engelle
  useEffect(() => {
    if (!busy) return;
    const handler = (e: BeforeUnloadEvent) => { e.preventDefault(); };
    window.addEventListener("beforeunload", handler);
    return () => window.removeEventListener("beforeunload", handler);
  }, [busy]);

  useEffect(() => () => abortRef.current?.abort(), []);

  const addFiles = useCallback((list: FileList | File[]) => {
    const incoming = Array.from(list);
    if (incoming.length === 0) return;
    setError(null);
    setItems((prev) => {
      const next = [...prev];
      for (const file of incoming) {
        const key = `${file.name}:${file.size}:${file.lastModified}`;
        if (next.some((x) => x.key === key)) {
          toast.warning(`"${file.name}" zaten listede.`);
          continue;
        }
        if (next.length >= MAX_FILES_PER_UPLOAD) {
          toast.warning(`Tek seferde en fazla ${MAX_FILES_PER_UPLOAD} dosya yüklenebilir.`);
          break;
        }
        next.push({ key, file, error: null, checking: true, loaded: 0, done: false });
        void validateFile(file, maxBytes).then((err) => {
          setItems((cur) => cur.map((x) => (x.key === key ? { ...x, error: err, checking: false } : x)));
        });
      }
      return next;
    });
  }, [maxBytes, toast]);

  function onDrop(e: DragEvent) {
    e.preventDefault();
    setDragging(false);
    if (busy) return;
    addFiles(e.dataTransfer.files);
  }

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    if (busy || !profile) return;
    setError(null);

    if (title.trim().length < 3) return setError("Rapor başlığı en az 3 karakter olmalıdır.");
    if (items.length === 0) return setError("En az bir dosya seçmelisiniz.");
    if (items.some((x) => x.checking)) return setError("Dosyalar hâlâ kontrol ediliyor, lütfen bekleyin.");
    if (items.some((x) => x.error)) return setError("Hatalı dosyaları listeden kaldırın.");
    if (navigator.onLine === false) return setError("İnternet bağlantısı yok. Bağlantınızı kontrol edin.");

    const uploaded: string[] = [];
    const controller = new AbortController();
    abortRef.current = controller;

    try {
      setPhase("preparing");
      const { data: sess } = await supabase.auth.getSession();
      const token = sess.session?.access_token;
      if (!token) throw new Error("Oturumunuzun süresi doldu. Lütfen tekrar giriş yapın.");

      const hashes: string[] = [];
      for (const it of items) hashes.push(await sha256Hex(it.file));
      if (new Set(hashes).size !== hashes.length) {
        throw new Error("Seçilen dosyalar arasında içeriği aynı olan dosyalar var. Tekrar edenleri kaldırın.");
      }

      setPhase("uploading");
      setItems((cur) => cur.map((x) => ({ ...x, loaded: 0, done: false })));
      const uploadId = crypto.randomUUID();
      const payload: { path: string; name: string; sha256: string }[] = [];

      for (let i = 0; i < items.length; i++) {
        const it = items[i];
        const ext = fileExtension(it.file.name);
        const path = `${task.id}/${profile.id}/${uploadId}/${safeObjectName(it.file.name, i)}`;
        await uploadWithProgress(path, it.file, FILE_RULES[ext].mime, token, (loaded) => {
          setItems((cur) => cur.map((x) => (x.key === it.key ? { ...x, loaded } : x)));
        }, controller.signal);
        uploaded.push(path);
        setItems((cur) => cur.map((x) => (x.key === it.key ? { ...x, loaded: x.file.size, done: true } : x)));
        payload.push({ path, name: it.file.name, sha256: hashes[i] });
      }

      // Dosyalar depoda; şimdi sunucu doğrular ve rapor sürümünü atomik olarak kaydeder.
      setPhase("saving");
      const { data, error: rpcError } = await supabase.rpc("submit_report", {
        p_task_id: task.id,
        p_title: title.trim(),
        p_description: description.trim(),
        p_note: note.trim(),
        p_files: payload,
      });
      if (rpcError) throw rpcError;

      // Başarı mesajı yalnızca kayıt gerçekten tamamlandıktan sonra gösterilir.
      toast.success(UPLOAD_SUCCESS_MESSAGE);
      refreshUnread();
      setItems([]);
      setNote("");
      setPhase("idle");
      onDone((data as { report_id: string }).report_id);
    } catch (err) {
      await removeOrphans(uploaded);
      setItems((cur) => cur.map((x) => ({ ...x, loaded: 0, done: false })));
      setPhase("idle");
      setError(errorMessage(err, "Rapor yüklenemedi."));
    } finally {
      abortRef.current = null;
    }
  }

  const totalBytes = items.reduce((s, x) => s + x.file.size, 0);
  const loadedBytes = items.reduce((s, x) => s + Math.min(x.loaded, x.file.size), 0);
  const percent = totalBytes > 0 ? Math.floor((loadedBytes / totalBytes) * 100) : 0;

  return (
    <form onSubmit={onSubmit} className="space-y-4" noValidate>
      {isRevision && (
        <div className="rounded-lg border border-accent/30 bg-accent/10 px-3 py-2 text-sm">
          Bu yükleme raporun <span className="font-mono font-semibold text-accent-2">V{existingReport.current_version + 1}</span> sürümü
          olarak kaydedilecek. Önceki sürümler korunur.
        </div>
      )}

      <Field label="Rapor başlığı" required>
        <input className="input" value={title} onChange={(e) => setTitle(e.target.value)} maxLength={160}
          placeholder={`${task.code} — rapor başlığı`} disabled={busy} required name="title" />
      </Field>

      <Field label="Açıklama">
        <textarea className="input min-h-24" value={description} onChange={(e) => setDescription(e.target.value)}
          maxLength={5000} placeholder="Raporun kapsamı, yapılan çalışmalar, sonuçlar…" disabled={busy} name="description" />
      </Field>

      {isRevision && (
        <Field label="Sürüm notu" hint="Bu sürümde neleri değiştirdiğinizi kısaca yazın.">
          <textarea className="input min-h-16" value={note} onChange={(e) => setNote(e.target.value)} maxLength={2000} disabled={busy} name="note" />
        </Field>
      )}

      <div>
        <span className="label">Dosyalar <span className="text-danger">*</span></span>
        <div
          onDragOver={(e) => { e.preventDefault(); if (!busy) setDragging(true); }}
          onDragLeave={() => setDragging(false)}
          onDrop={onDrop}
          onClick={() => !busy && inputRef.current?.click()}
          onKeyDown={(e) => { if ((e.key === "Enter" || e.key === " ") && !busy) { e.preventDefault(); inputRef.current?.click(); } }}
          role="button"
          tabIndex={0}
          aria-label="Dosya seç veya sürükleyip bırak"
          className={`flex cursor-pointer flex-col items-center justify-center gap-2 rounded-xl border-2 border-dashed px-4 py-8 text-center transition-colors ${
            dragging ? "border-accent bg-accent/10" : "border-line bg-surface hover:border-accent/60"
          } ${busy ? "pointer-events-none opacity-60" : ""}`}
        >
          <UploadCloud className="size-8 text-accent-2" />
          <p className="text-sm font-medium">Dosyaları buraya sürükleyin veya <span className="text-accent-2 underline underline-offset-2">seçmek için dokunun</span></p>
          <p className="text-xs text-muted">
            {ALLOWED_EXTENSIONS.filter((e) => e !== "jpeg").join(", ").toUpperCase()} · dosya başına en fazla {maxFileSizeMb} MB · en fazla {MAX_FILES_PER_UPLOAD} dosya
          </p>
          {task.required_file_types.length > 0 && (
            <p className="text-xs text-warning">Bu görev için istenen tür: {task.required_file_types.join(", ").toUpperCase()}</p>
          )}
          <input ref={inputRef} type="file" multiple accept={ACCEPT_ATTR} className="hidden" data-testid="file-input"
            onChange={(e) => { if (e.target.files) addFiles(e.target.files); e.target.value = ""; }} />
        </div>
      </div>

      {items.length > 0 && (
        <ul className="space-y-2" aria-label="Seçilen dosyalar">
          {items.map((it) => {
            const ext = fileExtension(it.file.name);
            const Icon = fileIcon(ext);
            const p = it.file.size > 0 ? Math.floor((Math.min(it.loaded, it.file.size) / it.file.size) * 100) : 0;
            return (
              <li key={it.key} className={`rounded-lg border bg-surface px-3 py-2.5 ${it.error ? "border-danger/50" : "border-line"}`}>
                <div className="flex items-center gap-3">
                  <Icon className={`size-5 shrink-0 ${it.error ? "text-danger" : "text-accent-2"}`} />
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm" title={it.file.name}>{it.file.name}</p>
                    <p className="text-xs text-muted">
                      {(ext || "?").toUpperCase()} · {formatBytes(it.file.size)}
                      {it.checking && " · kontrol ediliyor…"}
                      {phase === "uploading" && !it.done && it.loaded > 0 && ` · %${p}`}
                    </p>
                  </div>
                  {it.done ? (
                    <CheckCircle2 className="size-5 text-success" aria-label="Yüklendi" />
                  ) : busy ? (
                    it.loaded > 0 ? <Spinner className="size-4" /> : null
                  ) : (
                    <button type="button" className="rounded-md p-2 text-muted hover:bg-danger/10 hover:text-danger"
                      onClick={() => setItems((cur) => cur.filter((x) => x.key !== it.key))} aria-label={`${it.file.name} dosyasını kaldır`}>
                      <Trash2 className="size-4" />
                    </button>
                  )}
                </div>
                {it.error && <p className="mt-1.5 flex items-start gap-1.5 text-xs text-danger"><AlertCircle className="mt-px size-3.5 shrink-0" />{it.error}</p>}
                {phase === "uploading" && !it.error && (
                  <div className="mt-2 h-1 overflow-hidden rounded-full bg-line">
                    <div className="h-full rounded-full bg-accent transition-[width] duration-150" style={{ width: `${p}%` }} />
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      )}

      {busy && (
        <div className="rounded-lg border border-line bg-surface p-3" role="status" aria-live="polite">
          <div className="mb-2 flex items-center justify-between text-sm">
            <span className="flex items-center gap-2">
              <Spinner className="size-4" />
              {phase === "preparing" && "Dosyalar hazırlanıyor…"}
              {phase === "uploading" && `Yükleniyor… ${formatBytes(loadedBytes)} / ${formatBytes(totalBytes)}`}
              {phase === "saving" && "Rapor kaydediliyor…"}
            </span>
            <span className="font-mono text-xs tabular-nums text-muted" data-testid="upload-percent">%{phase === "saving" ? 100 : percent}</span>
          </div>
          <div className="h-2 overflow-hidden rounded-full bg-line" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={percent}>
            <div className="h-full rounded-full bg-gradient-to-r from-accent to-accent-2 transition-[width] duration-150" style={{ width: `${phase === "saving" ? 100 : percent}%` }} />
          </div>
        </div>
      )}

      {error && (
        <div className="flex items-start gap-2 rounded-lg border border-danger/40 bg-danger/10 px-3 py-2.5 text-sm text-danger" role="alert" data-testid="upload-error">
          <AlertCircle className="mt-0.5 size-4 shrink-0" />
          <span>{error}</span>
        </div>
      )}

      <div className="flex flex-wrap justify-end gap-2">
        {phase === "uploading" && (
          <button type="button" className="btn-secondary" onClick={() => abortRef.current?.abort()}>İptal et</button>
        )}
        <button type="submit" className="btn-primary w-full sm:w-auto" disabled={busy}>
          {busy ? <Spinner className="size-4 text-white" /> : <UploadCloud className="size-4" />}
          {isRevision ? "Yeni sürümü yükle" : "Raporu yükle"}
        </button>
      </div>
    </form>
  );
}
