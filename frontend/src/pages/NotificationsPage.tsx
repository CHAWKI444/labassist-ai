import { useCallback, useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Icon } from "../components/icons";
import { PageContainer } from "../components/Layout";
import { NOTIFICATION_ICONS } from "../components/NotificationBell";
import { Button, Card, ErrorBanner, PageHeader, Spinner, Tabs, formatDate, timeAgo } from "../components/ui";
import { isAdmin, useAuth } from "../hooks/useAuth";
import { useNotifications } from "../hooks/useNotifications";
import { useToast } from "../hooks/useToast";
import { notificationsApi } from "../services/endpoints";
import type { AppNotification, NotificationType, Role } from "../types";
import { Field, Input, Modal, Textarea } from "../components/ui";

type Filter = "all" | "unread" | "read";
const PAGE = 20;
const TYPES: { value: NotificationType | ""; label: string }[] = [
  { value: "", label: "All types" },
  { value: "invitation", label: "Invitations" },
  { value: "account", label: "Account" },
  { value: "event", label: "Events" },
  { value: "system", label: "System updates" },
];

export function NotificationsPage() {
  const { user } = useAuth();
  const toast = useToast();
  const navigate = useNavigate();
  const { unread, setUnread } = useNotifications();
  const [filter, setFilter] = useState<Filter>("all");
  const [type, setType] = useState<NotificationType | "">("");
  const [items, setItems] = useState<AppNotification[] | null>(null);
  const [total, setTotal] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [loadingMore, setLoadingMore] = useState(false);
  const [broadcasting, setBroadcasting] = useState(false);

  const load = useCallback(async () => {
    setItems(null);
    try {
      const page = await notificationsApi.list({ filter, type: type || undefined, limit: PAGE, offset: 0 });
      setItems(page.items);
      setTotal(page.total);
      setUnread(page.unread);
      setError(null);
    } catch (err) {
      setError((err as Error).message);
    }
  }, [filter, type, setUnread]);

  useEffect(() => {
    load();
  }, [load]);

  const loadMore = async () => {
    if (!items) return;
    setLoadingMore(true);
    try {
      const page = await notificationsApi.list({ filter, type: type || undefined, limit: PAGE, offset: items.length });
      setItems([...items, ...page.items]);
      setTotal(page.total);
    } catch (err) {
      toast((err as Error).message, "error");
    } finally {
      setLoadingMore(false);
    }
  };

  const toggleRead = async (n: AppNotification) => {
    try {
      const updated = n.read_at ? await notificationsApi.markUnread(n.id) : await notificationsApi.markRead(n.id);
      setItems((prev) => prev?.map((x) => (x.id === n.id ? updated : x)) ?? null);
      setUnread(Math.max(0, unread + (n.read_at ? 1 : -1)));
    } catch (err) {
      toast((err as Error).message, "error");
    }
  };

  const markAll = async () => {
    try {
      await notificationsApi.markAllRead();
      setUnread(0);
      toast("All notifications marked as read.");
      load();
    } catch (err) {
      toast((err as Error).message, "error");
    }
  };

  const open = async (n: AppNotification) => {
    if (!n.read_at) await toggleRead(n);
    if (n.link) navigate(n.link);
  };

  return (
    <PageContainer>
      <PageHeader
        title="Notifications"
        subtitle="Invitations, account changes, laboratory events and system updates addressed to you."
        actions={
          <>
            {isAdmin(user) && (
              <Button variant="secondary" icon="send" onClick={() => setBroadcasting(true)}>
                Send system update
              </Button>
            )}
            <Button icon="check" onClick={markAll} disabled={unread === 0}>
              Mark all as read
            </Button>
          </>
        }
      />
      <Card className="overflow-hidden">
        <div className="flex flex-col gap-3 border-b border-slate-100 bg-slate-50/60 p-4 sm:flex-row sm:items-center sm:justify-between">
          <Tabs
            value={filter}
            onChange={setFilter}
            tabs={[
              { value: "all", label: "All" },
              { value: "unread", label: "Unread", count: unread },
              { value: "read", label: "Read" },
            ]}
          />
          <div className="flex flex-wrap gap-1.5">
            {TYPES.map((t) => (
              <button
                key={t.value}
                onClick={() => setType(t.value)}
                className={`rounded-full px-3 py-1 text-xs font-medium ring-1 ${
                  type === t.value ? "bg-brand-600 text-white ring-brand-600" : "bg-white text-slate-600 ring-slate-200 hover:bg-slate-50"
                }`}
              >
                {t.label}
              </button>
            ))}
          </div>
        </div>
        {error && (
          <div className="p-4">
            <ErrorBanner message={error} onRetry={load} />
          </div>
        )}
        {!items && !error && (
          <div className="flex justify-center p-8 text-brand-600">
            <Spinner className="h-6 w-6" />
          </div>
        )}
        {items?.length === 0 && (
          <div className="p-10 text-center">
            <Icon name="bell" className="mx-auto h-8 w-8 text-slate-300" />
            <p className="mt-2 text-sm text-slate-500">No notifications here.</p>
          </div>
        )}
        <ul className="divide-y divide-slate-100">
          {items?.map((n) => (
            <li key={n.id} className={`flex items-start gap-4 px-5 py-4 ${n.read_at ? "" : "bg-brand-50/40"}`}>
              <span className={`mt-0.5 flex h-10 w-10 shrink-0 items-center justify-center rounded-lg ${n.read_at ? "bg-slate-100 text-slate-500" : "bg-brand-100 text-brand-700"}`}>
                <Icon name={NOTIFICATION_ICONS[n.type] ?? "bell"} className="h-5 w-5" />
              </span>
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <p className={`text-sm ${n.read_at ? "text-slate-700" : "font-semibold text-slate-900"}`}>{n.title}</p>
                  <span className="rounded bg-slate-100 px-1.5 py-0.5 text-[10px] font-semibold uppercase text-slate-500">{n.type}</span>
                  {!n.read_at && <span className="h-2 w-2 rounded-full bg-brand-500" />}
                </div>
                {n.body && <p className="mt-0.5 text-sm text-slate-500">{n.body}</p>}
                <p className="mt-1 text-[11px] text-slate-400" title={formatDate(n.created_at)}>
                  {timeAgo(n.created_at)}
                </p>
              </div>
              <div className="flex shrink-0 flex-col items-end gap-1.5 sm:flex-row sm:items-center">
                {n.link && (
                  <Button size="sm" variant="soft" icon="arrowRight" onClick={() => open(n)}>
                    Open
                  </Button>
                )}
                <Button size="sm" variant="ghost" onClick={() => toggleRead(n)}>
                  {n.read_at ? "Mark unread" : "Mark read"}
                </Button>
              </div>
            </li>
          ))}
        </ul>
        {items && items.length < total && (
          <div className="border-t border-slate-100 p-3 text-center">
            <Button variant="secondary" size="sm" onClick={loadMore} disabled={loadingMore}>
              {loadingMore && <Spinner />} Load older notifications ({total - items.length} more)
            </Button>
          </div>
        )}
      </Card>
      {broadcasting && (
        <BroadcastModal
          onClose={() => setBroadcasting(false)}
          onSent={(count) => {
            setBroadcasting(false);
            toast(`System update sent to ${count} active user(s).`);
            load();
          }}
        />
      )}
    </PageContainer>
  );
}

function BroadcastModal({ onClose, onSent }: { onClose: () => void; onSent: (count: number) => void }) {
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [roles, setRoles] = useState<Role[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const send = async () => {
    setBusy(true);
    setError(null);
    try {
      onSent((await notificationsApi.broadcast(title.trim(), body.trim(), roles.length ? roles : undefined)).recipients);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal title="Send a system update" subtitle="Creates a notification for every active user (or selected roles)." onClose={onClose} size="sm">
      <div className="space-y-4">
        {error && <ErrorBanner message={error} />}
        <Field label="Title">
          <Input maxLength={200} value={title} onChange={(e) => setTitle(e.target.value)} placeholder="e.g. Scheduled maintenance tonight at 22:00" />
        </Field>
        <Field label="Message">
          <Textarea rows={3} maxLength={1000} value={body} onChange={(e) => setBody(e.target.value)} />
        </Field>
        <fieldset className="text-sm">
          <legend className="mb-1 font-medium text-slate-700">Recipients</legend>
          <div className="flex flex-wrap gap-3">
            {(["patient", "staff", "admin"] as Role[]).map((r) => (
              <label key={r} className="flex items-center gap-1.5">
                <input
                  type="checkbox"
                  className="accent-brand-600"
                  checked={roles.includes(r)}
                  onChange={() => setRoles((prev) => (prev.includes(r) ? prev.filter((x) => x !== r) : [...prev, r]))}
                />
                {r}
              </label>
            ))}
          </div>
          <p className="mt-1 text-xs text-slate-500">Leave all unchecked to notify every active user.</p>
        </fieldset>
        <div className="flex justify-end gap-2">
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button icon="send" onClick={send} disabled={busy || !title.trim()}>
            Send
          </Button>
        </div>
      </div>
    </Modal>
  );
}
