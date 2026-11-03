import { AlertTriangle, Inbox, Loader2, RotateCw, type LucideIcon } from "lucide-react";
import type { HTMLAttributes, ReactNode } from "react";

export function Panel({ className = "", ...props }: HTMLAttributes<HTMLElement>) {
  return <section className={`rounded-2xl bg-white shadow-sm ring-1 ring-slate-200/70 ${className}`} {...props} />;
}

export function ErrorState({ message, onRetry, compact = false }: { message: string; onRetry?: () => void; compact?: boolean }) {
  return (
    <div role="alert" className={`flex flex-col items-center justify-center gap-2 text-center ${compact ? "py-2" : "py-10"}`}>
      <span className="flex h-9 w-9 items-center justify-center rounded-full bg-red-50 text-red-600">
        <AlertTriangle className="h-4 w-4" aria-hidden />
      </span>
      <p className="max-w-xs text-sm text-slate-600">{message}</p>
      {onRetry && (
        <button
          onClick={onRetry}
          className="inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1 text-xs font-semibold text-primary hover:bg-primary/10 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary"
        >
          <RotateCw className="h-3.5 w-3.5" aria-hidden /> Retry
        </button>
      )}
    </div>
  );
}

export function EmptyState({ title, message }: { title: string; message?: string }) {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-2 py-10 text-center">
      <span className="flex h-10 w-10 items-center justify-center rounded-full bg-surface text-slate-400">
        <Inbox className="h-5 w-5" aria-hidden />
      </span>
      <p className="text-sm font-semibold text-slate-700">{title}</p>
      {message && <p className="max-w-xs text-xs text-slate-500">{message}</p>}
    </div>
  );
}

export function ChartSkeleton({ height }: { height: number }) {
  return (
    <div role="status" aria-label="Loading" className="animate-pulse" style={{ height }}>
      <div className="flex h-full items-end gap-2 px-2 pb-6">
        {[40, 65, 50, 80, 55, 70, 45, 85, 60].map((h, i) => (
          <div key={i} className="flex-1 rounded-t-md bg-slate-100" style={{ height: `${h}%` }} />
        ))}
      </div>
    </div>
  );
}

interface DashboardCardProps {
  title: string;
  subtitle?: string;
  icon: LucideIcon;
  actions?: ReactNode;
  loading: boolean;
  error: string | null;
  onRetry?: () => void;
  hasData: boolean;
  isEmpty: boolean;
  emptyTitle: string;
  emptyMessage?: string;
  height: number;
  className?: string;
  children: ReactNode;
}

/** Card wrapper that resolves the loading → error → empty → content states consistently for every chart. */
export function DashboardCard({
  title,
  subtitle,
  icon: Icon,
  actions,
  loading,
  error,
  onRetry,
  hasData,
  isEmpty,
  emptyTitle,
  emptyMessage,
  height,
  className = "",
  children,
}: DashboardCardProps) {
  let body: ReactNode;
  if (error) body = <ErrorState message={error} onRetry={onRetry} />;
  else if (!hasData) body = <ChartSkeleton height={height} />;
  else if (isEmpty) body = <EmptyState title={emptyTitle} message={emptyMessage} />;
  else body = children;

  return (
    <Panel className={`flex min-w-0 flex-col ${className}`}>
      <header className="flex flex-wrap items-start justify-between gap-3 border-b border-slate-100 px-5 py-4">
        <div className="flex min-w-0 items-start gap-3">
          <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary">
            <Icon className="h-[18px] w-[18px]" aria-hidden />
          </span>
          <div className="min-w-0">
            <h2 className="flex items-center gap-2 text-sm font-semibold text-slate-900">
              {title}
              {loading && hasData && <Loader2 className="h-3.5 w-3.5 animate-spin text-slate-400" aria-label="Refreshing" />}
            </h2>
            {subtitle && <p className="mt-0.5 text-xs text-slate-500">{subtitle}</p>}
          </div>
        </div>
        {actions}
      </header>
      <div className="flex-1 px-3 py-4 sm:px-5" style={{ minHeight: height }}>
        {body}
      </div>
    </Panel>
  );
}
