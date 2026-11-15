import { useState } from "react";
import { Link, useParams } from "react-router-dom";
import { ArrowLeft, Check, Eye, RotateCcw, X } from "lucide-react";
import { supabase } from "../lib/supabase";
import { useAuth } from "../context/AuthContext";
import { useToast } from "../context/ToastContext";
import { unwrap, useAsync } from "../lib/useAsync";
import { canUploadNewVersion, fetchDirectory, fetchMaxFileSizeMb, fetchTask, fetchVersions, nameMap } from "../lib/api";
import { errorMessage } from "../lib/errors";
import { formatDate, formatDateTime, fullName } from "../lib/format";
import type { Report } from "../lib/types";
import ReportUploadForm from "../components/ReportUploadForm";
import VersionHistory from "../components/VersionHistory";
import {
  Card, ErrorState, InfoRow, LoadingState, Modal, ReportStatusBadge, SectionTitle, Spinner,
  TaskStatusBadge, Unauthorized,
} from "../components/ui";

type Action = "START" | "APPROVE" | "REQUEST_REVISION" | "REJECT";

const ACTION_UI: Record<Exclude<Action, "START">, { title: string; label: string; noteLabel: string; required: boolean; cls: string; ok: string }> = {
  APPROVE: { title: "Raporu onayla", label: "Onayla", noteLabel: "Açıklama (isteğe bağlı)", required: false, cls: "btn-success", ok: "Rapor onaylandı." },
  REQUEST_REVISION: { title: "Revizyon iste", label: "Revizyon iste", noteLabel: "Revizyon gerekçesi", required: true, cls: "btn-warning", ok: "Revizyon istendi; üyeye bildirim gönderildi." },
  REJECT: { title: "Raporu reddet", label: "Reddet", noteLabel: "Ret gerekçesi", required: true, cls: "btn-danger", ok: "Rapor reddedildi." },
};

export default function ReportDetail() {
  const { id = "" } = useParams();
  const { profile, isAdmin } = useAuth();
  const uid = profile!.id;
  const toast = useToast();
  const [action, setAction] = useState<Exclude<Action, "START"> | null>(null);
  const [note, setNote] = useState("");
  const [noteError, setNoteError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const { data, loading, error, reload } = useAsync(async () => {
    const report = unwrap(await supabase.from("reports").select("*").eq("id", id).maybeSingle()) as Report | null;
    if (!report) return null;
    const [task, versions, dir, maxMb] = await Promise.all([
      fetchTask(report.task_id), fetchVersions(report.id), fetchDirectory(), fetchMaxFileSizeMb(),
    ]);
    return { report, task, versions, names: nameMap(dir), maxMb };
  }, [id]);

  if (loading) return <LoadingState />;
  if (error) return <ErrorState message={error} onRetry={reload} />;
  // RLS raporu döndürmediyse kullanıcı ya yetkisizdir ya da rapor yoktur.
  if (!data) return <Unauthorized />;

  const { report, task, versions, names } = data;
  const isOwner = report.uploaded_by === uid;
  const reviewable = isAdmin && (report.status === "PENDING" || report.status === "IN_REVIEW");
  const canUpload = isOwner && task !== null && task.status !== "COMPLETED" && canUploadNewVersion(report);

  async function review(a: Action, n: string | null) {
    setBusy(true);
    const { error: err } = await supabase.rpc("review_report", { p_report_id: report.id, p_action: a, p_note: n });
    setBusy(false);
    if (err) {
      if (a === "START") toast.error(errorMessage(err)); else setNoteError(errorMessage(err));
      return;
    }
    toast.success(a === "START" ? "Rapor incelemeye alındı." : ACTION_UI[a].ok);
    setAction(null);
    setNote("");
    reload();
  }

  function submitAction() {
    if (!action) return;
    setNoteError(null);
    if (ACTION_UI[action].required && note.trim().length === 0) {
      return setNoteError(`${ACTION_UI[action].noteLabel} yazılması zorunludur.`);
    }
    void review(action, note.trim() || null);
  }

  return (
    <>
      <Link to={isAdmin ? "/yonetim/rapor-inceleme" : "/arsiv"} className="mb-4 inline-flex items-center gap-1.5 text-sm text-muted hover:text-ink">
        <ArrowLeft className="size-4" /> {isAdmin ? "Rapor inceleme" : "Rapor arşivi"}
      </Link>
      <div className="mb-6">
        <div className="mb-2 flex flex-wrap items-center gap-2">
          {task && <Link to={`/gorevler/${task.id}`} className="code-tag text-sm hover:underline">{task.code}</Link>}
          <span className="rounded-md bg-accent/20 px-2 py-0.5 font-mono text-xs font-bold text-accent-2">V{report.current_version}</span>
          <span key={report.status} className="inline-flex animate-pop" data-testid="report-status"><ReportStatusBadge status={report.status} /></span>
        </div>
        <h1 className="display text-2xl font-semibold sm:text-[28px]">{report.title}</h1>
      </div>

      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_340px]">
        <div className="space-y-4">
          {report.description && (
            <Card className="p-5">
              <SectionTitle>Açıklama</SectionTitle>
              <p className="whitespace-pre-wrap text-sm leading-relaxed">{report.description}</p>
            </Card>
          )}

          {report.review_note && report.status !== "PENDING" && (
            <Card className={`p-5 ${report.status === "APPROVED" ? "border-success/40" : report.status === "REJECTED" ? "border-danger/40" : "border-warning/40"}`}>
              <div data-testid="review-note">
                <SectionTitle>{report.status === "REVISION_REQUESTED" ? "Revizyon gerekçesi" : report.status === "REJECTED" ? "Ret gerekçesi" : "Yönetici notu"}</SectionTitle>
                <p className="whitespace-pre-wrap text-sm">{report.review_note}</p>
                <p className="mt-2 text-xs text-muted">{report.reviewed_by ? fullName(names.get(report.reviewed_by)) : ""} · {formatDateTime(report.reviewed_at)}</p>
              </div>
            </Card>
          )}

          {canUpload && task && (
            <Card className="p-5">
              <SectionTitle>{report.status === "PENDING" ? "Raporu güncelle (yeni sürüm)" : "Güncel sürümü yükle"}</SectionTitle>
              <ReportUploadForm task={task} existingReport={report} maxFileSizeMb={data.maxMb} onDone={reload} />
            </Card>
          )}

          <Card className="p-5">
            <SectionTitle aside={<span className="text-xs text-muted">{versions.length} sürüm</span>}>Sürüm geçmişi ve dosyalar</SectionTitle>
            <VersionHistory versions={versions} currentVersion={report.current_version} names={names} />
          </Card>
        </div>

        <div className="space-y-4">
          {isAdmin && (
            <Card className="p-5" >
              <SectionTitle>İnceleme kararı</SectionTitle>
              {reviewable ? (
                <div className="space-y-2" data-testid="review-actions">
                  {report.status === "PENDING" && (
                    <button className="btn-secondary w-full" disabled={busy} onClick={() => void review("START", null)}>
                      {busy ? <Spinner className="size-4" /> : <Eye className="size-4" />} İncelemeye al
                    </button>
                  )}
                  <button className="btn-success w-full" disabled={busy} onClick={() => { setNote(""); setNoteError(null); setAction("APPROVE"); }}><Check className="size-4" /> Onayla</button>
                  <button className="btn-warning w-full" disabled={busy} onClick={() => { setNote(""); setNoteError(null); setAction("REQUEST_REVISION"); }}><RotateCcw className="size-4" /> Revizyon iste</button>
                  <button className="btn-danger w-full" disabled={busy} onClick={() => { setNote(""); setNoteError(null); setAction("REJECT"); }}><X className="size-4" /> Reddet</button>
                </div>
              ) : (
                <p className="text-sm text-muted">
                  {report.status === "APPROVED" ? "Bu rapor onaylandı." : "Karar verildi. Üye yeni sürüm yüklediğinde rapor tekrar incelemeye düşer."}
                </p>
              )}
            </Card>
          )}

          <Card className="p-5">
            <SectionTitle>Rapor bilgileri</SectionTitle>
            <dl className="divide-y divide-line-soft">
              <InfoRow label="Yükleyen">{fullName(names.get(report.uploaded_by))}{isOwner && <span className="text-xs text-muted"> (siz)</span>}</InfoRow>
              <InfoRow label="İlk yükleme">{formatDateTime(report.created_at)}</InfoRow>
              <InfoRow label="Son güncelleme">{formatDateTime(report.updated_at)}</InfoRow>
              <InfoRow label="Güncel sürüm">V{report.current_version}</InfoRow>
            </dl>
          </Card>

          {task && (
            <Card className="p-5">
              <SectionTitle>Görev bilgileri</SectionTitle>
              <dl className="divide-y divide-line-soft">
                <InfoRow label="Görev"><Link to={`/gorevler/${task.id}`} className="hover:text-accent-2">{task.title}</Link></InfoRow>
                <InfoRow label="Departman">{task.department?.name ?? "—"}</InfoRow>
                <InfoRow label="Son teslim">{formatDate(task.due_date)}</InfoRow>
                <InfoRow label="Görev durumu"><TaskStatusBadge status={task.status} /></InfoRow>
              </dl>
            </Card>
          )}
        </div>
      </div>

      {action && (
        <Modal open onClose={() => !busy && setAction(null)} title={ACTION_UI[action].title}
          footer={<><button className="btn-secondary" onClick={() => setAction(null)} disabled={busy}>Vazgeç</button>
            <button className={ACTION_UI[action].cls} onClick={submitAction} disabled={busy} data-testid="confirm-review">
              {busy && <Spinner className="size-4" />} {ACTION_UI[action].label}</button></>}>
          <label className="block">
            <span className="label">{ACTION_UI[action].noteLabel} {ACTION_UI[action].required && <span className="text-danger">*</span>}</span>
            <textarea className="input min-h-28" value={note} onChange={(e) => setNote(e.target.value)} maxLength={2000} autoFocus name="review-note"
              placeholder={action === "APPROVE" ? "Üyeye iletilecek not…" : "Üyenin neyi düzeltmesi gerektiğini açıkça yazın…"} />
          </label>
          {noteError && <p className="mt-2 text-sm text-danger" role="alert">{noteError}</p>}
        </Modal>
      )}
    </>
  );
}
