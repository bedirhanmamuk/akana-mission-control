import { useEffect, useState } from "react";
import { Link, NavLink, Outlet, useLocation } from "react-router-dom";
import {
  Archive, Bell, Building2, ClipboardCheck, ClipboardList, FilePlus2, LayoutDashboard,
  LogOut, Menu, Moon, ScrollText, Sun, Settings2, ShieldCheck, Upload, UserCog, Users, X, type LucideIcon,
} from "lucide-react";
import { useAuth } from "../context/AuthContext";
import { useNotifications } from "../context/NotificationContext";
import { ROLE_LABEL } from "../lib/constants";
import { fullName, initials } from "../lib/format";
import { useTheme } from "../lib/theme";

interface NavItem { to: string; label: string; icon: LucideIcon; end?: boolean }

const MAIN_NAV: NavItem[] = [
  { to: "/", label: "Genel Bakış", icon: LayoutDashboard, end: true },
  { to: "/gorevler", label: "Görevlerim", icon: ClipboardList },
  { to: "/departmanlar", label: "Departmanlar", icon: Building2 },
  { to: "/rapor-yukle", label: "Rapor Yükle", icon: Upload },
  { to: "/arsiv", label: "Rapor Arşivi", icon: Archive },
  { to: "/bildirimler", label: "Bildirimler", icon: Bell },
  { to: "/profil", label: "Profil ve Ayarlar", icon: UserCog },
];

const TAB_NAV: (NavItem & { primary?: boolean })[] = [
  { to: "/", label: "Genel", icon: LayoutDashboard, end: true },
  { to: "/gorevler", label: "Görevler", icon: ClipboardList },
  { to: "/rapor-yukle", label: "Rapor yükle", icon: Upload, primary: true },
  { to: "/arsiv", label: "Arşiv", icon: Archive },
  { to: "/bildirimler", label: "Bildirim", icon: Bell },
];

const ADMIN_NAV: NavItem[] = [
  { to: "/yonetim", label: "Yönetim Paneli", icon: Settings2, end: true },
  { to: "/yonetim/uyeler", label: "Üye Yönetimi", icon: Users },
  { to: "/yonetim/gorev-olustur", label: "Görev Oluştur", icon: FilePlus2 },
  { to: "/yonetim/rapor-inceleme", label: "Rapor İnceleme", icon: ClipboardCheck },
  { to: "/yonetim/kayitlar", label: "Sistem Kayıtları", icon: ScrollText },
];

function Logo() {
  return (
    <Link to="/" className="flex items-center gap-3">
      {/* Logo açık zeminli bir kutuda durur: koyu mor tonları koyu menüde kaybolmasın diye */}
      <span className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-logo-tile">
        <img src={`${import.meta.env.BASE_URL}logo.png`} alt="" className="size-7" />
      </span>
      <span className="leading-tight">
        <span className="display block text-[15px] font-bold tracking-[0.18em]">AKANA</span>
        <span className="block text-xs font-medium text-accent-2/90">Görev Paneli</span>
      </span>
    </Link>
  );
}

function NavList({ items, unread, onNavigate }: { items: NavItem[]; unread: number; onNavigate: () => void }) {
  return (
    <ul className="space-y-0.5">
      {items.map(({ to, label, icon: Icon, end }) => (
        <li key={to}>
          <NavLink
            to={to}
            end={end}
            onClick={onNavigate}
            className={({ isActive }) =>
              `group flex min-h-10 items-center gap-3 rounded-lg px-3 py-2 text-sm transition-colors duration-150 active:scale-[0.98] ${
                isActive
                  ? "bg-accent/25 font-medium text-white"
                  : "text-muted hover:bg-white/6 hover:text-white"
              }`
            }
          >
            <Icon className="size-[18px] shrink-0" />
            <span className="flex-1 truncate">{label}</span>
            {to === "/bildirimler" && unread > 0 && (
              <span className="rounded-full bg-accent px-1.5 py-0.5 text-[10px] font-semibold leading-none text-white tabular-nums">
                {unread > 99 ? "99+" : unread}
              </span>
            )}
          </NavLink>
        </li>
      ))}
    </ul>
  );
}

export default function AppLayout() {
  const { profile, isAdmin, signOut } = useAuth();
  const { unreadCount } = useNotifications();
  const [open, setOpen] = useState(false);
  const [theme, setTheme] = useTheme();
  const location = useLocation();

  useEffect(() => { setOpen(false); }, [location.pathname]);

  const RAIL = "bg-rail bg-[linear-gradient(180deg,rgb(132_82_240/0.18),transparent_38%)] text-ink";

  const sidebar = (
    <div className="flex h-full flex-col">
      <div className="flex h-16 shrink-0 items-center justify-between px-5">
        <Logo />
        <button className="rounded-md p-2 text-muted hover:bg-white/5 lg:hidden" onClick={() => setOpen(false)} aria-label="Menüyü kapat">
          <X className="size-5" />
        </button>
      </div>
      <nav className="flex-1 overflow-y-auto px-3 py-4" aria-label="Ana menü">
        <NavList items={MAIN_NAV} unread={unreadCount} onNavigate={() => setOpen(false)} />
        {isAdmin && (
          <>
            <p className="mt-6 mb-2 flex items-center gap-2 px-3 text-xs font-medium text-faint">
              <ShieldCheck className="size-3.5" /> Yönetim
            </p>
            <NavList items={ADMIN_NAV} unread={0} onNavigate={() => setOpen(false)} />
          </>
        )}
      </nav>
      <div className="shrink-0 border-t border-white/6 p-3 pb-[max(0.75rem,env(safe-area-inset-bottom))]">
        <div className="flex items-center gap-2 rounded-lg px-2 py-2">
          <div className="flex size-9 shrink-0 items-center justify-center rounded-full bg-accent/30 text-xs font-semibold text-white">
            {initials(profile)}
          </div>
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-medium">{fullName(profile)}</p>
            <p className="truncate text-[11px] text-muted">{profile ? ROLE_LABEL[profile.role] : ""}</p>
          </div>
          <button onClick={() => setTheme(theme === "dark" ? "light" : "dark")} className="rounded-md p-2 text-muted hover:bg-white/6 hover:text-white"
            aria-label={theme === "dark" ? "Açık temaya geç" : "Koyu temaya geç"} title={theme === "dark" ? "Açık tema" : "Koyu tema"}>
            {theme === "dark" ? <Sun className="size-[18px]" /> : <Moon className="size-[18px]" />}
          </button>
          <button onClick={() => void signOut()} className="rounded-md p-2 text-muted hover:bg-danger/15 hover:text-danger" aria-label="Çıkış yap" title="Çıkış yap">
            <LogOut className="size-[18px]" />
          </button>
        </div>
      </div>
    </div>
  );

  return (
    <div className="min-h-dvh">
      {/* Sol menü her iki temada da koyudur (data-theme="dark") */}
      <aside data-theme="dark" className={`fixed inset-y-0 left-0 z-30 hidden w-64 ${RAIL} lg:block`}>{sidebar}</aside>

      {/* Mobil: açılır/kapanır tam menü */}
      {open && <div className="fixed inset-0 z-40 animate-backdrop bg-[#05050b]/80 lg:hidden" onClick={() => setOpen(false)} />}
      <aside
        data-theme="dark"
        className={`fixed inset-y-0 left-0 z-50 w-72 max-w-[85vw] ${RAIL} shadow-2xl transition-transform duration-300 ease-[cubic-bezier(0.32,0.72,0,1)] lg:hidden ${open ? "translate-x-0" : "-translate-x-full"}`}
        aria-hidden={!open}
        inert={!open}
      >
        {sidebar}
      </aside>

      <div className="lg:pl-64">
        <header className="sticky top-0 z-20 flex h-14 items-center justify-between bg-bg/95 px-4 lg:hidden">
          <button className="-ml-2 flex size-11 items-center justify-center rounded-lg text-ink hover:bg-ink/5" onClick={() => setOpen(true)} aria-label="Menüyü aç">
            <Menu className="size-6" />
          </button>
          <Link to="/" className="flex items-center gap-2">
            <span className="flex size-7 items-center justify-center rounded-lg bg-logo-tile"><img src={`${import.meta.env.BASE_URL}logo.png`} alt="" className="size-5" /></span>
            <span className="display text-xs font-bold tracking-[0.18em]">AKANA</span>
            <span className="text-xs font-medium text-accent-2">Görev Paneli</span>
          </Link>
          <button onClick={() => setTheme(theme === "dark" ? "light" : "dark")} className="-mr-2 flex size-11 items-center justify-center rounded-lg text-ink hover:bg-ink/5"
            aria-label={theme === "dark" ? "Açık temaya geç" : "Koyu temaya geç"}>
            {theme === "dark" ? <Sun className="size-5" /> : <Moon className="size-5" />}
          </button>
        </header>
        <main className="mx-auto w-full max-w-7xl px-4 pt-4 pb-28 sm:px-6 lg:px-8 lg:py-8">
          {/* "backwards": animasyon bitince dönüşüm kalmaz; içerideki sabit konumlu öğeler ekrana göre konumlanır */}
          <div key={location.pathname} className="animate-[fade-in_0.22s_var(--ease-out)_backwards]">
            <Outlet />
          </div>
        </main>
      </div>

      {/* Mobil: başparmakla ulaşılan alt gezinme çubuğu */}
      <nav aria-label="Hızlı erişim" className="fixed inset-x-0 bottom-0 z-30 grid grid-cols-5 bg-card pb-[env(safe-area-inset-bottom)] shadow-[0_-10px_30px_-18px_rgb(0_0_0/0.6)] lg:hidden">
        {TAB_NAV.map(({ to, label, icon: Icon, end, primary }) => (
          <NavLink key={to} to={to} end={end}
            className={({ isActive }) => `relative flex min-h-[60px] flex-col items-center justify-center gap-1 text-[11px] font-medium transition-colors duration-150 active:scale-95 ${isActive ? "text-accent-2" : "text-muted"}`}>
            {({ isActive }) => (
              <>
                <span className={`relative flex items-center justify-center rounded-full transition-colors duration-150 ${primary ? "size-10 bg-accent text-white shadow-[0_8px_18px_-8px_var(--color-accent)]" : `h-7 w-12 ${isActive ? "bg-accent/18" : ""}`}`}>
                  <Icon className="size-5" />
                  {to === "/bildirimler" && unreadCount > 0 && (
                    <span className="absolute -top-1 right-1 min-w-4 rounded-full bg-hot px-1 text-center text-[10px] font-semibold leading-4 text-white">{unreadCount > 9 ? "9+" : unreadCount}</span>
                  )}
                </span>
                {!primary && <span>{label}</span>}
                {primary && <span className="sr-only">{label}</span>}
              </>
            )}
          </NavLink>
        ))}
      </nav>
    </div>
  );
}
