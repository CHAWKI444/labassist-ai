import { BarChart3, ChartColumn, ChartLine, ChartScatter, Grid3x3 } from "lucide-react";
import { useState, type ReactNode } from "react";
import { DashboardCard } from "../../components/dashboard/DashboardCard";
import {
  AnomalyTypeChart,
  CorrelationHeatmap,
  DistributionChart,
  OutlierScatterChart,
  TrendChart,
} from "../../components/labvision/charts";
import { AnalysisGate } from "../../components/labvision/LabVisionLayout";
import { formatNumber } from "../../components/labvision/labels";
import type { Analysis } from "../../types/labvision";

function ColumnSelect({ label, value, options, onChange }: { label: string; value: string; options: string[]; onChange: (v: string) => void }) {
  return (
    <label className="flex items-center gap-1.5 text-xs font-medium text-slate-500">
      {label}
      <select value={value} onChange={(e) => onChange(e.target.value)}
        className="max-w-[11rem] rounded-lg border border-slate-200 bg-white px-2 py-1 text-xs text-slate-800 focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/20">
        {options.map((o) => <option key={o} value={o}>{o}</option>)}
      </select>
    </label>
  );
}

const card = { loading: false, error: null, hasData: true } as const;

function Charts({ analysis }: { analysis: Analysis }) {
  const { charts } = analysis.results;
  const distributions = charts.distributions.filter((d) => d.bins.length > 0);
  const [distColumn, setDistColumn] = useState(distributions[0]?.column ?? "");
  const distribution = distributions.find((d) => d.column === distColumn) ?? distributions[0];

  const scatter = charts.scatter;
  const [x, setX] = useState(scatter?.columns[0] ?? "");
  const [y, setY] = useState(scatter?.columns[1] ?? "");

  const series = charts.time_series?.series ?? [];
  const [trendColumn, setTrendColumn] = useState(series[0]?.column ?? "");
  const trend = series.find((s) => s.column === trendColumn) ?? series[0];

  const issues = charts.issue_counts.filter((i) => i.count > 0);
  const notShown = (why: string): { isEmpty: true; emptyTitle: string; emptyMessage: string } => ({
    isEmpty: true,
    emptyTitle: "Not shown for this dataset",
    emptyMessage: why,
  });

  const stats = distribution?.stats;
  const statLine: ReactNode = stats && stats.count > 0 && (
    <dl className="mt-3 grid grid-cols-3 gap-2 text-[11px] sm:grid-cols-6">
      {([["n", stats.count], ["Mean", stats.mean], ["SD", stats.std], ["Median", stats.median], ["Min", stats.min], ["Max", stats.max]] as [string, number | null | undefined][]).map(([k, v]) => (
        <div key={k} className="rounded-lg bg-surface px-2 py-1.5">
          <dt className="text-slate-500">{k}</dt>
          <dd className="font-semibold text-slate-800">{k === "n" ? (v ?? 0).toLocaleString() : formatNumber(v, 3)}</dd>
        </div>
      ))}
    </dl>
  );

  return (
    <div className="space-y-4">
      <div className="grid gap-4 xl:grid-cols-2">
        <DashboardCard
          {...card}
          title="Value distribution"
          subtitle={distribution ? `${distribution.flagged.toLocaleString()} flagged observation(s) in “${distribution.column}”` : "Numeric columns only"}
          icon={ChartColumn}
          actions={distributions.length > 1 && <ColumnSelect label="Column" value={distribution?.column ?? ""} options={distributions.map((d) => d.column)} onChange={setDistColumn} />}
          {...(distribution ? { isEmpty: false, emptyTitle: "" } : notShown("A histogram needs at least one numeric, non-constant column."))}
          height={300}
        >
          {distribution && (
            <>
              <DistributionChart distribution={distribution} />
              <p className="mt-2 text-[11px] text-slate-500">
                {distribution.fences && <>IQR fences: {formatNumber(distribution.fences.low, 4)} – {formatNumber(distribution.fences.high, 4)} (k = {distribution.fences.k}). </>}
                {distribution.bins.some((b) => b.tail) && "Values beyond Q1 − 3·IQR or Q3 + 3·IQR are grouped in the outer “<” and “>” bars."}
              </p>
              {statLine}
            </>
          )}
        </DashboardCard>

        <DashboardCard
          {...card}
          title="Outlier exploration"
          subtitle={scatter ? `${scatter.points.length.toLocaleString()} of ${scatter.total_rows.toLocaleString()} rows${scatter.sampled ? " (reproducible sample, flagged rows first)" : ""}` : "Two numeric columns"}
          icon={ChartScatter}
          actions={scatter && (
            <div className="flex flex-wrap gap-2">
              <ColumnSelect label="X" value={x} options={scatter.columns} onChange={setX} />
              <ColumnSelect label="Y" value={y} options={scatter.columns} onChange={setY} />
            </div>
          )}
          {...(scatter ? { isEmpty: false, emptyTitle: "" } : notShown("A scatter plot needs at least two suitable numeric columns."))}
          height={320}
        >
          {scatter && <OutlierScatterChart data={scatter} x={x} y={y} />}
        </DashboardCard>
      </div>

      <div className="grid gap-4 xl:grid-cols-2">
        <DashboardCard
          {...card}
          title="Findings by type"
          subtitle="Data quality (blue) and statistical outliers (turquoise)"
          icon={BarChart3}
          isEmpty={issues.length === 0}
          emptyTitle="No findings"
          emptyMessage="No data-quality issue or statistical anomaly was detected."
          height={280}
        >
          <AnomalyTypeChart data={issues} />
        </DashboardCard>

        <DashboardCard
          {...card}
          title="Correlation matrix"
          subtitle={charts.correlation ? `Pearson correlation between ${charts.correlation.columns.length} numeric columns` : "Numeric columns only"}
          icon={Grid3x3}
          {...(charts.correlation ? { isEmpty: false, emptyTitle: "" } : notShown(
            `Needs at least two numeric columns with ${10} or more paired values.`,
          ))}
          height={280}
        >
          {charts.correlation && <CorrelationHeatmap data={charts.correlation} />}
        </DashboardCard>
      </div>

      <DashboardCard
        {...card}
        title="Trend over time"
        subtitle={charts.time_series && trend ? `${trend.column} by ${charts.time_series.time_column}${trend.aggregated ? " · aggregated into time buckets" : ""}; red points are flagged` : "Requires a valid time column"}
        icon={ChartLine}
        actions={series.length > 1 && <ColumnSelect label="Series" value={trend?.column ?? ""} options={series.map((s) => s.column)} onChange={setTrendColumn} />}
        {...(charts.time_series && trend ? { isEmpty: false, emptyTitle: "" } : notShown(
          "No valid date column was selected as the time column, or it has too few dated numeric values. Choose a time column when importing.",
        ))}
        height={300}
      >
        {charts.time_series && trend && <TrendChart series={trend} timeColumn={charts.time_series.time_column} />}
      </DashboardCard>
    </div>
  );
}

export function LabVisionTrendsPage() {
  return <AnalysisGate>{(analysis) => <Charts key={analysis.id} analysis={analysis} />}</AnalysisGate>;
}
