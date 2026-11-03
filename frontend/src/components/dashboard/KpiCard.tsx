import { Minus, TrendingDown, TrendingUp, type LucideIcon } from "lucide-react";
import type { ReactNode } from "react";
import { InfoTip } from "../InfoTip";
import { ErrorState, Panel } from "./DashboardCard";
import { formatChange } from "./format";

export interface KpiChange {
  pct: number | null;
  comparison: string | null;
  /** For durations a decrease is the good direction. */
  higherIsBetter?: boolean;
}

interface KpiCardProps {
  label: string;
  icon: LucideIcon;
  value: string;
  hint?: ReactNode;
  change?: KpiChange;
  loading: boolean;
  error: string | null;
  onRetry?: () => void;
  accent?: "primary" | "secondary";
  /** Explanation of how the metric is computed, shown in a tooltip next to the label. */
  info?: ReactNode;
}

function ChangeBadge({ pct, comparison, higherIsBetter = true }: KpiChange) {
  if (pct == null || !Number.isFinite(pct)) return null;
  const Icon = pct > 0 ? TrendingUp : pct < 0 ? TrendingDown : Minus;
  const good = pct === 0 ? null : (pct > 0) === higherIsBetter;
  const tone = good === null ? "bg-slate-100 text-slate-600" : good ? "bg-emerald-50 text-emerald-700" : "bg-red-50 text-red-700";
  return (
    <span className="inline-flex flex-wrap items-center gap-1.5 text-xs text-slate-500">
      <span className={`inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 font-semibold ${tone}`}>
        <Icon className="h-3 w-3" aria-hidden />
        {formatChange(pct)}
      </span>
      {comparison}
    </span>
  );
}

export function KpiCard({ label, icon: Icon, value, hint, change, loading, error, onRetry, accent = "primary", info }: KpiCardProps) {
  const iconTone = accent === "primary" ? "bg-primary/10 text-primary" : "bg-secondary/15 text-[#1F8A78]";
  return (
    <Panel className="flex min-h-[148px] flex-col p-5" aria-busy={loading || undefined}>
      <div className="flex items-start justify-between gap-3">
        <p className="flex items-center gap-1 text-xs font-semibold uppercase tracking-[0.08em] text-slate-500">
          {label}
          {info && <InfoTip label={label}>{info}</InfoTip>}
        </p>
        <span className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-xl ${iconTone}`}>
          <Icon className="h-5 w-5" aria-hidden />
        </span>
      </div>
      {error ? (
        <ErrorState message={error} onRetry={onRetry} compact />
      ) : loading ? (
        <div role="status" aria-label={`Loading ${label}`} className="mt-3 animate-pulse space-y-3">
          <div className="h-8 w-24 rounded-md bg-slate-100" />
          <div className="h-3 w-40 rounded bg-slate-100" />
        </div>
      ) : (
        <div className="mt-2 flex flex-1 flex-col justify-between gap-2">
          <p className="text-3xl font-semibold tracking-tight text-slate-900">{value}</p>
          <div className="space-y-1">
            {change && <ChangeBadge {...change} />}
            {hint && <p className="text-xs text-slate-500">{hint}</p>}
          </div>
        </div>
      )}
    </Panel>
  );
}
