import { useState, type FormEvent } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { ArrowLeft, Check, Download, Eye, Lock, Pencil, RotateCcw, Trash2 } from "lucide-react";
import { supabase } from "../lib/supabase";
import { useAuth } from "../context/AuthContext";
import { useToast } from "../context/ToastContext";
import { unwrap, useAsync } from "../lib/useAsync";
import { fetchDepartments, fetchDirectory, fetchDocumentVersions, fetchMaxFileSizeMb, fetchProjectList, fetchTasks, nameMap } from "../lib/api";
import { errorMessage } from "../lib/errors";
import { DOCUMENT_CATEGORIES, DOCUMENT_CATEGORY_LABEL } from "../lib/constants";
import { DOCUMENTS_BUCKET, canPreviewInBrowser, getSignedUrl, removeOrphans } from "../lib/files";
import { formatBytes, formatDateTime, fullName } from "../lib/format";
import type { DocumentCategory, DocumentRecord, DocumentVersion } from "../lib/types";
import { fileIcon } from "../components/FileList";
import { NewVersionForm } from "../components/DocumentUpload";
import {
  Card, DocumentStatusBadge, ErrorState, Field, FormError, InfoRow, LoadingState, Modal, SectionTitle, Spinner, Unauthorized,
} from "../components/ui";

export default function DocumentDetail() {
  const { id = "" } = useParams();
  const { profile, isAdmin, canManageDepartment } = useAuth();
  const toast = useToast();
  const navigate = useNavigate();
  const [modal, setModal] = useState<"edit" | "delete" | "approve" | "revise" | null>(null);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [formError, setFormError] = useState<string | null>(null);

  const { data, loading, error, reload } = useAsync(async () => {
    const doc = unwrap(await supabase.from("documents").select("*").eq("id", id).maybeSingle()) as DocumentRecord | null;
    if (!doc) return null;
    const [versions, departments, projects, tasks, dir, maxMb] = await Promise.all([
      fetchDocumentVersions(id), fetchDepartments(), fetchProjectList(), fetchTasks(), fetchDirectory(), fetchMaxFileSizeMb(),
    ]);
    return { doc, versions, departments, projects, tasks, names: nameMap(dir), maxMb };
  }, [id]);

  const [edit, setEdit] = useState<{ title: string; description: string; category: DocumentCategory; project_id: string; task_id: string; is_restricted: boolean } | null>(null);

  if (loading && !data) return <LoadingState />;
  if (error) return <ErrorState message={error} onRetry={reload} />;
  if (!data) return <Unauthorized />;
  const { doc, versions, names } = data;
  const uid = profile!.id;
  const current = versions.find((v) => v.version_number === doc.current_version) ?? null;
  const canEdit = doc.created_by === uid || canManageDepartment(doc.department_id);
  const canReview = canManageDepartment(doc.department_id) && (isAdmin || current?.uploaded_by !== uid);
  const canDelete = isAdmin || (doc.created_by === uid && doc.status !== "APPROVED");
  const deptName = doc.department_id ? data.departments.find((d) => d.id === doc.department_id)?.name ?? "—" : "Departmanlar arası";
  const project = data.projects.find((p) => p.id === doc.project_id);
  const task = data.tasks.find((t) => t.id === doc.task_id);

  async function open(v: DocumentVersion, mode: "view" | "download") {
    const preview = mode === "view" ? window.open("", "_blank") : null;
    if (preview) preview.opener = null;
    setBusy(`${v.id}:${mode}`);
    try {
      const url = await getSignedUrl(v.storage_path, mode === "download" ? v.original_name : undefined, DOCUMENTS_BUCKET);
      if (mode === "view") { if (preview) preview.location.replace(url); else window.location.assign(url); return; }
      const a = document.createElement("a");
      a.href = url; a.download = v.original_name; document.body.appendChild(a); a.click(); a.remove();
    } catch (e) {
      preview?.close();
      toast.error(errorMessage(e));
    } finally { setBusy(null); }
  }

  async function review(action: "APPROVE" | "REQUEST_REVISION") {
    setFormError(null);
    if (action === "REQUEST_REVISION" && !note.trim()) return setFormError("Revizyon gerekçesi yazılması zorunludur.");
    setBusy("review");
    const { error: err } = await supabase.rpc("review_document", { p_document_id: doc.id, p_action: action, p_note: note });
    setBusy(null);
    if (err) return setFormError(errorMessage(err));
    toast.success(action === "APPROVE" ? "Doküman onaylandı." : "Revizyon istendi; yükleyen bilgilendirildi.");
    setModal(null); setNote(""); reload();
  }

  async function saveMeta(e: FormEvent) {
    e.preventDefault();
    if (!edit) return;
    if (edit.title.trim().length < 3) return setFormError("Başlık en az 3 karakter olmalıdır.");
    setBusy("edit");
    const { error: err } = await supabase.from("documents").update({
      ...edit, title: edit.title.trim(), project_id: edit.project_id || null, task_id: edit.task_id || null,
    }).eq("id", doc.id);
    setBusy(null);
    if (err) return setFormError(errorMessage(err));
    toast.success("Doküman bilgileri güncellendi.");
    setModal(null); reload();
  }

  async function remove() {
    setBusy("delete");
    const { data: paths, error: err } = await supabase.rpc("delete_document", { p_document_id: doc.id });
    if (err) { setBusy(null); setModal(null); return toast.error(errorMessage(err)); }
    await removeOrphans((paths as string[]) ?? [], DOCUMENTS_BUCKET);
    setBusy(null);
    toast.success("Doküman ve tüm sürümleri silindi.");
    navigate("/dokumanlar");
  }

  return (
    <>
      <Link to="/dokumanlar" className="mb-4 inline-flex items-center gap-1.5 text-sm text-muted hover:text-ink"><ArrowLeft className="size-4" /> Doküman Merkezi</Link>
      <div className="mb-6 flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0">
          <div className="mb-2 flex flex-wrap items-center gap-2">
            <span className="code-tag text-sm">{doc.code}</span>
            <DocumentStatusBadge status={doc.status} />
            {doc.is_restricted && <span className="inline-flex items-center gap-1 text-xs text-muted"><Lock className="size-3.5" /> Kısıtlı erişim</span>}
          </div>
          <h1 className="display text-2xl font-semibold sm:text-[28px]">{doc.title}</h1>
        </div>
        <div className="flex gap-2 [&>*]:flex-1 sm:[&>*]:flex-none">
          {canEdit && <button className="btn-secondary" onClick={() => { setFormError(null); setEdit({ title: doc.title, description: doc.description, category: doc.category, project_id: doc.project_id ?? "", task_id: doc.task_id ?? "", is_restricted: doc.is_restricted }); setModal("edit"); }}><Pencil className="size-4" /> Düzenle</button>}
          {canDelete && <button className="btn-danger" onClick={() => setModal("delete")}><Trash2 className="size-4" /> Sil</button>}
        </div>
      </div>

      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_340px]">
        <div className="min-w-0 space-y-4">
          {doc.description && <Card className="p-5"><SectionTitle>Açıklama</SectionTitle><p className="whitespace-pre-wrap text-sm leading-relaxed">{doc.description}</p></Card>}
          {doc.review_note && doc.status !== "PENDING" && (
            <div className={`rounded-2xl px-4 py-3 ${doc.status === "APPROVED" ? "bg-success/10" : "bg-warning/10"}`}>
              <p className={`text-xs font-semibold ${doc.status === "APPROVED" ? "text-success" : "text-warning"}`}>{doc.status === "APPROVED" ? "Onay notu" : "Revizyon gerekçesi"}</p>
              <p className="mt-1 whitespace-pre-wrap text-sm">{doc.review_note}</p>
            </div>
          )}
          <Card className="p-5">
            <SectionTitle aside={<span className="text-xs text-muted">{versions.length} sürüm</span>}>Sürüm ve revizyon geçmişi</SectionTitle>
            {versions.length === 0 ? <p className="text-sm text-muted">Henüz dosya yüklenmedi.</p> : (
              <ol className="space-y-2" data-testid="document-versions">
                {versions.map((v) => {
                  const Icon = fileIcon(v.extension);
                  const isCurrent = v.version_number === doc.current_version;
                  return (
                    <li key={v.id} className={`rounded-xl p-3 ${isCurrent ? "bg-accent/8 ring-1 ring-accent/30" : "bg-surface"}`}>
                      <div className="flex items-center gap-3">
                        <span className="font-mono text-sm font-semibold text-accent-2">V{v.version_number}</span>
                        <Icon className="size-5 shrink-0 text-muted" />
                        <div className="min-w-0 flex-1">
                          <p className="truncate text-sm" title={v.original_name}>{v.original_name}</p>
                          <p className="text-xs text-muted">{v.extension.toUpperCase()} · {formatBytes(v.size_bytes)} · {v.uploaded_by ? fullName(names.get(v.uploaded_by)) : "—"} · {formatDateTime(v.created_at)}</p>
                        </div>
                        {canPreviewInBrowser(v.extension) && (
                          <button className="btn-ghost min-h-9 px-2.5" onClick={() => void open(v, "view")} disabled={busy !== null} aria-label={`${v.original_name} dosyasını görüntüle`}>
                            {busy === `${v.id}:view` ? <Spinner className="size-4" /> : <Eye className="size-4" />}<span className="hidden sm:inline">Görüntüle</span>
                          </button>
                        )}
                        <button className="btn-secondary min-h-9 px-2.5" onClick={() => void open(v, "download")} disabled={busy !== null} aria-label={`${v.original_name} dosyasını indir`}>
                          {busy === `${v.id}:download` ? <Spinner className="size-4" /> : <Download className="size-4" />}<span className="hidden sm:inline">İndir</span>
                        </button>
                      </div>
                      {v.note && <p className="mt-2 pl-10 text-xs text-muted">{v.note}</p>}
                    </li>
                  );
                })}
              </ol>
            )}
          </Card>
          {canEdit && (
            <Card className="p-5">
              <SectionTitle>Yeni sürüm yükle</SectionTitle>
              <NewVersionForm documentId={doc.id} maxBytes={data.maxMb * 1048576} onDone={() => { toast.success("Yeni sürüm yüklendi ve onaya gönderildi."); reload(); }} />
            </Card>
          )}
        </div>

        <div className="space-y-4">
          <Card className="p-5">
            <SectionTitle>Doküman bilgileri</SectionTitle>
            <dl className="divide-y divide-line-soft">
              <InfoRow label="Kategori">{DOCUMENT_CATEGORY_LABEL[doc.category]}</InfoRow>
              <InfoRow label="Departman">{deptName}</InfoRow>
              <InfoRow label="Proje">{project ? <Link to={`/projeler/${project.id}`} className="hover:text-accent-2">{project.code} — {project.name}</Link> : "—"}</InfoRow>
              <InfoRow label="Görev">{task ? <Link to={`/gorevler/${task.id}`} className="hover:text-accent-2">{task.code}</Link> : "—"}</InfoRow>
              <InfoRow label="Oluşturan">{doc.created_by ? fullName(names.get(doc.created_by)) : "—"}</InfoRow>
              <InfoRow label="Oluşturulma">{formatDateTime(doc.created_at)}</InfoRow>
              {doc.reviewed_at && <InfoRow label="İnceleyen">{doc.reviewed_by ? fullName(names.get(doc.reviewed_by)) : "—"} · {formatDateTime(doc.reviewed_at)}</InfoRow>}
            </dl>
          </Card>
          {canReview && doc.status === "PENDING" && (
            <Card className="p-5" >
              <SectionTitle>Onay kararı</SectionTitle>
              <p className="mb-3 text-sm text-muted">V{doc.current_version} onayınızı bekliyor.</p>
              <div className="space-y-2" data-testid="document-review">
                <button className="btn-success w-full" onClick={() => { setNote(""); setFormError(null); setModal("approve"); }}><Check className="size-4" /> Onayla</button>
                <button className="btn-warning w-full" onClick={() => { setNote(""); setFormError(null); setModal("revise"); }}><RotateCcw className="size-4" /> Revizyon iste</button>
              </div>
            </Card>
          )}
        </div>
      </div>

      <Modal open={modal === "approve" || modal === "revise"} onClose={() => setModal(null)} title={modal === "approve" ? "Dokümanı onayla" : "Revizyon iste"}
        footer={<><button className="btn-secondary" onClick={() => setModal(null)} disabled={busy === "review"}>Vazgeç</button>
          <button className={modal === "approve" ? "btn-success" : "btn-warning"} disabled={busy === "review"} onClick={() => void review(modal === "approve" ? "APPROVE" : "REQUEST_REVISION")}>
            {busy === "review" && <Spinner className="size-4" />} {modal === "approve" ? "Onayla" : "Revizyon iste"}</button></>}>
        <Field label={modal === "approve" ? "Onay notu (isteğe bağlı)" : "Revizyon gerekçesi"} required={modal === "revise"}>
          <textarea className="input min-h-24" value={note} maxLength={2000} onChange={(e) => setNote(e.target.value)} autoFocus />
        </Field>
        <div className="mt-3"><FormError>{formError}</FormError></div>
      </Modal>

      {modal === "edit" && edit && (
        <Modal open onClose={() => setModal(null)} title="Doküman bilgilerini düzenle" wide
          footer={<><button className="btn-secondary" onClick={() => setModal(null)} disabled={busy === "edit"}>Vazgeç</button>
            <button className="btn-primary" type="submit" form="doc-edit" disabled={busy === "edit"}>{busy === "edit" && <Spinner className="size-4 text-current" />} Kaydet</button></>}>
          <form id="doc-edit" onSubmit={saveMeta} className="space-y-4">
            <Field label="Başlık" required><input className="input" value={edit.title} maxLength={160} onChange={(e) => setEdit({ ...edit, title: e.target.value })} /></Field>
            <Field label="Açıklama"><textarea className="input min-h-20" value={edit.description} maxLength={5000} onChange={(e) => setEdit({ ...edit, description: e.target.value })} /></Field>
            <div className="grid gap-4 sm:grid-cols-3">
              <Field label="Kategori"><select className="input" value={edit.category} onChange={(e) => setEdit({ ...edit, category: e.target.value as DocumentCategory })}>
                {DOCUMENT_CATEGORIES.map((c) => <option key={c} value={c}>{DOCUMENT_CATEGORY_LABEL[c]}</option>)}</select></Field>
              <Field label="Proje"><select className="input" value={edit.project_id} onChange={(e) => setEdit({ ...edit, project_id: e.target.value })}>
                <option value="">Projesiz</option>{data.projects.map((p) => <option key={p.id} value={p.id}>{p.code}</option>)}</select></Field>
              <Field label="Görev"><select className="input" value={edit.task_id} onChange={(e) => setEdit({ ...edit, task_id: e.target.value })}>
                <option value="">Görevsiz</option>{data.tasks.map((t) => <option key={t.id} value={t.id}>{t.code}</option>)}</select></Field>
            </div>
            <label className="flex items-center gap-3 text-sm"><input type="checkbox" className="size-4" checked={edit.is_restricted} onChange={(e) => setEdit({ ...edit, is_restricted: e.target.checked })} /> Erişimi departmanla kısıtla</label>
            <FormError>{formError}</FormError>
          </form>
        </Modal>
      )}

      <Modal open={modal === "delete"} onClose={() => setModal(null)} title="Dokümanı sil"
        footer={<><button className="btn-secondary" onClick={() => setModal(null)} disabled={busy === "delete"}>Vazgeç</button>
          <button className="btn-danger" onClick={() => void remove()} disabled={busy === "delete"}>{busy === "delete" && <Spinner className="size-4" />} Evet, sil</button></>}>
        <p className="text-sm"><span className="code-tag">{doc.code}</span> ve {versions.length} sürümü kalıcı olarak silinecek. Silme işlemi denetim kaydına yazılır.</p>
      </Modal>
    </>
  );
}
