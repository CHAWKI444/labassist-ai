import {
  ChartLine,
  Clock3,
  FileDown,
  Gauge,
  LayoutDashboard,
  ListChecks,
  ScanSearch,
  ShieldAlert,
  Upload,
  type LucideIcon,
} from "lucide-react";
import { useEffect, useRef, type ReactNode } from "react";
import { Link, NavLink, Outlet, useLocation, useSearchParams } from "react-router-dom";
import { LabVisionProvider, useLabVision } from "../../hooks/useLabVision";
import { PageContainer } from "../Layout";
import { ErrorState, Panel } from "../dashboard/DashboardCard";
import { formatDate } from "../ui";

const TABS: { to: string; label: string; icon: LucideIcon; end?: boolean }[] = [
  { to: "/labvision", label: "Overview", icon: LayoutDashboard, end: true },
  { to: "/labvision/import", label: "Import dataset", icon: Upload },
  { to: "/labvision/quality", label: "Data quality", icon: Gauge },
  { to: "/labvision/anomalies", label: "Anomaly explorer", icon: ListChecks },
  { to: "/labvision/trends", label: "Trends & charts", icon: ChartLine },
  { to: "/labvision/reports", label: "Reports", icon: FileDown },
  { to: "/labvision/history", label: "History", icon: Clock3 },
];

function AnalysisSelector() {
  const { history, analysisId, select } = useLabVision();
  if (!history?.length) return null;
  return (
    <label className="flex min-w-0 items-center gap-2 text-xs font-medium text-slate-500">
      <span className="shrink-0">Analysis</span>
      <select
        value={analysisId ?? ""}
        onChange={(e) => select(Number(e.target.value))}
        className="min-w-0 max-w-[18rem] truncate rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-sm text-slate-800 focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/20"
      >
        {history.map((h) => (
          <option key={h.id} value={h.id}>
            #{h.id} · {h.dataset_name} · {formatDate(h.created_at)}
          </option>
        ))}
      </select>
    </label>
  );
}

export function LabVisionLayout() {
  const [params] = useSearchParams();
  const initial = Number(params.get("analysis"));
  const { pathname } = useLocation();
  const root = useRef<HTMLDivElement>(null);
  // The section tabs share one scroll container, so switching tabs must not keep the previous offset.
  useEffect(() => {
    root.current?.querySelector(".overflow-y-auto")?.scrollTo?.({ top: 0 });
  }, [pathname]);
  return (
    <LabVisionProvider initialId={Number.isInteger(initial) && initial > 0 ? initial : null}>
      <div ref={root} className="h-full bg-surface">
        <PageContainer wide>
          <div className="mb-5 flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2.5">
                <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-primary text-white shadow-sm">
                  <ScanSearch className="h-5 w-5" aria-hidden />
                </span>
                <h1 className="font-display text-[1.75rem] font-bold leading-tight text-slate-900">LabVision AI</h1>
                <span className="inline-flex items-center gap-1 rounded-full bg-secondary/15 px-2.5 py-0.5 text-[11px] font-semibold text-[#1F7A6B] ring-1 ring-secondary/30">
                  <ShieldAlert className="h-3 w-3" aria-hidden /> Alerts for qualified human review
                </span>
              </div>
              <p className="mt-1.5 max-w-3xl text-sm text-slate-500">
                Data quality and statistical anomaly detection for CSV and Excel datasets. Findings are computed
                deterministically; LabVision never alters measurements or makes clinical decisions.
              </p>
            </div>
            <AnalysisSelector />
          </div>
          <nav aria-label="LabVision sections" className="-mx-1 mb-6 overflow-x-auto px-1 pb-1">
            <ul className="inline-flex min-w-full gap-1 rounded-xl bg-white p-1 shadow-sm ring-1 ring-slate-200/70 sm:min-w-0">
              {TABS.map(({ to, label, icon: Icon, end }) => (
                <li key={to}>
                  <NavLink
                    to={to}
                    end={end}
                    className={({ isActive }) =>
                      `inline-flex items-center gap-1.5 whitespace-nowrap rounded-lg px-3 py-1.5 text-sm font-medium transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-primary ${
                        isActive ? "bg-primary text-white shadow-sm" : "text-slate-600 hover:bg-surface"
                      }`
                    }
                  >
                    <Icon className="h-4 w-4" aria-hidden />
                    {label}
                  </NavLink>
                </li>
              ))}
            </ul>
          </nav>
          <Outlet />
        </PageContainer>
      </div>
    </LabVisionProvider>
  );
}

/** Resolves loading / error / "nothing analysed yet" for pages that display one analysis. */
export function AnalysisGate({ children }: { children: (analysis: NonNullable<ReturnType<typeof useLabVision>["analysis"]>) => ReactNode }) {
  const { history, historyError, refreshHistory, analysis, loading, error, retry } = useLabVision();
  if (historyError) return <Panel className="p-6"><ErrorState message={historyError} onRetry={refreshHistory} /></Panel>;
  if (error) return <Panel className="p-6"><ErrorState message={error} onRetry={retry} /></Panel>;
  if (history && history.length === 0) return <NoAnalysis />;
  if (!analysis || loading) {
    return (
      <div role="status" aria-label="Loading analysis" className="grid animate-pulse gap-4 sm:grid-cols-2 xl:grid-cols-5">
        {Array.from({ length: 5 }, (_, i) => (
          <div key={i} className="h-36 rounded-2xl bg-white ring-1 ring-slate-200/70" />
        ))}
      </div>
    );
  }
  return <>{children(analysis)}</>;
}

export function NoAnalysis() {
  return (
    <Panel className="flex flex-col items-center gap-3 px-6 py-14 text-center">
      <span className="flex h-12 w-12 items-center justify-center rounded-2xl bg-primary/10 text-primary">
        <ScanSearch className="h-6 w-6" aria-hidden />
      </span>
      <h2 className="text-lg font-semibold text-slate-900">No dataset analysed yet</h2>
      <p className="max-w-md text-sm text-slate-500">
        Import a CSV or Excel file to profile its columns, check data quality and flag statistical anomalies. Metrics
        appear here once an analysis has run — nothing is estimated in advance.
      </p>
      <Link
        to="/labvision/import"
        className="mt-1 inline-flex items-center gap-1.5 rounded-xl bg-primary px-4 py-2 text-sm font-semibold text-white shadow-sm hover:bg-primary-dark focus:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2"
      >
        <Upload className="h-4 w-4" aria-hidden /> Import a dataset
      </Link>
    </Panel>
  );
}
