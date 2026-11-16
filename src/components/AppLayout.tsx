import { useEffect, useState } from "react";
import { Link, NavLink, Outlet, useLocation } from "react-router-dom";
import {
  Archive, Bell, Building2, ClipboardCheck, ClipboardList, FilePlus2, LayoutDashboard,
  LogOut, Menu, ScrollText, Settings2, ShieldCheck, Upload, UserCog, Users, X, type LucideIcon,
} from "lucide-react";
import { useAuth } from "../context/AuthContext";
import { useNotifications } from "../context/NotificationContext";
import { ROLE_LABEL } from "../lib/constants";
import { fullName, initials } from "../lib/format";

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
      <span className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-ink">
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
                  : "text-[#b4b1d6] hover:bg-white/6 hover:text-white"
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
  const location = useLocation();

  useEffect(() => { setOpen(false); }, [location.pathname]);

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
            <p className="mt-6 mb-2 flex items-center gap-2 px-3 text-xs font-medium text-[#8a86b8]">
              <ShieldCheck className="size-3.5" /> Yönetim
            </p>
            <NavList items={ADMIN_NAV} unread={0} onNavigate={() => setOpen(false)} />
          </>
        )}
      </nav>
      <div className="shrink-0 border-t border-white/6 p-3">
        <div className="flex items-center gap-3 rounded-lg px-2 py-2">
          <div className="flex size-9 shrink-0 items-center justify-center rounded-full bg-accent/30 text-xs font-semibold text-white">
            {initials(profile)}
          </div>
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-medium">{fullName(profile)}</p>
            <p className="truncate text-[11px] text-muted">{profile ? ROLE_LABEL[profile.role] : ""}</p>
          </div>
          <button onClick={() => void signOut()} className="rounded-md p-2 text-muted hover:bg-danger/10 hover:text-danger" aria-label="Çıkış yap" title="Çıkış yap">
            <LogOut className="size-[18px]" />
          </button>
        </div>
      </div>
    </div>
  );

  return (
    <div className="min-h-dvh">
      {/* Masaüstü: sabit sol menü */}
      <aside className="fixed inset-y-0 left-0 z-30 hidden w-64 bg-rail bg-[linear-gradient(180deg,rgb(128_101_216/0.16),transparent_38%)] lg:block">{sidebar}</aside>

      {/* Mobil: açılır/kapanır menü */}
      {open && <div className="fixed inset-0 z-40 animate-backdrop bg-[#05050b]/80 lg:hidden" onClick={() => setOpen(false)} />}
      <aside
        className={`fixed inset-y-0 left-0 z-50 w-72 max-w-[85vw] bg-rail bg-[linear-gradient(180deg,rgb(128_101_216/0.16),transparent_38%)] shadow-2xl transition-transform duration-300 ease-[cubic-bezier(0.32,0.72,0,1)] lg:hidden ${open ? "translate-x-0" : "-translate-x-full"}`}
        aria-hidden={!open}
        inert={!open}
      >
        {sidebar}
      </aside>

      <div className="lg:pl-64">
        <header className="sticky top-0 z-20 flex h-14 items-center justify-between bg-bg/95 px-4 lg:hidden">
          <button className="-ml-2 rounded-md p-2 text-ink hover:bg-white/5" onClick={() => setOpen(true)} aria-label="Menüyü aç">
            <Menu className="size-6" />
          </button>
          <span className="flex items-center gap-2"><span className="flex size-7 items-center justify-center rounded-lg bg-ink"><img src={`${import.meta.env.BASE_URL}logo.png`} alt="" className="size-5" /></span><span className="display text-xs font-bold tracking-[0.18em]">AKANA</span><span className="text-xs font-medium text-accent-2/90">Görev Paneli</span></span>
          <Link to="/bildirimler" className="relative -mr-2 rounded-md p-2 text-ink hover:bg-white/5" aria-label="Bildirimler">
            <Bell className="size-5" />
            {unreadCount > 0 && <span className="absolute top-1.5 right-1.5 size-2 rounded-full bg-accent ring-2 ring-bg" />}
          </Link>
        </header>
        <main className="mx-auto w-full max-w-7xl px-4 py-6 sm:px-6 lg:px-8 lg:py-8">
          <div key={location.pathname} className="animate-fade-in">
            <Outlet />
          </div>
        </main>
      </div>
    </div>
  );
}
