import { useEffect, useState } from "react";
import { Link, NavLink, Outlet, useLocation } from "react-router-dom";
import {
  Archive, Bell, Building2, CalendarDays, ChartNoAxesCombined, ClipboardCheck, ClipboardList, FilePlus2, FolderKanban,
  GanttChart, LayoutDashboard, Library, LogOut, Menu, Moon, Network, ScrollText, Search, Settings2, ShieldAlert,
  ShieldCheck, Sun, Upload, UserCog, Users, UsersRound, X, type LucideIcon,
} from "lucide-react";
import { useAuth } from "../context/AuthContext";
import { useNotifications } from "../context/NotificationContext";
import { POSITION_META, ROLE_LABEL } from "../lib/constants";
import { fullName } from "../lib/format";
import { useTheme } from "../lib/theme";
import CommandPalette from "./CommandPalette";
import { Avatar } from "./ui";

interface NavItem { to: string; label: string; icon: LucideIcon; end?: boolean; managerOnly?: boolean; adminOnly?: boolean }

const NAV_GROUPS: { title: string; items: NavItem[] }[] = [
  {
    title: "Operasyon",
    items: [
      { to: "/", label: "Genel Bakış", icon: LayoutDashboard, end: true },
      { to: "/gorevler", label: "Görevlerim", icon: ClipboardList },
      { to: "/projeler", label: "Projeler", icon: FolderKanban },
      { to: "/takvim", label: "Takvim", icon: CalendarDays },
      { to: "/zaman-cizelgesi", label: "Zaman Çizelgesi", icon: GanttChart },
    ],
  },
  {
    title: "Mühendislik",
    items: [
      { to: "/dokumanlar", label: "Doküman Merkezi", icon: Library },
      { to: "/rapor-yukle", label: "Rapor Yükle", icon: Upload },
      { to: "/arsiv", label: "Rapor Arşivi", icon: Archive },
      { to: "/riskler", label: "Risk Yönetimi", icon: ShieldAlert },
    ],
  },
  {
    title: "Organizasyon",
    items: [
      { to: "/departmanlar", label: "Departmanlar", icon: Building2 },
      { to: "/ekip", label: "Ekip", icon: UsersRound },
      { to: "/organizasyon", label: "Organizasyon Şeması", icon: Network },
      { to: "/analitik", label: "Performans ve Analitik", icon: ChartNoAxesCombined, managerOnly: true },
    ],
  },
  {
    title: "Hesap",
    items: [
      { to: "/bildirimler", label: "Bildirimler", icon: Bell },
      { to: "/profil", label: "Profil ve Ayarlar", icon: UserCog },
    ],
  },
];

const ADMIN_NAV: NavItem[] = [
  { to: "/yonetim/rapor-inceleme", label: "Rapor İnceleme", icon: ClipboardCheck, managerOnly: true },
  { to: "/yonetim/gorev-olustur", label: "Görev Oluştur", icon: FilePlus2, managerOnly: true },
  { to: "/yonetim", label: "Yönetim Paneli", icon: Settings2, end: true, adminOnly: true },
  { to: "/yonetim/uyeler", label: "Üye Yönetimi", icon: Users, adminOnly: true },
  { to: "/yonetim/kayitlar", label: "Sistem Kayıtları", icon: ScrollText, adminOnly: true },
];

const TAB_NAV: (NavItem & { primary?: boolean })[] = [
  { to: "/", label: "Genel", icon: LayoutDashboard, end: true },
  { to: "/gorevler", label: "Görevler", icon: ClipboardList },
  { to: "/rapor-yukle", label: "Rapor yükle", icon: Upload, primary: true },
  { to: "/arsiv", label: "Arşiv", icon: Archive },
  { to: "/bildirimler", label: "Bildirim", icon: Bell },
];

function Logo() {
  return (
    <Link to="/" className="flex items-center gap-3">
      {/* Logo açık zeminli bir kutuda durur: logonun koyu tonları koyu menüde kaybolmasın diye */}
      <span className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-logo-tile">
        <img src={`${import.meta.env.BASE_URL}logo.png`} alt="" className="size-7" />
      </span>
      <span className="leading-tight">
        <span className="display block text-[15px] font-bold tracking-[0.18em]">AKANA</span>
        <span className="block text-xs font-medium text-accent-2/90">Mission Control</span>
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
              `group relative flex min-h-10 items-center gap-3 rounded-lg px-3 py-2 text-sm transition-colors duration-150 active:scale-[0.98] ${
                isActive
                  ? "bg-white/[0.07] font-medium text-white before:absolute before:top-2 before:bottom-2 before:left-0 before:w-[3px] before:rounded-full before:bg-accent"
                  : "text-muted hover:bg-white/5 hover:text-white"
              }`
            }
          >
            <Icon className="size-[18px] shrink-0" />
            <span className="flex-1 truncate">{label}</span>
            {to === "/bildirimler" && unread > 0 && (
              <span className="rounded-full bg-accent px-1.5 py-0.5 text-[10px] font-semibold leading-none text-on-accent tabular-nums">
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
  const { profile, isAdmin, isManager, signOut } = useAuth();
  const { unreadCount } = useNotifications();
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState(false);
  const [theme, setTheme] = useTheme();
  const location = useLocation();

  useEffect(() => { setOpen(false); setSearch(false); }, [location.pathname]);

  // Ctrl/⌘ + K: global arama
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setSearch((s) => !s);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const visible = (i: NavItem) => (!i.adminOnly || isAdmin) && (!i.managerOnly || isManager);
  const adminItems = ADMIN_NAV.filter(visible);
  const RAIL = "bg-rail bg-[linear-gradient(180deg,rgb(217_164_65/0.07),transparent_30%)] text-ink";
  const roleText = profile
    ? isAdmin ? ROLE_LABEL.ADMIN : POSITION_META[profile.team_position ?? "MEMBER"].label
    : "";

  const sidebar = (
    <div className="flex h-full flex-col">
      <div className="flex h-16 shrink-0 items-center justify-between px-5">
        <Logo />
        <button className="rounded-md p-2 text-muted hover:bg-white/5 lg:hidden" onClick={() => setOpen(false)} aria-label="Menüyü kapat">
          <X className="size-5" />
        </button>
      </div>
      <div className="px-3 pb-1">
        <button onClick={() => setSearch(true)} className="flex min-h-10 w-full items-center gap-2.5 rounded-lg bg-white/[0.04] px-3 text-sm text-muted transition-colors hover:bg-white/[0.07] hover:text-white" aria-label="Ara (Ctrl+K)">
          <Search className="size-4" />
          <span className="flex-1 text-left">Ara</span>
          <kbd className="rounded border border-white/10 px-1.5 font-mono text-[10px] text-faint">Ctrl K</kbd>
        </button>
      </div>
      <nav className="flex-1 overflow-y-auto px-3 py-3" aria-label="Ana menü">
        {NAV_GROUPS.map((g) => {
          const items = g.items.filter(visible);
          if (items.length === 0) return null;
          return (
            <div key={g.title} className="mb-4">
              <p className="mb-1 px-3 text-[11px] font-medium text-faint">{g.title}</p>
              <NavList items={items} unread={unreadCount} onNavigate={() => setOpen(false)} />
            </div>
          );
        })}
        {adminItems.length > 0 && (
          <div className="mb-2">
            <p className="mb-1 flex items-center gap-1.5 px-3 text-[11px] font-medium text-faint">
              <ShieldCheck className="size-3.5" /> Yönetim
            </p>
            <NavList items={adminItems} unread={0} onNavigate={() => setOpen(false)} />
          </div>
        )}
      </nav>
      <div className="shrink-0 border-t border-white/6 p-3 pb-[max(0.75rem,env(safe-area-inset-bottom))]">
        <div className="flex items-center gap-2 rounded-lg px-2 py-2">
          <Link to="/profil" className="flex min-w-0 flex-1 items-center gap-2 rounded-md hover:opacity-90">
            <Avatar person={profile} size={36} />
            <span className="min-w-0 flex-1">
              <span className="block truncate text-sm font-medium">{fullName(profile)}</span>
              <span className="block truncate text-[11px] text-muted">{roleText}</span>
            </span>
          </Link>
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
      {open && <div className="fixed inset-0 z-40 animate-backdrop bg-[#04070d]/80 lg:hidden" onClick={() => setOpen(false)} />}
      <aside
        data-theme="dark"
        className={`fixed inset-y-0 left-0 z-50 w-72 max-w-[85vw] ${RAIL} shadow-2xl transition-transform duration-300 ease-[cubic-bezier(0.32,0.72,0,1)] lg:hidden ${open ? "translate-x-0" : "-translate-x-full"}`}
        aria-hidden={!open}
        inert={!open}
      >
        {sidebar}
      </aside>

      <div className="lg:pl-64">
        <header className="sticky top-0 z-20 flex h-14 items-center justify-between bg-bg/95 px-4 backdrop-blur lg:hidden">
          <button className="-ml-2 flex size-11 items-center justify-center rounded-lg text-ink hover:bg-ink/5" onClick={() => setOpen(true)} aria-label="Menüyü aç">
            <Menu className="size-6" />
          </button>
          <Link to="/" className="flex items-center gap-2">
            <span className="flex size-7 items-center justify-center rounded-lg bg-logo-tile"><img src={`${import.meta.env.BASE_URL}logo.png`} alt="" className="size-5" /></span>
            <span className="display text-xs font-bold tracking-[0.18em]">AKANA</span>
            <span className="hidden text-xs font-medium text-accent-2 min-[380px]:inline">Mission Control</span>
          </Link>
          <span className="-mr-2 flex">
            <button onClick={() => setSearch(true)} className="flex size-11 items-center justify-center rounded-lg text-ink hover:bg-ink/5" aria-label="Ara">
              <Search className="size-5" />
            </button>
            <button onClick={() => setTheme(theme === "dark" ? "light" : "dark")} className="flex size-11 items-center justify-center rounded-lg text-ink hover:bg-ink/5"
              aria-label={theme === "dark" ? "Açık temaya geç" : "Koyu temaya geç"}>
              {theme === "dark" ? <Sun className="size-5" /> : <Moon className="size-5" />}
            </button>
          </span>
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
                <span className={`relative flex items-center justify-center rounded-full transition-colors duration-150 ${primary ? "size-10 bg-accent text-on-accent shadow-[0_8px_18px_-10px_var(--color-accent)]" : `h-7 w-12 ${isActive ? "bg-accent/18" : ""}`}`}>
                  <Icon className="size-5" />
                  {to === "/bildirimler" && unreadCount > 0 && (
                    <span className="absolute -top-1 right-1 min-w-4 rounded-full bg-danger px-1 text-center text-[10px] font-semibold leading-4 text-white">{unreadCount > 9 ? "9+" : unreadCount}</span>
                  )}
                </span>
                {!primary && <span>{label}</span>}
                {primary && <span className="sr-only">{label}</span>}
              </>
            )}
          </NavLink>
        ))}
      </nav>

      <CommandPalette open={search} onClose={() => setSearch(false)} />
    </div>
  );
}
