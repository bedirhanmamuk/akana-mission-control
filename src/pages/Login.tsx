import { useEffect, useState, type FormEvent } from "react";
import { Navigate, useLocation } from "react-router-dom";
import { AlertCircle, Eye, EyeOff, Lock, Mail } from "lucide-react";
import { useAuth } from "../context/AuthContext";
import { Spinner } from "../components/ui";
import LaunchBackdrop from "../components/LaunchBackdrop";
import { prefersReducedMotion } from "../lib/motion";

/** Başarılı girişten sonra fırlatma animasyonunun süresi (ms). */
const LAUNCH_MS = 950;

export default function Login() {
  const { session, loading, signIn } = useAuth();
  const location = useLocation();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [show, setShow] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [shake, setShake] = useState(0);
  // Bu ekrandan yapılan başarılı girişte kısa bir "kalkış" oynar; zaten oturumu olan kullanıcı beklemeden yönlendirilir.
  const [launch, setLaunch] = useState<"idle" | "playing" | "done">("idle");

  useEffect(() => {
    if (launch !== "playing") return;
    const t = window.setTimeout(() => setLaunch("done"), LAUNCH_MS);
    return () => window.clearTimeout(t);
  }, [launch]);

  if (session && !loading && launch !== "playing") {
    const from = (location.state as { from?: string } | null)?.from;
    return <Navigate to={from && from !== "/giris" ? from : "/"} replace />;
  }

  const launching = launch === "playing";

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    if (busy) return;
    setError(null);
    if (!email.trim() || !password) return setError("E-posta ve şifre zorunludur.");
    setBusy(true);
    try {
      await signIn(email, password);
      if (!prefersReducedMotion()) setLaunch("playing");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Giriş yapılamadı.");
      setShake((n) => n + 1);
      setBusy(false);
    }
  }

  return (
    <div data-theme="dark" className="relative flex min-h-dvh items-center justify-center overflow-hidden bg-bg px-4 py-8 pb-[max(2rem,env(safe-area-inset-bottom))]">
      <LaunchBackdrop boost={launching} />
      <div className="relative w-full max-w-sm">
        <div className="mb-8 flex flex-col items-center text-center">
          <div data-testid="login-logo"
            className={`mb-5 flex size-20 items-center justify-center rounded-3xl bg-logo-tile shadow-[0_24px_50px_-18px_rgb(217_164_65/0.55)] ${launching ? "animate-[liftoff_0.95s_cubic-bezier(0.5,0,0.9,0.4)_forwards]" : "animate-[logo-in_0.9s_var(--ease-out)_backwards]"}`}>
            <img src={`${import.meta.env.BASE_URL}logo.png`} alt="AKANA logosu" className="size-14" />
          </div>
          <div className={`transition-[opacity,transform] duration-300 ${launching ? "translate-y-2 opacity-0" : ""}`}>
            <h1 className="display animate-[rise_0.5s_var(--ease-out)_0.35s_backwards] text-2xl font-bold tracking-[0.2em]">AKANA</h1>
            <p className="mt-1 animate-[rise_0.5s_var(--ease-out)_0.45s_backwards] text-sm font-medium text-accent-2">Yönetim Paneli</p>
          </div>
        </div>

        <div className={`transition-[opacity,transform] duration-300 ${launching ? "pointer-events-none translate-y-3 scale-[0.98] opacity-0" : ""}`}>
        <div key={shake} className={shake ? "animate-[shake_0.4s_ease-in-out]" : "animate-[rise_0.55s_var(--ease-out)_0.55s_backwards]"}>
        <form onSubmit={onSubmit} className="card space-y-4 bg-card/92 p-6 backdrop-blur-md" noValidate>
          <div>
            <h2 className="font-semibold">Sisteme giriş</h2>
            <p className="mt-1 text-xs text-muted">Hesabınız takım yöneticisi tarafından oluşturulur.</p>
          </div>
          <label className="block">
            <span className="label">E-posta</span>
            <div className="relative">
              <Mail className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted" />
              <input type="email" name="email" autoComplete="username" className="input pl-9" value={email}
                onChange={(e) => setEmail(e.target.value)} placeholder="ad.soyad@ornek.com" required autoFocus={window.matchMedia("(pointer: fine)").matches} inputMode="email" autoCapitalize="none" autoCorrect="off" spellCheck={false} />
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
          <button type="submit" className="btn-primary min-h-11 w-full" disabled={busy}>
            {busy && <Spinner className="size-4 text-current" />} {busy ? "Bağlanılıyor…" : "Giriş yap"}
          </button>
        </form>
        </div>
        <p className="mt-6 text-center text-[11px] text-ink/60">AKANA Roket Takımı</p>
        </div>
      </div>
      {launching && (
        <p className="absolute inset-0 flex animate-[backdrop-in_0.4s_ease_0.45s_backwards] items-center justify-center display text-lg tracking-[0.08em]" role="status">Panel açılıyor…</p>
      )}
    </div>
  );
}
