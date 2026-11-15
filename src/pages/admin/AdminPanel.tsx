import { useState, type FormEvent } from "react";
import { Link } from "react-router-dom";
import { ClipboardCheck, FilePlus2, HardDrive, Pencil, Plus, ScrollText, Trash2, Users } from "lucide-react";
import { supabase } from "../../lib/supabase";
import { useToast } from "../../context/ToastContext";
import { useAsync } from "../../lib/useAsync";
import { fetchDepartmentStats, fetchDepartments, fetchDirectory, fetchMaxFileSizeMb } from "../../lib/api";
import { errorMessage } from "../../lib/errors";
import { fullName } from "../../lib/format";
import type { Department, DirectoryEntry } from "../../lib/types";
import { Badge, Card, ErrorState, Field, LoadingState, Modal, PageHeader, SectionTitle, Spinner } from "../../components/ui";

function DepartmentModal({ department, people, onClose, onSaved }: {
  department: Department | null; people: DirectoryEntry[]; onClose: () => void; onSaved: () => void;
}) {
  const toast = useToast();
  const [form, setForm] = useState({
    name: department?.name ?? "", code: department?.code ?? "", description: department?.description ?? "",
    lead_id: department?.lead_id ?? "", is_active: department?.is_active ?? true,
  });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const codeLocked = Boolean(department && department.task_seq > 0);

  async function save(e: FormEvent) {
    e.preventDefault();
    setError(null);
    const code = form.code.trim().toUpperCase();
    if (form.name.trim().length < 2) return setError("Departman adı en az 2 karakter olmalıdır.");
    if (!/^[A-Z]{3}$/.test(code)) return setError("Departman kodu 3 harften oluşmalıdır (A–Z). Örn: MEK");
    const payload = { name: form.name.trim(), code, description: form.description.trim(), lead_id: form.lead_id || null, is_active: form.is_active };
    setBusy(true);
    const { error: err } = department
      ? await supabase.from("departments").update(payload).eq("id", department.id)
      : await supabase.from("departments").insert(payload);
    setBusy(false);
    if (err) return setError(err.code === "23505" ? "Bu ad veya kodla bir departman zaten var." : errorMessage(err));
    toast.success(department ? "Departman güncellendi." : "Departman oluşturuldu.");
    onSaved();
  }

  return (
    <Modal open onClose={onClose} title={department ? "Departmanı düzenle" : "Yeni departman"}
      footer={<><button className="btn-secondary" onClick={onClose} disabled={busy}>Vazgeç</button>
        <button className="btn-primary" type="submit" form="dept-form" disabled={busy}>{busy && <Spinner className="size-4 text-white" />} Kaydet</button></>}>
      <form id="dept-form" onSubmit={save} className="space-y-4">
        <div className="grid gap-4 sm:grid-cols-[1fr_120px]">
          <Field label="Departman adı" required><input className="input" value={form.name} maxLength={60} onChange={(e) => setForm({ ...form, name: e.target.value })} name="dept-name" /></Field>
          <Field label="Kod" required hint={codeLocked ? "Görev üretildi; değişmez" : "Görev kodunda kullanılır"}>
            <input className="input font-mono uppercase" value={form.code} maxLength={3} disabled={codeLocked} onChange={(e) => setForm({ ...form, code: e.target.value.toUpperCase() })} name="dept-code" />
          </Field>
        </div>
        <Field label="Açıklama"><textarea className="input min-h-16" value={form.description} maxLength={500} onChange={(e) => setForm({ ...form, description: e.target.value })} /></Field>
        <Field label="Departman sorumlusu">
          <select className="input" value={form.lead_id} onChange={(e) => setForm({ ...form, lead_id: e.target.value })} name="dept-lead">
            <option value="">Atanmadı</option>
            {people.filter((p) => p.is_active).map((p) => <option key={p.id} value={p.id}>{fullName(p)}</option>)}
          </select>
        </Field>
        <label className="flex min-h-10 cursor-pointer items-center gap-3 text-sm">
          <input type="checkbox" className="size-4 accent-[#8065D8]" checked={form.is_active} onChange={(e) => setForm({ ...form, is_active: e.target.checked })} />
          Aktif (pasif departmanlara yeni görev oluşturulamaz)
        </label>
        {error && <p className="rounded-lg border border-danger/40 bg-danger/10 px-3 py-2 text-sm text-danger" role="alert">{error}</p>}
      </form>
    </Modal>
  );
}

const SHORTCUTS = [
  { to: "/yonetim/uyeler", label: "Üye Yönetimi", desc: "Üye ekle, düzenle, pasifleştir", icon: Users },
  { to: "/yonetim/gorev-olustur", label: "Görev Oluştur", desc: "Departmana görev ata", icon: FilePlus2 },
  { to: "/yonetim/rapor-inceleme", label: "Rapor İnceleme", desc: "Onay, revizyon, ret", icon: ClipboardCheck },
  { to: "/yonetim/kayitlar", label: "Sistem Kayıtları", desc: "Denetim izleri", icon: ScrollText },
];

export default function AdminPanel() {
  const toast = useToast();
  const [modal, setModal] = useState<{ department: Department | null } | null>(null);
  const [maxMb, setMaxMb] = useState<string | null>(null);
  const [savingMb, setSavingMb] = useState(false);

  const { data, loading, error, reload } = useAsync(async () => {
    const [departments, stats, people, mb] = await Promise.all([fetchDepartments(), fetchDepartmentStats(), fetchDirectory(), fetchMaxFileSizeMb()]);
    return { departments, stats: new Map(stats.map((s) => [s.department_id, s])), people, mb };
  }, []);

  async function removeDepartment(d: Department) {
    if (!window.confirm(`"${d.name}" departmanı silinsin mi? Görevi olan departmanlar silinemez.`)) return;
    const { error: err } = await supabase.from("departments").delete().eq("id", d.id);
    if (err) return toast.error(err.code === "23503" ? "Bu departmana ait görevler olduğu için silinemez. Bunun yerine pasif hâle getirebilirsiniz." : errorMessage(err));
    toast.success("Departman silindi.");
    reload();
  }

  async function saveMaxMb(e: FormEvent) {
    e.preventDefault();
    const n = Number(maxMb);
    if (!Number.isInteger(n) || n < 1 || n > 500) return toast.error("Sınır 1–500 MB aralığında bir tam sayı olmalıdır.");
    setSavingMb(true);
    const { error: err } = await supabase.rpc("set_max_file_size_mb", { p_mb: n });
    setSavingMb(false);
    if (err) return toast.error(errorMessage(err));
    toast.success(`Dosya boyutu sınırı ${n} MB olarak ayarlandı.`);
    setMaxMb(null);
    reload();
  }

  return (
    <>
      <PageHeader title="Yönetim Paneli" description="Departman yapısı, sistem ayarları ve yönetim araçları." />

      <div className="mb-6 grid grid-cols-2 gap-3 lg:grid-cols-4">
        {SHORTCUTS.map(({ to, label, desc, icon: Icon }) => (
          <Link key={to} to={to} className="card flex items-center gap-3 p-4 card-link">
            <div className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-accent/15 text-accent-2"><Icon className="size-5" /></div>
            <div className="min-w-0"><p className="truncate text-sm font-medium">{label}</p><p className="truncate text-xs text-muted">{desc}</p></div>
          </Link>
        ))}
      </div>

      {loading ? <LoadingState /> : error || !data ? <ErrorState message={error ?? ""} onRetry={reload} /> : (
        <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_340px]">
          <Card className="overflow-hidden">
            <div className="flex items-center justify-between border-b border-line-soft p-5">
              <h2 className="text-sm font-semibold">Departmanlar</h2>
              <button className="btn-primary min-h-9" onClick={() => setModal({ department: null })}><Plus className="size-4" /> Yeni departman</button>
            </div>
            <ul className="divide-y divide-line-soft">
              {data.departments.map((d) => {
                const s = data.stats.get(d.id);
                const lead = data.people.find((p) => p.id === d.lead_id);
                return (
                  <li key={d.id} className="flex flex-wrap items-center gap-3 px-5 py-3">
                    <span className="flex size-9 items-center justify-center rounded-lg bg-accent/15 font-mono text-[11px] font-bold text-accent-2">{d.code}</span>
                    <div className="min-w-0 flex-1">
                      <p className="flex items-center gap-2 text-sm font-medium">{d.name} {!d.is_active && <Badge>Pasif</Badge>}</p>
                      <p className="truncate text-xs text-muted">Sorumlu: {lead ? fullName(lead) : "Atanmadı"} · {s?.member_count ?? 0} üye · {s?.total_tasks ?? 0} görev</p>
                    </div>
                    <button className="btn-ghost min-h-9 px-2.5" onClick={() => setModal({ department: d })} aria-label={`${d.name} departmanını düzenle`}><Pencil className="size-4" /></button>
                    <button className="btn-ghost min-h-9 px-2.5 hover:text-danger" onClick={() => void removeDepartment(d)} aria-label={`${d.name} departmanını sil`}><Trash2 className="size-4" /></button>
                  </li>
                );
              })}
            </ul>
          </Card>

          <Card className="h-fit p-5">
            <SectionTitle><span className="flex items-center gap-2"><HardDrive className="size-4" /> Dosya yükleme ayarları</span></SectionTitle>
            <form onSubmit={saveMaxMb} className="space-y-3">
              <Field label="Dosya başına boyut sınırı (MB)" hint="Sınır hem uygulamada hem de depolama katmanında zorlanır.">
                <input type="number" min={1} max={500} step={1} className="input" value={maxMb ?? String(data.mb)} onChange={(e) => setMaxMb(e.target.value)} name="max-mb" />
              </Field>
              <button className="btn-secondary w-full" disabled={savingMb || maxMb === null || Number(maxMb) === data.mb}>
                {savingMb && <Spinner className="size-4" />} Sınırı güncelle
              </button>
            </form>
          </Card>
        </div>
      )}

      {modal && data && <DepartmentModal department={modal.department} people={data.people} onClose={() => setModal(null)} onSaved={() => { setModal(null); reload(); }} />}
    </>
  );
}
