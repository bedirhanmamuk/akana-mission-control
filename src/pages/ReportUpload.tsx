import { useMemo, useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { ClipboardList, Info } from "lucide-react";
import { supabase } from "../lib/supabase";
import { useAuth } from "../context/AuthContext";
import { unwrap, useAsync } from "../lib/useAsync";
import { canUploadNewVersion, fetchMaxFileSizeMb, fetchTasks } from "../lib/api";
import { formatDate } from "../lib/format";
import type { Report } from "../lib/types";
import ReportUploadForm from "../components/ReportUploadForm";
import {
  Card, EmptyState, ErrorState, Field, LoadingState, PageHeader, ReportStatusBadge, TaskStatusBadge,
} from "../components/ui";

export default function ReportUpload() {
  const { profile } = useAuth();
  const uid = profile!.id;
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const [selected, setSelected] = useState(params.get("gorev") ?? "");

  const { data, loading, error, reload } = useAsync(async () => {
    const [tasks, reports, maxMb] = await Promise.all([
      fetchTasks(),
      supabase.from("reports").select("*").eq("uploaded_by", uid).then(unwrap<Report[]>),
      fetchMaxFileSizeMb(),
    ]);
    return {
      tasks: tasks.filter((t) => t.status !== "COMPLETED" && t.task_assignees.some((a) => a.user_id === uid)),
      reports: new Map(reports.map((r) => [r.task_id, r])),
      maxMb,
    };
  }, [uid]);

  const task = useMemo(() => data?.tasks.find((t) => t.id === selected) ?? null, [data, selected]);
  const report = task ? data?.reports.get(task.id) ?? null : null;

  if (loading) return <><PageHeader title="Rapor Yükle" /><LoadingState /></>;
  if (error || !data) return <><PageHeader title="Rapor Yükle" /><ErrorState message={error ?? ""} onRetry={reload} /></>;

  return (
    <>
      <PageHeader title="Rapor Yükle" description="Size atanan bir görevi seçin ve raporunuzu yükleyin. Yüklenen raporlar yönetici incelemesine gönderilir." />
      {data.tasks.length === 0 ? (
        <EmptyState icon={<ClipboardList className="size-6" />} title="Rapor yükleyebileceğiniz bir görev yok"
          description="Rapor yüklemek için size atanmış, tamamlanmamış bir görev olmalıdır."
          action={<Link to="/gorevler" className="btn-secondary">Görevlerime git</Link>} />
      ) : (
        <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_320px]">
          <Card className="p-5">
            <div className="mb-4">
              <Field label="Görev" required>
                <select className="input" value={selected} name="task"
                  onChange={(e) => { setSelected(e.target.value); setParams(e.target.value ? { gorev: e.target.value } : {}, { replace: true }); }}>
                  <option value="">Görev seçin…</option>
                  {data.tasks.map((t) => <option key={t.id} value={t.id}>{t.code} — {t.title}</option>)}
                </select>
              </Field>
            </div>
            {!task ? (
              <p className="flex items-center gap-2 rounded-lg border border-dashed border-line px-3 py-6 text-sm text-muted">
                <Info className="size-4 shrink-0" /> Devam etmek için yukarıdan bir görev seçin.
              </p>
            ) : !canUploadNewVersion(report) ? (
              <div className="rounded-lg border border-line bg-surface px-4 py-5 text-sm">
                <p className="mb-2 flex items-center gap-2">Bu görev için raporunuz: <ReportStatusBadge status={report!.status} /></p>
                <p className="text-muted">
                  {report!.status === "APPROVED" ? "Rapor onaylandığı için yeni sürüm yüklenemez." : "Rapor şu anda inceleniyor; inceleme sonuçlanana kadar yeni sürüm yüklenemez."}
                </p>
                <Link to={`/raporlar/${report!.id}`} className="btn-secondary mt-3">Raporu görüntüle</Link>
              </div>
            ) : (
              <ReportUploadForm task={task} existingReport={report} maxFileSizeMb={data.maxMb}
                onDone={(id) => navigate(`/raporlar/${id}`)} />
            )}
          </Card>

          <Card className="h-fit p-5">
            <h2 className="mb-3 text-sm font-semibold">Görev bilgisi</h2>
            {task ? (
              <dl className="space-y-3 text-sm">
                <div><dt className="text-xs text-muted">Görev kodu</dt><dd className="code-tag">{task.code}</dd></div>
                <div><dt className="text-xs text-muted">Departman</dt><dd>{task.department?.name ?? "—"}</dd></div>
                <div><dt className="text-xs text-muted">Son teslim</dt><dd>{formatDate(task.due_date)}</dd></div>
                <div><dt className="text-xs text-muted">Görev durumu</dt><dd className="mt-1"><TaskStatusBadge status={task.status} /></dd></div>
                {report && (
                  <div><dt className="text-xs text-muted">Mevcut rapor</dt>
                    <dd className="mt-1 flex items-center gap-2"><span className="font-mono text-xs">V{report.current_version}</span><ReportStatusBadge status={report.status} /></dd></div>
                )}
                {report?.review_note && (
                  <div className="rounded-lg border border-warning/30 bg-warning/5 p-3">
                    <dt className="text-xs font-semibold text-warning">Yönetici notu</dt>
                    <dd className="mt-1 whitespace-pre-wrap text-sm">{report.review_note}</dd>
                  </div>
                )}
                <Link to={`/gorevler/${task.id}`} className="inline-block text-xs text-accent-2 hover:underline">Görev detayına git →</Link>
              </dl>
            ) : <p className="text-sm text-muted">Görev seçildiğinde departman ve teslim bilgileri burada görünür.</p>}
          </Card>
        </div>
      )}
    </>
  );
}
