import { useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { ArrowLeft, Pencil, Trash2 } from "lucide-react";
import { supabase } from "../lib/supabase";
import { useAuth } from "../context/AuthContext";
import { useToast } from "../context/ToastContext";
import { unwrap, useAsync } from "../lib/useAsync";
import { fetchDepartments, fetchDirectory, fetchProjectList, nameMap } from "../lib/api";
import { errorMessage } from "../lib/errors";
import { IMPACT_LABEL, PROBABILITY_LABEL, riskBand } from "../lib/constants";
import { daysUntil, formatDate, formatDateTime, fullName } from "../lib/format";
import type { Risk } from "../lib/types";
import RiskForm from "../components/RiskForm";
import { Card, ErrorState, InfoRow, LoadingState, Modal, RiskScore, RiskStatusBadge, SectionTitle, Spinner, Unauthorized } from "../components/ui";

export default function RiskDetail() {
  const { id = "" } = useParams();
  const { profile, isAdmin, canManageDepartment } = useAuth();
  const toast = useToast();
  const navigate = useNavigate();
  const [modal, setModal] = useState<"edit" | "delete" | null>(null);
  const [busy, setBusy] = useState(false);
  const { data, loading, error, reload } = useAsync(async () => {
    const risk = unwrap(await supabase.from("risks").select("*").eq("id", id).maybeSingle()) as Risk | null;
    if (!risk) return null;
    const [departments, projects, dir] = await Promise.all([fetchDepartments(), fetchProjectList(), fetchDirectory()]);
    return { risk, departments, projects, dir, names: nameMap(dir) };
  }, [id]);

  if (loading && !data) return <LoadingState />;
  if (error) return <ErrorState message={error} onRetry={reload} />;
  if (!data) return <Unauthorized />;
  const { risk: r, names } = data;
  const uid = profile!.id;
  const canEdit = isAdmin || r.created_by === uid || r.owner_id === uid || (r.department_id !== null && canManageDepartment(r.department_id));
  const project = data.projects.find((p) => p.id === r.project_id);
  const dept = data.departments.find((d) => d.id === r.department_id);
  const band = riskBand(r.score);
  const stale = r.status !== "CLOSED" && daysUntil(r.last_reviewed_at) < -30;

  async function remove() {
    setBusy(true);
    const { data: rows, error: err } = await supabase.from("risks").delete().eq("id", r.id).select("id");
    setBusy(false);
    if (err || !rows?.length) { setModal(null); return toast.error(err ? errorMessage(err) : "Riski yalnızca yönetici silebilir."); }
    toast.success("Risk silindi.");
    navigate("/riskler");
  }

  return (
    <>
      <Link to="/riskler" className="mb-4 inline-flex items-center gap-1.5 text-sm text-muted hover:text-ink"><ArrowLeft className="size-4" /> Risk Yönetimi</Link>
      <div className="mb-6 flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0">
          <div className="mb-2 flex flex-wrap items-center gap-2"><span className="code-tag text-sm">{r.code}</span><RiskStatusBadge status={r.status} /><RiskScore score={r.score} /></div>
          <h1 className="display text-2xl font-semibold sm:text-[28px]">{r.title}</h1>
        </div>
        <div className="flex gap-2 [&>*]:flex-1 sm:[&>*]:flex-none">
          {canEdit && <button className="btn-secondary" onClick={() => setModal("edit")}><Pencil className="size-4" /> Değerlendir / düzenle</button>}
          {isAdmin && <button className="btn-danger" onClick={() => setModal("delete")}><Trash2 className="size-4" /> Sil</button>}
        </div>
      </div>
      {stale && <p className="mb-4 rounded-xl bg-warning/10 px-4 py-2.5 text-sm text-warning">Bu risk 30 günden uzun süredir değerlendirilmedi (son: {formatDate(r.last_reviewed_at)}).</p>}

      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_320px]">
        <div className="space-y-4">
          <Card className="p-5"><SectionTitle>Açıklama</SectionTitle><p className="whitespace-pre-wrap text-sm leading-relaxed">{r.description || <span className="text-muted">Açıklama girilmemiş.</span>}</p></Card>
          <Card className="p-5"><SectionTitle>Önleyici faaliyet</SectionTitle><p className="whitespace-pre-wrap text-sm leading-relaxed">{r.mitigation || <span className={r.score >= 15 ? "text-danger" : "text-muted"}>Tanımlanmamış{r.score >= 15 ? " — kritik risk için zorunlu doldurulmalı." : "."}</span>}</p></Card>
          <Card className="p-5"><SectionTitle>Alternatif çözüm (B planı)</SectionTitle><p className="whitespace-pre-wrap text-sm leading-relaxed">{r.contingency || <span className={r.score >= 15 ? "text-danger" : "text-muted"}>Tanımlanmamış.</span>}</p></Card>
        </div>
        <div className="space-y-4">
          <Card className="p-5">
            <div className="mb-4 flex items-end justify-between">
              <div><p className="text-xs text-faint">Risk puanı</p><p className="num text-5xl font-semibold leading-none">{r.score}<span className="text-xl text-faint">/25</span></p></div>
              <span className="text-sm font-medium">{band.label}</span>
            </div>
            <dl className="divide-y divide-line-soft">
              <InfoRow label="Olasılık">{r.probability} — {PROBABILITY_LABEL[r.probability]}</InfoRow>
              <InfoRow label="Etki">{r.impact} — {IMPACT_LABEL[r.impact]}</InfoRow>
              <InfoRow label="Sorumlu">{r.owner_id ? <Link to={`/ekip/${r.owner_id}`} className="hover:text-accent-2">{fullName(names.get(r.owner_id))}</Link> : <span className="text-warning">Atanmadı</span>}</InfoRow>
              <InfoRow label="Proje">{project ? <Link to={`/projeler/${project.id}`} className="hover:text-accent-2">{project.code} — {project.name}</Link> : "—"}</InfoRow>
              <InfoRow label="Departman">{dept ? <Link to={`/departmanlar/${dept.id}`} className="hover:text-accent-2">{dept.name}</Link> : "—"}</InfoRow>
              <InfoRow label="Son değerlendirme">{formatDate(r.last_reviewed_at)}</InfoRow>
              <InfoRow label="Kaydeden">{r.created_by ? fullName(names.get(r.created_by)) : "—"} · {formatDateTime(r.created_at)}</InfoRow>
            </dl>
          </Card>
        </div>
      </div>

      {modal === "edit" && <RiskForm risk={r} departments={data.departments} projects={data.projects} people={data.dir} onClose={() => setModal(null)} onSaved={() => { setModal(null); reload(); }} />}
      <Modal open={modal === "delete"} onClose={() => setModal(null)} title="Riski sil"
        footer={<><button className="btn-secondary" onClick={() => setModal(null)} disabled={busy}>Vazgeç</button>
          <button className="btn-danger" onClick={() => void remove()} disabled={busy}>{busy && <Spinner className="size-4" />} Evet, sil</button></>}>
        <p className="text-sm"><span className="code-tag">{r.code}</span> kalıcı olarak silinecek. Genellikle silmek yerine “Kapandı” durumuna almak, risk geçmişini korur.</p>
      </Modal>
    </>
  );
}
