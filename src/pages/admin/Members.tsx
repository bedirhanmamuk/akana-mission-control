import { useMemo, useState, type FormEvent } from "react";
import { Copy, KeyRound, Pencil, RefreshCw, Search, UserPlus, Users } from "lucide-react";
import { supabase } from "../../lib/supabase";
import { useAuth } from "../../context/AuthContext";
import { useToast } from "../../context/ToastContext";
import { useAsync } from "../../lib/useAsync";
import { adminUsers, fetchDepartments, fetchProfiles } from "../../lib/api";
import { errorMessage } from "../../lib/errors";
import { ROLE_LABEL } from "../../lib/constants";
import { formatDate, fullName } from "../../lib/format";
import type { Department, Profile, UserRole } from "../../lib/types";
import { Badge, EmptyState, ErrorState, Field, LoadingState, Modal, PageHeader, Spinner } from "../../components/ui";

function generatePassword(): string {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789!@#%*";
  const buf = new Uint32Array(14);
  crypto.getRandomValues(buf);
  return Array.from(buf, (n) => chars[n % chars.length]).join("");
}

function PasswordField({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  const toast = useToast();
  return (
    <Field label="Geçici şifre" required hint="En az 8 karakter. Üyeye güvenli bir kanaldan iletin; üye ilk girişte Profil ekranından değiştirmelidir.">
      <div className="flex gap-2">
        <input className="input font-mono" value={value} onChange={(e) => onChange(e.target.value)} name="password" autoComplete="off" />
        <button type="button" className="btn-secondary px-3" onClick={() => onChange(generatePassword())} aria-label="Şifre üret" title="Şifre üret"><RefreshCw className="size-4" /></button>
        <button type="button" className="btn-secondary px-3" aria-label="Şifreyi kopyala" title="Kopyala"
          onClick={() => void navigator.clipboard?.writeText(value).then(() => toast.info("Şifre panoya kopyalandı."))}><Copy className="size-4" /></button>
      </div>
    </Field>
  );
}

function CreateMemberModal({ departments, onClose, onSaved }: { departments: Department[]; onClose: () => void; onSaved: () => void }) {
  const toast = useToast();
  const [form, setForm] = useState({ first_name: "", last_name: "", email: "", department_id: "", role: "MEMBER" as UserRole, password: generatePassword() });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function save(e: FormEvent) {
    e.preventDefault();
    setError(null);
    if (!form.first_name.trim() || !form.last_name.trim()) return setError("Ad ve soyad zorunludur.");
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(form.email.trim())) return setError("Geçerli bir e-posta adresi girin.");
    if (form.password.length < 8) return setError("Geçici şifre en az 8 karakter olmalıdır.");
    setBusy(true);
    try {
      await adminUsers({ action: "create", ...form, department_id: form.department_id || null });
      toast.success(`${form.first_name} ${form.last_name} ekibe eklendi.`);
      onSaved();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal open onClose={onClose} title="Yeni ekip üyesi" wide
      footer={<><button className="btn-secondary" onClick={onClose} disabled={busy}>Vazgeç</button>
        <button className="btn-primary" type="submit" form="member-form" disabled={busy}>{busy && <Spinner className="size-4 text-white" />} Üyeyi oluştur</button></>}>
      <form id="member-form" onSubmit={save} className="space-y-4">
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Ad" required><input className="input" value={form.first_name} maxLength={60} onChange={(e) => setForm({ ...form, first_name: e.target.value })} name="first_name" /></Field>
          <Field label="Soyad" required><input className="input" value={form.last_name} maxLength={60} onChange={(e) => setForm({ ...form, last_name: e.target.value })} name="last_name" /></Field>
        </div>
        <Field label="E-posta" required><input type="email" className="input" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} name="email" autoComplete="off" /></Field>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Departman">
            <select className="input" value={form.department_id} onChange={(e) => setForm({ ...form, department_id: e.target.value })} name="department">
              <option value="">Atanmadı</option>
              {departments.filter((d) => d.is_active).map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
            </select>
          </Field>
          <Field label="Rol" required>
            <select className="input" value={form.role} onChange={(e) => setForm({ ...form, role: e.target.value as UserRole })} name="role">
              <option value="MEMBER">{ROLE_LABEL.MEMBER}</option>
              <option value="ADMIN">{ROLE_LABEL.ADMIN}</option>
            </select>
          </Field>
        </div>
        <PasswordField value={form.password} onChange={(password) => setForm({ ...form, password })} />
        {error && <p className="rounded-lg border border-danger/40 bg-danger/10 px-3 py-2 text-sm text-danger" role="alert">{error}</p>}
      </form>
    </Modal>
  );
}

function EditMemberModal({ member, departments, isSelf, onClose, onSaved }: {
  member: Profile; departments: Department[]; isSelf: boolean; onClose: () => void; onSaved: () => void;
}) {
  const toast = useToast();
  const [form, setForm] = useState({
    first_name: member.first_name, last_name: member.last_name, email: member.email,
    department_id: member.department_id ?? "", role: member.role, is_active: member.is_active,
  });
  const [newPassword, setNewPassword] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function save(e: FormEvent) {
    e.preventDefault();
    setError(null);
    if (!form.first_name.trim() || !form.last_name.trim()) return setError("Ad ve soyad zorunludur.");
    const email = form.email.trim().toLowerCase();
    setBusy(true);
    try {
      // Rol/departman/durum: RLS yalnızca yöneticiye izin verir; son yönetici koruması veritabanındadır.
      const { error: err } = await supabase.from("profiles").update({
        first_name: form.first_name.trim(), last_name: form.last_name.trim(),
        department_id: form.department_id || null, role: form.role, is_active: form.is_active,
      }).eq("id", member.id);
      if (err) throw err;
      if (email !== member.email.toLowerCase()) await adminUsers({ action: "update_email", user_id: member.id, email });
      toast.success("Üye bilgileri güncellendi.");
      onSaved();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  async function resetPassword() {
    if (!newPassword || newPassword.length < 8) return setError("Şifre en az 8 karakter olmalıdır.");
    setError(null);
    setBusy(true);
    try {
      await adminUsers({ action: "reset_password", user_id: member.id, password: newPassword });
      toast.success("Şifre sıfırlandı. Yeni şifreyi üyeye güvenli bir kanaldan iletin.");
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal open onClose={onClose} title={`${fullName(member)} — düzenle`} wide
      footer={<><button className="btn-secondary" onClick={onClose} disabled={busy}>Kapat</button>
        <button className="btn-primary" type="submit" form="member-edit" disabled={busy}>{busy && <Spinner className="size-4 text-white" />} Kaydet</button></>}>
      <form id="member-edit" onSubmit={save} className="space-y-4">
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Ad" required><input className="input" value={form.first_name} maxLength={60} onChange={(e) => setForm({ ...form, first_name: e.target.value })} /></Field>
          <Field label="Soyad" required><input className="input" value={form.last_name} maxLength={60} onChange={(e) => setForm({ ...form, last_name: e.target.value })} /></Field>
        </div>
        <Field label="E-posta" required><input type="email" className="input" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} /></Field>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Departman">
            <select className="input" value={form.department_id} onChange={(e) => setForm({ ...form, department_id: e.target.value })} name="department">
              <option value="">Atanmadı</option>
              {departments.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
            </select>
          </Field>
          <Field label="Rol" hint={isSelf ? "Kendi rolünüzü değiştiremezsiniz." : undefined}>
            <select className="input" value={form.role} disabled={isSelf} onChange={(e) => setForm({ ...form, role: e.target.value as UserRole })} name="role">
              <option value="MEMBER">{ROLE_LABEL.MEMBER}</option>
              <option value="ADMIN">{ROLE_LABEL.ADMIN}</option>
            </select>
          </Field>
        </div>
        <label className={`flex min-h-10 items-center gap-3 text-sm ${isSelf ? "opacity-50" : "cursor-pointer"}`}>
          <input type="checkbox" className="size-4" checked={form.is_active} disabled={isSelf} name="is_active"
            onChange={(e) => setForm({ ...form, is_active: e.target.checked })} />
          Hesap aktif <span className="text-xs text-muted">(pasif hesaplar giriş yapsa bile hiçbir veriye erişemez)</span>
        </label>
      </form>

      <div className="mt-5 border-t border-line pt-4">
        <p className="mb-2 flex items-center gap-2 text-sm font-medium"><KeyRound className="size-4" /> Şifre sıfırlama</p>
        {newPassword === null ? (
          <button className="btn-secondary" onClick={() => setNewPassword(generatePassword())}>Yeni geçici şifre oluştur</button>
        ) : (
          <div className="space-y-3">
            <PasswordField value={newPassword} onChange={setNewPassword} />
            <button className="btn-warning" onClick={() => void resetPassword()} disabled={busy}>Şifreyi sıfırla</button>
          </div>
        )}
      </div>
      {error && <p className="mt-4 rounded-lg border border-danger/40 bg-danger/10 px-3 py-2 text-sm text-danger" role="alert">{error}</p>}
    </Modal>
  );
}

export default function Members() {
  const { profile } = useAuth();
  const [query, setQuery] = useState("");
  const [dept, setDept] = useState("");
  const [creating, setCreating] = useState(false);
  const [editing, setEditing] = useState<Profile | null>(null);

  const { data, loading, error, reload } = useAsync(async () => {
    const [members, departments] = await Promise.all([fetchProfiles(), fetchDepartments()]);
    return { members, departments, deptName: new Map(departments.map((d) => [d.id, d.name])) };
  }, []);

  const filtered = useMemo(() => {
    if (!data) return [];
    const q = query.trim().toLocaleLowerCase("tr-TR");
    return data.members.filter((m) =>
      (!dept || (dept === "none" ? !m.department_id : m.department_id === dept)) &&
      (!q || `${m.first_name} ${m.last_name} ${m.email}`.toLocaleLowerCase("tr-TR").includes(q)));
  }, [data, query, dept]);

  return (
    <>
      <PageHeader title="Üye Yönetimi" description="Ekip üyelerini ekleyin, departmanlarını ve yetkilerini yönetin."
        actions={<button className="btn-primary" onClick={() => setCreating(true)}><UserPlus className="size-4" /> Üye ekle</button>} />

      <div className="mb-4 flex flex-col gap-3 sm:flex-row">
        <div className="relative flex-1">
          <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted" />
          <input className="input pl-9" placeholder="Ad, soyad veya e-posta ara…" value={query} onChange={(e) => setQuery(e.target.value)} aria-label="Üye ara" />
        </div>
        <select className="input sm:w-56" value={dept} onChange={(e) => setDept(e.target.value)} aria-label="Departmana göre filtrele">
          <option value="">Tüm departmanlar</option>
          <option value="none">Departmanı olmayanlar</option>
          {data?.departments.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
        </select>
      </div>

      {loading ? <LoadingState /> : error || !data ? <ErrorState message={error ?? ""} onRetry={reload} /> : filtered.length === 0 ? (
        <EmptyState icon={<Users className="size-6" />} title="Üye bulunamadı" description="Arama ölçütlerini değiştirin veya yeni üye ekleyin." />
      ) : (
        <div className="card overflow-hidden">
          <table className="hidden w-full md:table">
            <thead className="border-b border-line-soft">
              <tr><th className="th">Ad Soyad</th><th className="th">E-posta</th><th className="th">Departman</th><th className="th">Rol</th><th className="th">Durum</th><th className="th">Kayıt</th><th className="th" /></tr>
            </thead>
            <tbody className="divide-y divide-line-soft">
              {filtered.map((m) => (
                <tr key={m.id} className="transition-colors hover:bg-ink/[0.04]" data-testid="member-row">
                  <td className="td font-medium">{fullName(m)}</td>
                  <td className="td text-muted">{m.email}</td>
                  <td className="td text-muted">{m.department_id ? data.deptName.get(m.department_id) ?? "—" : "—"}</td>
                  <td className="td"><Badge tone={m.role === "ADMIN" ? "accent" : "neutral"}>{ROLE_LABEL[m.role]}</Badge></td>
                  <td className="td"><Badge tone={m.is_active ? "success" : "danger"}>{m.is_active ? "Aktif" : "Pasif"}</Badge></td>
                  <td className="td whitespace-nowrap text-muted">{formatDate(m.created_at)}</td>
                  <td className="td text-right"><button className="btn-ghost min-h-9 px-2.5" onClick={() => setEditing(m)} aria-label={`${fullName(m)} üyesini düzenle`}><Pencil className="size-4" /></button></td>
                </tr>
              ))}
            </tbody>
          </table>
          <ul className="divide-y divide-line-soft md:hidden">
            {filtered.map((m) => (
              <li key={m.id} className="flex items-center gap-3 p-4" data-testid="member-row">
                <div className="min-w-0 flex-1 space-y-1">
                  <p className="text-sm font-medium">{fullName(m)}</p>
                  <p className="truncate text-xs text-muted">{m.email}</p>
                  <div className="flex flex-wrap gap-1.5">
                    <Badge tone={m.role === "ADMIN" ? "accent" : "neutral"}>{ROLE_LABEL[m.role]}</Badge>
                    <Badge tone={m.is_active ? "success" : "danger"}>{m.is_active ? "Aktif" : "Pasif"}</Badge>
                    {m.department_id && <Badge>{data.deptName.get(m.department_id)}</Badge>}
                  </div>
                </div>
                <button className="btn-secondary px-3" onClick={() => setEditing(m)} aria-label={`${fullName(m)} üyesini düzenle`}><Pencil className="size-4" /></button>
              </li>
            ))}
          </ul>
        </div>
      )}

      {creating && data && <CreateMemberModal departments={data.departments} onClose={() => setCreating(false)} onSaved={() => { setCreating(false); reload(); }} />}
      {editing && data && <EditMemberModal member={editing} departments={data.departments} isSelf={editing.id === profile?.id}
        onClose={() => setEditing(null)} onSaved={() => { setEditing(null); reload(); }} />}
    </>
  );
}
