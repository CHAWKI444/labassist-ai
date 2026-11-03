import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { notificationsApi } from "../services/endpoints";

interface NotificationsContextValue {
  unread: number;
  refresh: () => Promise<void>;
  setUnread: (n: number) => void;
}

const NotificationsContext = createContext<NotificationsContextValue | null>(null);

/** Polls the unread count so the bell badge and the notifications page stay in sync. */
export function NotificationsProvider({ children, intervalMs = 30000 }: { children: ReactNode; intervalMs?: number }) {
  const [unread, setUnread] = useState(0);

  const refresh = useCallback(async () => {
    try {
      setUnread((await notificationsApi.unreadCount()).unread);
    } catch {
      /* transient: keep the previous count */
    }
  }, []);

  useEffect(() => {
    refresh();
    const timer = window.setInterval(refresh, intervalMs);
    const onFocus = () => refresh();
    window.addEventListener("focus", onFocus);
    return () => {
      window.clearInterval(timer);
      window.removeEventListener("focus", onFocus);
    };
  }, [refresh, intervalMs]);

  const value = useMemo(() => ({ unread, refresh, setUnread }), [unread, refresh]);
  return <NotificationsContext.Provider value={value}>{children}</NotificationsContext.Provider>;
}

export function useNotifications() {
  const context = useContext(NotificationsContext);
  if (!context) throw new Error("useNotifications must be used inside NotificationsProvider");
  return context;
}
