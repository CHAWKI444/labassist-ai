import { useCallback, useEffect, useState } from "react";
import { dashboardApi } from "../services/endpoints";
import type {
  ArchitectureDistribution,
  ConversationActivity,
  DashboardScope,
  DashboardSummary,
  RecentActivity,
} from "../types";

export interface Section<T> {
  data: T | null;
  error: string | null;
  loading: boolean;
}

const inFlight = new Map<string, Promise<unknown>>();

/** Identical concurrent requests (e.g. React StrictMode re-running effects) share one network call. */
function shared<T>(key: string, load: () => Promise<T>): Promise<T> {
  const existing = inFlight.get(key);
  if (existing) return existing as Promise<T>;
  const promise = load().finally(() => inFlight.delete(key));
  inFlight.set(key, promise);
  return promise;
}

function useSection<T>(key: string, load: () => Promise<T>, nonce: number): Section<T> & { retry: () => void } {
  const [state, setState] = useState<Section<T>>({ data: null, error: null, loading: true });
  const [retries, setRetries] = useState(0);

  useEffect(() => {
    let current = true;
    setState((s) => ({ ...s, error: null, loading: true }));
    shared(`${key}#${nonce}.${retries}`, load).then(
      (data) => current && setState({ data, error: null, loading: false }),
      (err: unknown) =>
        current && setState({ data: null, error: err instanceof Error ? err.message : "Request failed", loading: false }),
    );
    return () => {
      current = false;
    };
    // `load` is derived from `key`; depending on its identity would refetch on every render.
  }, [key, nonce, retries]);

  const retry = useCallback(() => setRetries((n) => n + 1), []);
  return { ...state, retry };
}

export function useDashboard(scope: DashboardScope, days: number) {
  const [nonce, setNonce] = useState(0);
  const params = { scope, days };
  const windowKey = `${scope}:${days}`;

  const summary = useSection<DashboardSummary>(`summary:${windowKey}`, () => dashboardApi.summary(params), nonce);
  const activity = useSection<ConversationActivity>(`activity:${windowKey}`, () => dashboardApi.activity(params), nonce);
  const architectures = useSection<ArchitectureDistribution>(
    `architectures:${windowKey}`,
    () => dashboardApi.architectures(params),
    nonce,
  );
  // Recent activity does not depend on the selected range, so changing the range does not refetch it.
  const recent = useSection<RecentActivity>(`recent:${scope}`, () => dashboardApi.recent(scope), nonce);

  const refresh = useCallback(() => setNonce((n) => n + 1), []);
  const loading = summary.loading || activity.loading || architectures.loading || recent.loading;
  return { summary, activity, architectures, recent, refresh, loading };
}
