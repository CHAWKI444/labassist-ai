import { ScanSearch, type LucideIcon } from "lucide-react";
import { useState, type FormEvent, type ReactNode } from "react";
import { Link, Outlet, useLocation, useNavigate } from "react-router-dom";
import { isAdmin, isStaff, useAuth } from "../hooks/useAuth";
import { useHealth } from "../hooks/useHealth";
import { NotificationsProvider, useNotifications } from "../hooks/useNotifications";
import { healthSummary, HealthIndicator } from "./HealthIndicator";
import { Icon, type IconName } from "./icons";
import { NotificationBell } from "./NotificationBell";
import { Avatar } from "./ui";

interface NavItem {
  to: string;
  label: string;
  icon: IconName | LucideIcon;
  end?: boolean;
  badge?: number;
}

interface NavSection {
  title: string;
  tag?: string;
  items: NavItem[];
}

const PAGE_TITLES: [string, string, string][] = [
  ["/chat", "Assistant", "Chat"],
  ["/dashboard", "Workspace", "Dashboard"],
  ["/history", "Workspace", "Conversation history"],
  ["/notifications", "Workspace", "Notifications"],
  ["/memory", "Workspace", "My memory"],
  ["/settings", "Workspace", "Account settings"],
  ["/staff/documents", "Laboratory", "Documents"],
  ["/staff/knowledge", "Laboratory", "Knowledge base"],
  ["/invitations", "Laboratory", "Invitations"],
  ["/labvision/import", "LabVision AI", "Import dataset"],
  ["/labvision/quality", "LabVision AI", "Data quality"],
  ["/labvision/anomalies", "LabVision AI", "Anomaly explorer"],
  ["/labvision/trends", "LabVision AI", "Trends & visualization"],
  ["/labvision/reports", "LabVision AI", "Reports"],
  ["/labvision/history", "LabVision AI", "Analysis history"],
  ["/labvision", "LabVision AI", "Overview"],
  ["/admin/users", "Administration", "User management"],
  ["/admin", "Administration", "AI performance"],
];

const SUBTITLES: Record<string, string> = {
  admin: "Administration Suite",
  staff: "Laboratory Workspace",
  patient: "Patient Portal",
};

function Sidebar({ onNavigate }: { onNavigate?: () => void }) {
  const { user, logout } = useAuth();
  const { unread } = useNotifications();
  const { health, error } = useHealth(60000);
  const { color, label } = healthSummary(health, error);
  const [menuOpen, setMenuOpen] = useState(false);

  const sections: NavSection[] = [
    {
      title: "Core navigation",
      items: [
        { to: "/chat", label: "Chat assistant", icon: "chat" },
        { to: "/dashboard", label: "Dashboard", icon: "activity" },
        { to: "/history", label: "Conversation history", icon: "history" },
        { to: "/notifications", label: "Notifications", icon: "bell", badge: unread },
        { to: "/memory", label: "My memory", icon: "brain" },
        { to: "/settings", label: "Account settings", icon: "idCard" },
      ],
    },
  ];
  if (isStaff(user)) {
    sections.push({
      title: "Laboratory",
      items: [
        { to: "/staff/documents", label: "Documents", icon: "file" },
        { to: "/staff/knowledge", label: "Knowledge base", icon: "book" },
        { to: "/labvision", label: "LabVision AI", icon: ScanSearch },
        { to: "/invitations", label: "Invitations", icon: "mail" },
      ],
    });
  }
  if (isAdmin(user)) {
    sections.push({
      title: "Operations & governance",
      tag: "Admin",
      items: [
        { to: "/admin/users", label: "User management", icon: "users" },
        { to: "/admin/users?status=archived", label: "Archived users", icon: "archive" },
        { to: "/admin", label: "AI performance", icon: "chart", end: true },
      ],
    });
  }

  const location = useLocation();
  const isActive = (item: NavItem) => {
    const [path, search] = item.to.split("?");
    if (search) return location.pathname === path && location.search.includes(search);
    if (item.to === "/admin/users") return location.pathname === path && !location.search.includes("status=archived");
    return item.end ? location.pathname === path : location.pathname.startsWith(path);
  };

  return (
    <div className="flex h-full flex-col bg-white">
      <div className="px-4 pb-3 pt-4">
        <Link to="/chat" onClick={onNavigate} className="flex items-center gap-2.5">
          <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-brand-600 text-white">
            <Icon name="flask" className="h-5 w-5" />
          </span>
          <span className="leading-tight">
            <span className="block font-display text-base font-bold text-slate-900">LabAssist AI</span>
            <span className="block text-[11px] font-medium text-slate-500">{SUBTITLES[user?.role ?? "patient"]}</span>
          </span>
        </Link>
        <div className="mt-3 flex items-center gap-2 rounded-lg bg-slate-50 px-2.5 py-2 text-xs text-slate-600 ring-1 ring-slate-200">
          <Icon name="shieldCheck" className="h-4 w-4 text-brand-600" />
          <span className="flex-1 truncate font-medium">LabAssist Workspace</span>
          <span className="rounded bg-brand-600 px-1.5 py-0.5 text-[10px] font-bold uppercase text-white">{user?.role}</span>
        </div>
      </div>

      <nav className="min-h-0 flex-1 space-y-5 overflow-y-auto px-3 py-2">
        {sections.map((section) => (
          <div key={section.title}>
            <p className="mb-1.5 flex items-center justify-between px-2 text-[10px] font-bold uppercase tracking-[0.12em] text-slate-400">
              {section.title}
              {section.tag && <span className="rounded bg-mint-200 px-1.5 py-0.5 text-[9px] text-mint-900">{section.tag}</span>}
            </p>
            <ul className="space-y-0.5">
              {section.items.map((item) => {
                const active = isActive(item);
                return (
                  <li key={item.to}>
                    <Link
                      to={item.to}
                      onClick={onNavigate}
                      aria-current={active ? "page" : undefined}
                      className={`flex items-center gap-2.5 rounded-lg px-2.5 py-2 text-sm font-medium transition-colors ${
                        active ? "bg-brand-600 text-white shadow-sm" : "text-slate-600 hover:bg-slate-100 hover:text-slate-900"
                      }`}
                    >
                      {typeof item.icon === "string" ? (
                        <Icon name={item.icon} className="h-4 w-4" />
                      ) : (
                        <item.icon className="h-4 w-4" aria-hidden />
                      )}
                      <span className="flex-1">{item.label}</span>
                      {item.badge ? (
                        <span className={`rounded-full px-1.5 text-[10px] font-bold ${active ? "bg-white/25 text-white" : "bg-red-500 text-white"}`}>
                          {item.badge}
                        </span>
                      ) : null}
                    </Link>
                  </li>
                );
              })}
            </ul>
          </div>
        ))}
      </nav>

      <div className="space-y-2 p-3">
        <div className="rounded-lg bg-brand-50 px-3 py-2.5 text-[11px] ring-1 ring-brand-100">
          <div className="flex items-center justify-between font-semibold text-brand-800">
            <span className="flex items-center gap-1.5">
              <span className={`h-2 w-2 rounded-full ${color}`} /> {label}
            </span>
            {health && <span className="rounded bg-white px-1.5 py-0.5 text-brand-700">{health.vector_index.vectors} passages</span>}
          </div>
          {health && (
            <p className="mt-1 truncate text-brand-700/80">
              LLM {health.ollama.chat_model ?? "?"} · DB {health.database.ok ? "connected" : "error"}
            </p>
          )}
        </div>
        <div className="relative">
          <button
            onClick={() => setMenuOpen((v) => !v)}
            className="flex w-full items-center gap-2.5 rounded-lg px-2 py-2 text-left hover:bg-slate-50"
          >
            <Avatar name={user?.full_name ?? "?"} src={user?.avatar_url} status="active" size="sm" />
            <span className="min-w-0 flex-1 leading-tight">
              <span className="block truncate text-sm font-semibold text-slate-800">{user?.full_name}</span>
              <span className="block truncate text-[11px] text-slate-500">{user?.job_title || user?.email}</span>
            </span>
            <Icon name="chevronDown" className="h-4 w-4 text-slate-400" />
          </button>
          {menuOpen && (
            <div className="absolute bottom-full start-0 mb-1 w-full overflow-hidden rounded-xl border border-slate-200 bg-white py-1 shadow-lg">
              <Link to="/settings" onClick={() => { setMenuOpen(false); onNavigate?.(); }} className="flex items-center gap-2 px-3 py-2 text-sm text-slate-700 hover:bg-slate-50">
                <Icon name="idCard" /> Account settings
              </Link>
              <Link to="/memory" onClick={() => { setMenuOpen(false); onNavigate?.(); }} className="flex items-center gap-2 px-3 py-2 text-sm text-slate-700 hover:bg-slate-50">
                <Icon name="brain" /> My memory & privacy
              </Link>
              <button onClick={logout} className="flex w-full items-center gap-2 px-3 py-2 text-sm text-red-600 hover:bg-red-50">
                <Icon name="logout" /> Sign out
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function TopBar({ onMenu }: { onMenu: () => void }) {
  const { user } = useAuth();
  const location = useLocation();
  const navigate = useNavigate();
  const [search, setSearch] = useState("");
  const match = PAGE_TITLES.find(([path]) => location.pathname.startsWith(path));
  const archived = location.pathname === "/admin/users" && location.search.includes("status=archived");

  const onSearch = (e: FormEvent) => {
    e.preventDefault();
    if (search.trim()) navigate(`/history?q=${encodeURIComponent(search.trim())}`);
    setSearch("");
  };

  return (
    <header className="sticky top-0 z-30 flex h-14 shrink-0 items-center gap-3 border-b border-slate-200 bg-white/95 px-4 backdrop-blur">
      <button className="rounded-lg p-2 text-slate-600 hover:bg-slate-100 lg:hidden" onClick={onMenu} aria-label="Open navigation">
        <Icon name="menu" className="h-5 w-5" />
      </button>
      <nav aria-label="Breadcrumb" className="hidden items-center gap-1.5 text-sm text-slate-500 sm:flex">
        <span>LabAssist</span>
        <Icon name="chevronRight" className="h-3.5 w-3.5" />
        <span>{match?.[1] ?? "Workspace"}</span>
        <Icon name="chevronRight" className="h-3.5 w-3.5" />
        <span className="font-semibold text-brand-700">{archived ? "Archived users" : match?.[2] ?? ""}</span>
      </nav>
      <form onSubmit={onSearch} className="ms-2 hidden max-w-xs flex-1 md:block">
        <div className="relative">
          <Icon name="search" className="pointer-events-none absolute start-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search my conversations…"
            className="w-full rounded-lg border border-slate-200 bg-slate-50 py-1.5 pe-3 ps-9 text-sm placeholder:text-slate-400 focus:border-brand-500 focus:bg-white focus:outline-none"
          />
        </div>
      </form>
      <div className="ms-auto flex items-center gap-2">
        <HealthIndicator />
        <NotificationBell />
        <span className="hidden items-center gap-1.5 rounded-lg bg-brand-50 px-2.5 py-1.5 text-xs font-semibold text-brand-700 ring-1 ring-brand-100 sm:inline-flex">
          <Icon name={user?.role === "admin" ? "shieldCheck" : user?.role === "staff" ? "flask" : "shield"} className="h-3.5 w-3.5" />
          {user?.role === "admin" ? "Admin mode" : user?.role === "staff" ? "Staff" : "Patient"}
        </span>
      </div>
    </header>
  );
}

export function Layout() {
  const [drawer, setDrawer] = useState(false);
  return (
    <NotificationsProvider>
      <div className="flex h-full">
        <aside className="hidden w-64 shrink-0 border-e border-slate-200 lg:block">
          <Sidebar />
        </aside>
        {drawer && (
          <div className="fixed inset-0 z-40 flex lg:hidden" onClick={() => setDrawer(false)}>
            <div className="h-full w-72 shadow-xl" onClick={(e) => e.stopPropagation()}>
              <Sidebar onNavigate={() => setDrawer(false)} />
            </div>
            <div className="flex-1 bg-slate-900/30" />
          </div>
        )}
        <div className="flex min-w-0 flex-1 flex-col">
          <TopBar onMenu={() => setDrawer(true)} />
          <main className="min-h-0 flex-1">
            <Outlet />
          </main>
        </div>
      </div>
    </NotificationsProvider>
  );
}

export function PageContainer({ children, wide = false }: { children: ReactNode; wide?: boolean }) {
  return (
    <div className="h-full overflow-y-auto">
      <div className={`mx-auto px-4 py-6 sm:px-6 lg:px-8 ${wide ? "max-w-[1400px]" : "max-w-6xl"}`}>{children}</div>
    </div>
  );
}
