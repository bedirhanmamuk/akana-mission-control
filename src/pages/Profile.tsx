import { useState, type FormEvent } from "react";
import { KeyRound, Moon, Save, Sun } from "lucide-react";
import { useTheme } from "../lib/theme";
import { supabase } from "../lib/supabase";
import { useAuth } from "../context/AuthContext";
import { useToast } from "../context/ToastContext";
import { useAsync } from "../lib/useAsync";
import { fetchDepartments } from "../lib/api";
import { errorMessage } from "../lib/errors";
import { POSITION_META, ROLE_LABEL } from "../lib/constants";
import { formatDate } from "../lib/format";
import { Avatar, Badge, Card, Field, InfoRow, PageHeader, SectionTitle, Spinner } from "../components/ui";
import ProfileDetails from "../components/ProfileDetails";

export default function Profile() {
  const { profile, refreshProfile } = useAuth();
  const toast = useToast();
  const [theme, setTheme] = useTheme();
  const p = profile!;
  const departments = useAsync(fetchDepartments, []);
  const [first, setFirst] = useState(p.first_name);
  const [last, setLast] = useState(p.last_name);
  const [saving, setSaving] = useState(false);
  const [current, setCurrent] = useState("");
  const [pw, setPw] = useState("");
  const [pw2, setPw2] = useState("");
  const [pwBusy, setPwBusy] = useState(false);
  const [pwError, setPwError] = useState<string | null>(null);

  async function saveName(e: FormEvent) {
    e.preventDefault();
    if (!first.trim() || !last.trim()) return toast.error("Ad ve soyad boş olamaz.");
    setSaving(true);
    const { error } = await supabase.rpc("update_own_profile", { p_first_name: first, p_last_name: last });
    setSaving(false);
    if (error) return toast.error(errorMessage(error));
    await refreshProfile();
    toast.success("Profil bilgileriniz güncellendi.");
  }

  async function changePassword(e: FormEvent) {
    e.preventDefault();
    setPwError(null);
    if (pw.length < 8) return setPwError("Yeni şifre en az 8 karakter olmalıdır.");
    if (pw !== pw2) return setPwError("Yeni şifreler birbiriyle eşleşmiyor.");
    setPwBusy(true);
    // Mevcut şifre doğrulanmadan şifre değiştirilmez.
    const check = await supabase.auth.signInWithPassword({ email: p.email, password: current });
    if (check.error) {
      setPwBusy(false);
      return setPwError("Mevcut şifreniz hatalı.");
    }
    const { error } = await supabase.auth.updateUser({ password: pw });
    setPwBusy(false);
    if (error) return setPwError(errorMessage(error));
    setCurrent(""); setPw(""); setPw2("");
    toast.success("Şifreniz değiştirildi.");
  }

  const dept = departments.data?.find((d) => d.id === p.department_id);

  return (
    <>
      <PageHeader title="Profil ve Ayarlar" description="Hesap, ekip profili ve güvenlik." />
      <div className="mb-4"><ProfileDetails /></div>
      <div className="grid gap-4 lg:grid-cols-2">
        <Card className="p-5">
          <div className="mb-5 flex items-center gap-4">
            <Avatar person={p} size={56} />
            <div className="min-w-0">
              <p className="truncate font-semibold">{p.first_name} {p.last_name}</p>
              <p className="truncate text-sm text-muted">{p.email}</p>
            </div>
          </div>
          <dl className="divide-y divide-line-soft">
            <InfoRow label="Rol"><Badge tone={p.role === "ADMIN" ? "accent" : "neutral"}>{ROLE_LABEL[p.role]}</Badge></InfoRow>
            <InfoRow label="Takım pozisyonu">{p.title || POSITION_META[p.team_position ?? "MEMBER"].label}</InfoRow>
            <InfoRow label="Departman">{dept?.name ?? (departments.loading ? "…" : "Atanmadı")}</InfoRow>
            <InfoRow label="Hesap durumu"><Badge tone="success">Aktif</Badge></InfoRow>
            <InfoRow label="Kayıt tarihi">{formatDate(p.created_at)}</InfoRow>
          </dl>
          <p className="mt-4 text-xs text-muted">E-posta, rol ve departmanı yalnızca yönetici değiştirir.</p>
        </Card>

        <div className="space-y-4">
          <Card className="p-5">
            <SectionTitle>Görünüm</SectionTitle>
            <div className="grid grid-cols-2 gap-2" role="radiogroup" aria-label="Tema">
              {([["dark", "Koyu", Moon], ["light", "Açık", Sun]] as const).map(([value, label, Icon]) => (
                <button key={value} type="button" role="radio" aria-checked={theme === value} onClick={() => setTheme(value)}
                  className={`flex min-h-12 items-center justify-center gap-2 rounded-lg text-sm font-medium transition-colors duration-150 active:scale-[0.98] ${theme === value ? "bg-accent text-on-accent" : "bg-surface text-muted hover:text-ink"}`}>
                  <Icon className="size-4" /> {label}
                </button>
              ))}
            </div>
            <p className="mt-3 text-xs text-muted">Bu cihazda hatırlanır.</p>
          </Card>

          <Card className="p-5">
            <SectionTitle>Kişisel bilgiler</SectionTitle>
            <form onSubmit={saveName} className="space-y-4">
              <div className="grid gap-4 sm:grid-cols-2">
                <Field label="Ad" required><input className="input" value={first} maxLength={60} onChange={(e) => setFirst(e.target.value)} name="first_name" /></Field>
                <Field label="Soyad" required><input className="input" value={last} maxLength={60} onChange={(e) => setLast(e.target.value)} name="last_name" /></Field>
              </div>
              <div className="flex justify-end">
                <button className="btn-primary" disabled={saving || (first === p.first_name && last === p.last_name)}>
                  {saving ? <Spinner className="size-4 text-current" /> : <Save className="size-4" />} Kaydet
                </button>
              </div>
            </form>
          </Card>

          <Card className="p-5">
            <SectionTitle>Şifre değiştir</SectionTitle>
            <form onSubmit={changePassword} className="space-y-4">
              <Field label="Mevcut şifre" required><input type="password" className="input" value={current} onChange={(e) => setCurrent(e.target.value)} autoComplete="current-password" required /></Field>
              <div className="grid gap-4 sm:grid-cols-2">
                <Field label="Yeni şifre" required hint="En az 8 karakter"><input type="password" className="input" value={pw} onChange={(e) => setPw(e.target.value)} autoComplete="new-password" required /></Field>
                <Field label="Yeni şifre (tekrar)" required><input type="password" className="input" value={pw2} onChange={(e) => setPw2(e.target.value)} autoComplete="new-password" required /></Field>
              </div>
              {pwError && <p className="rounded-lg border border-danger/40 bg-danger/10 px-3 py-2 text-sm text-danger" role="alert">{pwError}</p>}
              <div className="flex justify-end">
                <button className="btn-secondary" disabled={pwBusy || !current || !pw}>
                  {pwBusy ? <Spinner className="size-4" /> : <KeyRound className="size-4" />} Şifreyi değiştir
                </button>
              </div>
            </form>
          </Card>
        </div>
      </div>
    </>
  );
}
