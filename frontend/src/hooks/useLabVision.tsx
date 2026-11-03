import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { labvisionApi } from "../services/endpoints";
import type { Analysis, AnalysisSummary, LabVisionConfig } from "../types/labvision";

const SELECTED_KEY = "labvision.analysis";

interface LabVisionContextValue {
  config: LabVisionConfig | null;
  history: AnalysisSummary[] | null;
  historyError: string | null;
  refreshHistory: () => Promise<void>;
  analysisId: number | null;
  analysis: Analysis | null;
  loading: boolean;
  error: string | null;
  select: (id: number | null) => void;
  retry: () => void;
  /** Stores a freshly created or updated analysis without refetching it. */
  setAnalysis: (analysis: Analysis) => void;
  removeFromHistory: (id: number) => void;
}

const LabVisionContext = createContext<LabVisionContextValue | null>(null);

function storedId(): number | null {
  const value = Number(sessionStorage.getItem(SELECTED_KEY));
  return Number.isInteger(value) && value > 0 ? value : null;
}

export function LabVisionProvider({ children, initialId }: { children: ReactNode; initialId?: number | null }) {
  const [config, setConfig] = useState<LabVisionConfig | null>(null);
  const [history, setHistory] = useState<AnalysisSummary[] | null>(null);
  const [historyError, setHistoryError] = useState<string | null>(null);
  const [analysisId, setAnalysisId] = useState<number | null>(initialId ?? storedId());
  const [analysis, setAnalysisState] = useState<Analysis | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);
  const cache = useRef(new Map<number, Analysis>());

  const refreshHistory = useCallback(async () => {
    try {
      setHistory(await labvisionApi.history());
      setHistoryError(null);
    } catch (err) {
      setHistoryError((err as Error).message);
    }
  }, []);

  useEffect(() => {
    refreshHistory();
    labvisionApi.config().then(setConfig, () => setConfig(null));
  }, [refreshHistory]);

  // Without an explicit choice, the most recent analysis is shown; a stale stored id falls back to it.
  useEffect(() => {
    if (!history) return;
    if (analysisId === null || !history.some((h) => h.id === analysisId)) {
      const next = history[0]?.id ?? null;
      if (next !== analysisId) setAnalysisId(next);
    }
  }, [history, analysisId]);

  useEffect(() => {
    if (analysisId === null) {
      sessionStorage.removeItem(SELECTED_KEY);
      setAnalysisState(null);
      return;
    }
    sessionStorage.setItem(SELECTED_KEY, String(analysisId));
    const cached = cache.current.get(analysisId);
    if (cached) {
      setAnalysisState(cached);
      setError(null);
      return;
    }
    let current = true;
    setLoading(true);
    setError(null);
    labvisionApi.get(analysisId).then(
      (data) => {
        if (!current) return;
        cache.current.set(data.id, data);
        setAnalysisState(data);
        setLoading(false);
      },
      (err: Error) => {
        if (!current) return;
        setAnalysisState(null);
        setError(err.message);
        setLoading(false);
      },
    );
    return () => {
      current = false;
    };
  }, [analysisId, attempt]);

  const setAnalysis = useCallback((data: Analysis) => {
    cache.current.set(data.id, data);
    setAnalysisState(data);
    setAnalysisId(data.id);
    setHistory((prev) => {
      const summary: AnalysisSummary = data;
      const rest = (prev ?? []).filter((h) => h.id !== data.id);
      return [summary, ...rest].sort((a, b) => b.created_at.localeCompare(a.created_at));
    });
  }, []);

  const removeFromHistory = useCallback((id: number) => {
    cache.current.delete(id);
    setHistory((prev) => (prev ?? []).filter((h) => h.id !== id));
  }, []);

  const value = useMemo<LabVisionContextValue>(
    () => ({
      config,
      history,
      historyError,
      refreshHistory,
      analysisId,
      analysis: analysis && analysis.id === analysisId ? analysis : null,
      loading,
      error,
      select: setAnalysisId,
      retry: () => setAttempt((n) => n + 1),
      setAnalysis,
      removeFromHistory,
    }),
    [config, history, historyError, refreshHistory, analysisId, analysis, loading, error, setAnalysis, removeFromHistory],
  );
  return <LabVisionContext.Provider value={value}>{children}</LabVisionContext.Provider>;
}

export function useLabVision(): LabVisionContextValue {
  const context = useContext(LabVisionContext);
  if (!context) throw new Error("useLabVision must be used inside LabVisionProvider");
  return context;
}
