import { useState, type FormEvent } from "react";
import { Navigate, useLocation } from "react-router-dom";
import { AlertCircle, Eye, EyeOff, Lock, Mail } from "lucide-react";
import { useAuth } from "../context/AuthContext";
import { Spinner } from "../components/ui";
import OrbitScene from "../components/OrbitScene";

export default function Login() {
  const { session, loading, signIn } = useAuth();
  const location = useLocation();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [show, setShow] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (session && !loading) {
    const from = (location.state as { from?: string } | null)?.from;
    return <Navigate to={from && from !== "/giris" ? from : "/"} replace />;
  }

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    if (busy) return;
    setError(null);
    if (!email.trim() || !password) return setError("E-posta ve şifre zorunludur.");
    setBusy(true);
    try {
      await signIn(email, password);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Giriş yapılamadı.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="relative flex min-h-dvh items-center justify-center overflow-hidden p-4">
      <OrbitScene />
      <div className="relative w-full max-w-sm animate-rise">
        <div className="mb-8 flex flex-col items-center text-center">
          <div className="mb-5 flex size-20 items-center justify-center rounded-3xl bg-ink shadow-[0_24px_50px_-18px_rgb(128_101_216/0.9)]">
            <img src={`${import.meta.env.BASE_URL}logo.png`} alt="AKANA logosu" className="size-14" />
          </div>
          <h1 className="display text-2xl font-bold tracking-[0.2em]">AKANA</h1>
          <p className="mt-1 text-sm font-medium text-accent-2">Görev Paneli</p>
        </div>

        <form onSubmit={onSubmit} className="card space-y-4 bg-card/95 p-6" noValidate>
          <div>
            <h2 className="font-semibold">Sisteme giriş</h2>
            <p className="mt-1 text-xs text-muted">Hesabınız takım yöneticisi tarafından oluşturulur.</p>
          </div>
          <label className="block">
            <span className="label">E-posta</span>
            <div className="relative">
              <Mail className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted" />
              <input type="email" name="email" autoComplete="username" className="input pl-9" value={email}
                onChange={(e) => setEmail(e.target.value)} placeholder="ad.soyad@ornek.com" required autoFocus />
            </div>
          </label>
          <label className="block">
            <span className="label">Şifre</span>
            <div className="relative">
              <Lock className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted" />
              <input type={show ? "text" : "password"} name="password" autoComplete="current-password" className="input px-9"
                value={password} onChange={(e) => setPassword(e.target.value)} required />
              <button type="button" onClick={() => setShow((s) => !s)} className="absolute top-1/2 right-2 -translate-y-1/2 rounded p-1.5 text-muted hover:text-ink"
                aria-label={show ? "Şifreyi gizle" : "Şifreyi göster"}>
                {show ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
              </button>
            </div>
          </label>
          {error && (
            <div className="flex items-start gap-2 rounded-lg border border-danger/40 bg-danger/10 px-3 py-2 text-sm text-danger" role="alert">
              <AlertCircle className="mt-0.5 size-4 shrink-0" /> {error}
            </div>
          )}
          <button type="submit" className="btn-primary w-full" disabled={busy}>
            {busy && <Spinner className="size-4 text-white" />} Giriş yap
          </button>
        </form>
        <p className="mt-6 text-center text-[11px] text-muted/70">AKANA Roket Takımı · Görev, Raporlama ve Dokümantasyon Yönetim Sistemi</p>
      </div>
    </div>
  );
}
