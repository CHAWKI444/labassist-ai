import { useCallback, useEffect, useState } from "react";
import { healthApi } from "../services/endpoints";
import type { Health } from "../types";

export function useHealth(intervalMs = 30000) {
  const [health, setHealth] = useState<Health | null>(null);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      setHealth(await healthApi.get());
      setError(null);
    } catch (err) {
      setHealth(null);
      setError((err as Error).message);
    }
  }, []);

  useEffect(() => {
    refresh();
    const timer = window.setInterval(refresh, intervalMs);
    return () => window.clearInterval(timer);
  }, [refresh, intervalMs]);

  return { health, error, refresh };
}
