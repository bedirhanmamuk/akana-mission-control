import { useState, type FormEvent } from "react";
import { supabase } from "../lib/supabase";
import { useToast } from "../context/ToastContext";
import { errorMessage } from "../lib/errors";
import { IMPACT_LABEL, PROBABILITY_LABEL, RISK_STATUSES, RISK_STATUS_META, riskBand } from "../lib/constants";
import { fullName, todayISO } from "../lib/format";
import type { Department, DirectoryEntry, Project, Risk, RiskStatus } from "../lib/types";
import { Field, FormError, Modal, RiskScore, Spinner } from "./ui";

export default function RiskForm({ risk, departments, projects, people, onClose, onSaved }: {
  risk: Risk | null; departments: Department[]; projects: Pick<Project, "id" | "code" | "name">[]; people: DirectoryEntry[];
  onClose: () => void; onSaved: (id: string) => void;
}) {
  const toast = useToast();
  const [form, setForm] = useState({
    title: risk?.title ?? "", description: risk?.description ?? "",
    project_id: risk?.project_id ?? "", department_id: risk?.department_id ?? "", owner_id: risk?.owner_id ?? "",
    probability: risk?.probability ?? 3, impact: risk?.impact ?? 3,
    mitigation: risk?.mitigation ?? "", contingency: risk?.contingency ?? "",
    status: (risk?.status ?? "OPEN") as RiskStatus, last_reviewed_at: risk?.last_reviewed_at ?? todayISO(),
  });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const score = form.probability * form.impact;

  async function save(e: FormEvent) {
    e.preventDefault();
    setError(null);
    if (form.title.trim().length < 3) return setError("Risk başlığı en az 3 karakter olmalıdır.");
    setBusy(true);
    const payload = { ...form, title: form.title.trim(), project_id: form.project_id || null, department_id: form.department_id || null, owner_id: form.owner_id || null };
    const res = risk
      ? await supabase.from("risks").update(payload).eq("id", risk.id).select("id")
      : await supabase.from("risks").insert(payload).select("id");
    setBusy(false);
    if (res.error) return setError(errorMessage(res.error));
    if (!res.data?.length) return setError("Bu riski güncelleme yetkiniz yok. Riski yalnızca oluşturan, sorumlusu, departman sorumlusu veya yönetici değiştirebilir.");
    toast.success(risk ? "Risk güncellendi." : "Risk kaydedildi; ilgili kişiler bilgilendirildi.");
    onSaved(res.data[0].id as string);
  }

  const scale = (value: number, set: (n: number) => void, labels: string[], name: string) => (
    <div className="grid grid-cols-5 gap-1" role="radiogroup" aria-label={name}>
      {[1, 2, 3, 4, 5].map((n) => (
        <button key={n} type="button" role="radio" aria-checked={value === n} onClick={() => set(n)} title={labels[n]}
          className={`flex min-h-12 flex-col items-center justify-center rounded-lg text-xs transition-colors ${value === n ? "bg-accent font-semibold text-on-accent" : "bg-surface text-muted hover:text-ink"}`}>
          <span className="num text-base">{n}</span><span className="hidden text-[10px] sm:block">{labels[n]}</span>
        </button>
      ))}
    </div>
  );

  return (
    <Modal open onClose={onClose} title={risk ? `${risk.code} — riski düzenle` : "Risk kaydet"} wide
      footer={<><button className="btn-secondary" onClick={onClose} disabled={busy}>Vazgeç</button>
        <button className="btn-primary" type="submit" form="risk-form" disabled={busy}>{busy && <Spinner className="size-4 text-current" />} {risk ? "Kaydet" : "Riski kaydet"}</button></>}>
      <form id="risk-form" onSubmit={save} className="space-y-4">
        <Field label="Risk başlığı" required><input className="input" name="risk-title" value={form.title} maxLength={160} onChange={(e) => setForm({ ...form, title: e.target.value })} placeholder="Örn. Ana paraşüt açılmama riski" /></Field>
        <Field label="Açıklama"><textarea className="input min-h-20" value={form.description} maxLength={5000} onChange={(e) => setForm({ ...form, description: e.target.value })} placeholder="Neden oluşur, hangi alt sistemi etkiler, belirtileri nelerdir?" /></Field>
        <div>
          <span className="label">Olasılık <span className="text-danger">*</span></span>
          {scale(form.probability, (n) => setForm({ ...form, probability: n }), PROBABILITY_LABEL, "Olasılık")}
        </div>
        <div>
          <span className="label">Etki <span className="text-danger">*</span></span>
          {scale(form.impact, (n) => setForm({ ...form, impact: n }), IMPACT_LABEL, "Etki")}
        </div>
        <p className="flex items-center gap-2 text-sm text-muted">Risk puanı (olasılık × etki): <RiskScore score={score} /> <span className="text-xs">{riskBand(score).label} bandı</span></p>
        <div className="grid gap-4 sm:grid-cols-3">
          <Field label="Proje"><select className="input" value={form.project_id} onChange={(e) => setForm({ ...form, project_id: e.target.value })}>
            <option value="">—</option>{projects.map((p) => <option key={p.id} value={p.id}>{p.code} — {p.name}</option>)}</select></Field>
          <Field label="Departman"><select className="input" value={form.department_id} onChange={(e) => setForm({ ...form, department_id: e.target.value })}>
            <option value="">—</option>{departments.filter((d) => d.is_active).map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}</select></Field>
          <Field label="Risk sorumlusu"><select className="input" value={form.owner_id} onChange={(e) => setForm({ ...form, owner_id: e.target.value })}>
            <option value="">Atanmadı</option>{people.filter((p) => p.is_active).map((p) => <option key={p.id} value={p.id}>{fullName(p)}</option>)}</select></Field>
        </div>
        <Field label="Önleyici faaliyet" hint="Olasılığı veya etkiyi düşürmek için yapılacaklar."><textarea className="input min-h-20" value={form.mitigation} maxLength={3000} onChange={(e) => setForm({ ...form, mitigation: e.target.value })} /></Field>
        <Field label="Alternatif çözüm (B planı)" hint="Risk gerçekleşirse uygulanacak plan."><textarea className="input min-h-20" value={form.contingency} maxLength={3000} onChange={(e) => setForm({ ...form, contingency: e.target.value })} /></Field>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Durum"><select className="input" value={form.status} onChange={(e) => setForm({ ...form, status: e.target.value as RiskStatus })}>
            {RISK_STATUSES.map((s) => <option key={s} value={s}>{RISK_STATUS_META[s].label}</option>)}</select></Field>
          <Field label="Son değerlendirme" hint="Olasılık, etki veya durum değişince otomatik bugüne alınır."><input type="date" className="input" value={form.last_reviewed_at} max={todayISO()} onChange={(e) => setForm({ ...form, last_reviewed_at: e.target.value })} /></Field>
        </div>
        <FormError>{error}</FormError>
      </form>
    </Modal>
  );
}
