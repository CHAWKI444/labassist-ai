import { useEffect, useRef, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useNotifications } from "../hooks/useNotifications";
import { notificationsApi } from "../services/endpoints";
import type { AppNotification } from "../types";
import { Icon, type IconName } from "./icons";
import { Spinner, timeAgo } from "./ui";

export const NOTIFICATION_ICONS: Record<string, IconName> = {
  invitation: "mail",
  account: "shieldCheck",
  event: "activity",
  system: "info",
};

export function NotificationBell() {
  const { unread, refresh, setUnread } = useNotifications();
  const [open, setOpen] = useState(false);
  const [items, setItems] = useState<AppNotification[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const ref = useRef<HTMLDivElement>(null);
  const navigate = useNavigate();

  useEffect(() => {
    if (!open) return;
    setError(null);
    notificationsApi
      .list({ limit: 6 })
      .then((page) => {
        setItems(page.items);
        setUnread(page.unread);
      })
      .catch((err) => setError((err as Error).message));
    const close = (e: MouseEvent) => !ref.current?.contains(e.target as Node) && setOpen(false);
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, [open, setUnread]);

  const openItem = async (n: AppNotification) => {
    if (!n.read_at) {
      await notificationsApi.markRead(n.id).catch(() => undefined);
      refresh();
    }
    setOpen(false);
    if (n.link) navigate(n.link);
    else navigate("/notifications");
  };

  const markAll = async () => {
    await notificationsApi.markAllRead();
    setUnread(0);
    setItems((prev) => prev?.map((n) => ({ ...n, read_at: n.read_at ?? new Date().toISOString() })) ?? null);
  };

  return (
    <div className="relative" ref={ref}>
      <button
        onClick={() => setOpen((v) => !v)}
        aria-label={`Notifications${unread ? ` (${unread} unread)` : ""}`}
        aria-expanded={open}
        className="relative rounded-lg p-2 text-slate-600 hover:bg-slate-100"
      >
        <Icon name="bell" className="h-5 w-5" />
        {unread > 0 && (
          <span className="absolute -end-0.5 -top-0.5 flex h-[18px] min-w-[18px] items-center justify-center rounded-full bg-red-500 px-1 text-[10px] font-bold text-white ring-2 ring-white">
            {unread > 99 ? "99+" : unread}
          </span>
        )}
      </button>
      {open && (
        <div className="absolute end-0 z-40 mt-2 w-[22rem] max-w-[calc(100vw-2rem)] overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-xl">
          <div className="flex items-center justify-between border-b border-slate-100 px-4 py-3">
            <p className="text-sm font-semibold text-slate-900">
              Notifications {unread > 0 && <span className="ms-1 rounded-md bg-red-50 px-1.5 py-0.5 text-[11px] text-red-600">{unread} new</span>}
            </p>
            <button onClick={markAll} disabled={unread === 0} className="text-xs font-medium text-brand-600 hover:underline disabled:text-slate-300 disabled:no-underline">
              Mark all as read
            </button>
          </div>
          <div className="max-h-96 overflow-y-auto">
            {error && <p className="p-4 text-xs text-red-600">{error}</p>}
            {!items && !error && (
              <div className="flex justify-center p-6 text-brand-600">
                <Spinner />
              </div>
            )}
            {items?.length === 0 && <p className="p-6 text-center text-sm text-slate-400">You're all caught up.</p>}
            {items?.map((n) => (
              <button
                key={n.id}
                onClick={() => openItem(n)}
                className={`flex w-full gap-3 border-b border-slate-50 px-4 py-3 text-left hover:bg-slate-50 ${n.read_at ? "" : "bg-brand-50/40"}`}
              >
                <span className={`mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg ${n.read_at ? "bg-slate-100 text-slate-500" : "bg-brand-100 text-brand-700"}`}>
                  <Icon name={NOTIFICATION_ICONS[n.type] ?? "bell"} />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="flex items-center gap-2">
                    <span className={`truncate text-sm ${n.read_at ? "text-slate-600" : "font-semibold text-slate-900"}`}>{n.title}</span>
                    {!n.read_at && <span className="h-2 w-2 shrink-0 rounded-full bg-brand-500" />}
                  </span>
                  {n.body && <span className="line-clamp-2 text-xs text-slate-500">{n.body}</span>}
                  <span className="mt-0.5 block text-[11px] text-slate-400">{timeAgo(n.created_at)}</span>
                </span>
              </button>
            ))}
          </div>
          <Link
            to="/notifications"
            onClick={() => setOpen(false)}
            className="block border-t border-slate-100 bg-slate-50 px-4 py-2.5 text-center text-xs font-semibold text-brand-700 hover:bg-slate-100"
          >
            View all notifications
          </Link>
        </div>
      )}
    </div>
  );
}
