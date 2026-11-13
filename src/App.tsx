import { Component, lazy, Suspense, type ReactNode } from "react";
import { Link, Navigate, Outlet, Route, Routes, useLocation } from "react-router-dom";
import { AlertTriangle, LogOut, ServerCog, UserX } from "lucide-react";
import { isSupabaseConfigured } from "./lib/supabase";
import { AuthProvider, useAuth } from "./context/AuthContext";
import { ToastProvider } from "./context/ToastContext";
import { NotificationProvider } from "./context/NotificationContext";
import AppLayout from "./components/AppLayout";
import { LoadingState, Unauthorized } from "./components/ui";
import Login from "./pages/Login";

const Dashboard = lazy(() => import("./pages/Dashboard"));
const MyTasks = lazy(() => import("./pages/MyTasks"));
const TaskDetail = lazy(() => import("./pages/TaskDetail"));
const Departments = lazy(() => import("./pages/Departments"));
const ReportUpload = lazy(() => import("./pages/ReportUpload"));
const ReportArchive = lazy(() => import("./pages/ReportArchive"));
const ReportDetail = lazy(() => import("./pages/ReportDetail"));
const Notifications = lazy(() => import("./pages/Notifications"));
const Profile = lazy(() => import("./pages/Profile"));
const AdminPanel = lazy(() => import("./pages/admin/AdminPanel"));
const Members = lazy(() => import("./pages/admin/Members"));
const TaskCreate = lazy(() => import("./pages/admin/TaskCreate"));
const ReportReview = lazy(() => import("./pages/admin/ReportReview"));
const Logs = lazy(() => import("./pages/admin/Logs"));

function FullScreen({ children }: { children: ReactNode }) {
  return <div className="flex min-h-dvh items-center justify-center p-6">{children}</div>;
}

function SetupRequired() {
  return (
    <FullScreen>
      <div className="card max-w-lg p-6">
        <div className="mb-4 flex size-12 items-center justify-center rounded-lg bg-warning/10 text-warning"><ServerCog className="size-6" /></div>
        <h1 className="text-lg font-semibold">Supabase bağlantısı yapılandırılmamış</h1>
        <p className="mt-2 text-sm text-muted">
          AKANA Mission Control'ün çalışması için proje kökünde bir <code className="font-mono text-accent-2">.env</code> dosyası
          oluşturup aşağıdaki değişkenleri tanımlayın ve geliştirme sunucusunu yeniden başlatın:
        </p>
        <pre className="mt-3 overflow-x-auto rounded-lg border border-line bg-bg p-3 font-mono text-xs text-ink">
{`VITE_SUPABASE_URL=https://<proje>.supabase.co
VITE_SUPABASE_ANON_KEY=<anon anahtar>`}
        </pre>
        <p className="mt-3 text-xs text-muted">Kurulum adımları için README.md dosyasına bakın. Service Role Key bu dosyaya yazılmaz.</p>
      </div>
    </FullScreen>
  );
}

function AccountBlocked({ title, message, icon }: { title: string; message: string; icon: ReactNode }) {
  const { signOut } = useAuth();
  return (
    <FullScreen>
      <div className="card max-w-md p-6 text-center">
        <div className="mx-auto mb-4 flex size-14 items-center justify-center rounded-full bg-danger/10 text-danger">{icon}</div>
        <h1 className="text-lg font-semibold">{title}</h1>
        <p className="mt-2 text-sm text-muted">{message}</p>
        <button className="btn-secondary mt-5" onClick={() => void signOut()}><LogOut className="size-4" /> Çıkış yap</button>
      </div>
    </FullScreen>
  );
}

/** Oturum zorunlu alan. Yetkilendirme asıl olarak RLS ile sunucuda yapılır; bu katman yalnızca arayüz yönlendirmesidir. */
function RequireAuth() {
  const { session, profile, loading, profileError } = useAuth();
  const location = useLocation();
  if (loading) return <FullScreen><LoadingState label="Oturum doğrulanıyor…" /></FullScreen>;
  if (!session) return <Navigate to="/giris" replace state={{ from: location.pathname }} />;
  if (!profile) {
    return <AccountBlocked icon={<AlertTriangle className="size-7" />} title="Profil yüklenemedi"
      message={profileError ?? "Profil bilgilerinize ulaşılamadı. Lütfen daha sonra tekrar deneyin."} />;
  }
  if (!profile.is_active) {
    return <AccountBlocked icon={<UserX className="size-7" />} title="Hesabınız aktif değil"
      message="Hesabınız pasif durumda veya henüz bir yönetici tarafından etkinleştirilmemiş. Takım yöneticinizle iletişime geçin." />;
  }
  return (
    <NotificationProvider>
      <AppLayout />
    </NotificationProvider>
  );
}

function RequireAdmin() {
  const { isAdmin } = useAuth();
  return isAdmin ? <Outlet /> : <Unauthorized />;
}

function NotFound() {
  return (
    <div className="flex min-h-[60vh] flex-col items-center justify-center gap-3 text-center">
      <p className="font-mono text-5xl font-bold text-accent-2">404</p>
      <p className="text-sm text-muted">Aradığınız sayfa bulunamadı.</p>
      <Link to="/" className="btn-primary">Genel Bakış'a dön</Link>
    </div>
  );
}

class ErrorBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() { return { failed: true }; }
  componentDidCatch(error: unknown) { console.error(error); }
  render() {
    if (!this.state.failed) return this.props.children;
    return (
      <FullScreen>
        <div className="card max-w-md p-6 text-center">
          <AlertTriangle className="mx-auto mb-3 size-10 text-danger" />
          <h1 className="text-lg font-semibold">Beklenmeyen bir hata oluştu</h1>
          <p className="mt-2 text-sm text-muted">Sayfa görüntülenirken bir sorun çıktı. Sayfayı yenileyerek tekrar deneyin.</p>
          <button className="btn-primary mt-5" onClick={() => window.location.reload()}>Sayfayı yenile</button>
        </div>
      </FullScreen>
    );
  }
}

export default function App() {
  if (!isSupabaseConfigured) return <SetupRequired />;
  return (
    <ErrorBoundary>
      <ToastProvider>
        <AuthProvider>
          <Suspense fallback={<FullScreen><LoadingState /></FullScreen>}>
            <Routes>
              <Route path="/giris" element={<Login />} />
              <Route element={<RequireAuth />}>
                <Route index element={<Dashboard />} />
                <Route path="gorevler" element={<MyTasks />} />
                <Route path="gorevler/:id" element={<TaskDetail />} />
                <Route path="departmanlar" element={<Departments />} />
                <Route path="rapor-yukle" element={<ReportUpload />} />
                <Route path="arsiv" element={<ReportArchive />} />
                <Route path="raporlar/:id" element={<ReportDetail />} />
                <Route path="bildirimler" element={<Notifications />} />
                <Route path="profil" element={<Profile />} />
                <Route path="yonetim" element={<RequireAdmin />}>
                  <Route index element={<AdminPanel />} />
                  <Route path="uyeler" element={<Members />} />
                  <Route path="gorev-olustur" element={<TaskCreate />} />
                  <Route path="rapor-inceleme" element={<ReportReview />} />
                  <Route path="rapor-inceleme/:id" element={<ReportDetail />} />
                  <Route path="kayitlar" element={<Logs />} />
                </Route>
                <Route path="*" element={<NotFound />} />
              </Route>
            </Routes>
          </Suspense>
        </AuthProvider>
      </ToastProvider>
    </ErrorBoundary>
  );
}
