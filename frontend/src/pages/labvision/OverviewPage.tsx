import { ArrowRight, Copy, Gauge, ListChecks, Rows3, ShieldAlert, TriangleAlert } from "lucide-react";
import { Link } from "react-router-dom";
import { KpiCard } from "../../components/dashboard/KpiCard";
import { Panel } from "../../components/dashboard/DashboardCard";
import { AnalysisGate } from "../../components/labvision/LabVisionLayout";
import { CATEGORY_META, REVIEW_META, REVIEW_STATUSES, SEVERITY_META, formatPct } from "../../components/labvision/labels";
import { formatBytes, formatDate } from "../../components/ui";
import type { Analysis } from "../../types/labvision";

const noState = { loading: false, error: null };

function Overview({ analysis }: { analysis: Analysis }) {
  const { metrics, quality_score: score, recommendations } = analysis.results;
  const reviewed = analysis.finding_count - (analysis.review_counts.pending ?? 0);
  const components = score.components;
  return (
    <div className="space-y-4">
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-5">
        <KpiCard
          {...noState}
          label="Rows analysed"
          icon={Rows3}
          value={metrics.rows.toLocaleString()}
          hint={`${metrics.columns_analyzed} of ${metrics.columns_total} columns · ${metrics.cells_analyzed.toLocaleString()} cells`}
          info="Number of data rows in the file (the header row is not counted). Every row is analysed; nothing is sampled for the metrics."
        />
        <KpiCard
          {...noState}
          label="Missing values"
          icon={TriangleAlert}
          accent="secondary"
          value={metrics.missing_cells.toLocaleString()}
          hint={`${formatPct(metrics.missing_pct)} of analysed cells · ${metrics.rows_with_missing.toLocaleString()} rows affected`}
          info="Empty cells or placeholders (NA, N/A, null, none, NaN, #N/A) in the analysed columns. Placeholders such as “ND” (not detected) are results and are not counted as missing."
        />
        <KpiCard
          {...noState}
          label="Duplicate rows"
          icon={Copy}
          value={metrics.duplicate_rows_total.toLocaleString()}
          hint={`${metrics.duplicate_rows.toLocaleString()} exact · ${metrics.duplicate_key_rows.toLocaleString()} repeated key${metrics.key_columns.length ? ` (${metrics.key_columns.join(", ")})` : ""}`}
          info="Rows that repeat an earlier row: identical in every column (exact) or sharing the value of the selected key columns. The first occurrence is not counted."
        />
        <KpiCard
          {...noState}
          label="Statistical anomalies"
          icon={ShieldAlert}
          accent="secondary"
          value={metrics.anomalies_flagged.toLocaleString()}
          hint={`${metrics.anomalous_rows.toLocaleString()} rows · flagged for review, not errors`}
          info="Distinct observations (row × column) flagged by at least one enabled method: IQR fences, Z-score, Isolation Forest or time-series deviation. An unusual value can be valid."
        />
        <KpiCard
          {...noState}
          label="Data quality score"
          icon={Gauge}
          value={score.value == null ? "—" : `${score.value}`}
          hint={
            score.value == null
              ? "Not computed"
              : `Completeness ${formatPct(components.completeness)} · validity ${formatPct(components.validity)} · uniqueness ${formatPct(components.uniqueness)}`
          }
          info={
            <>
              <span className="block font-semibold text-slate-800">{score.formula}</span>
              {Object.entries(score.definitions).map(([k, v]) => (
                <span key={k} className="mt-1 block"><b className="capitalize">{k}</b>: {v}</span>
              ))}
              <span className="mt-1 block">{score.excluded}</span>
            </>
          }
        />
      </div>

      <div className="grid gap-4 xl:grid-cols-3">
        <Panel className="p-5 xl:col-span-2">
          <h2 className="text-sm font-semibold text-slate-900">Dataset</h2>
          <dl className="mt-3 grid gap-x-6 gap-y-2 text-sm sm:grid-cols-2">
            {[
              ["File", analysis.dataset_name],
              ["Format", `${analysis.file_type.toUpperCase()}${analysis.sheet_name ? ` · sheet “${analysis.sheet_name}”` : ""}`],
              ["Size", formatBytes(analysis.size_bytes)],
              ["Analysed", formatDate(analysis.created_at)],
              ["Data quality findings", metrics.data_quality_findings.toLocaleString()],
              ["Statistical findings", metrics.statistical_findings.toLocaleString()],
              ["Results kept until", formatDate(analysis.expires_at)],
              ["Invalid values", `${metrics.invalid_cells.toLocaleString()} (${formatPct(metrics.invalid_pct)} of present cells)`],
            ].map(([k, v]) => (
              <div key={k} className="flex justify-between gap-4 border-b border-slate-100 py-1.5">
                <dt className="text-slate-500">{k}</dt>
                <dd className="truncate text-right font-medium text-slate-800" title={v}>{v}</dd>
              </div>
            ))}
          </dl>
          <p className="mt-4 rounded-lg bg-surface px-3 py-2 text-xs text-slate-600">
            <ShieldAlert className="me-1 inline h-3.5 w-3.5 text-secondary" aria-hidden />
            {analysis.results.safety_notice}
          </p>
        </Panel>

        <Panel className="p-5">
          <h2 className="flex items-center justify-between text-sm font-semibold text-slate-900">
            Human review
            <span className="text-xs font-medium text-slate-500">
              {reviewed.toLocaleString()} / {analysis.finding_count.toLocaleString()} reviewed
            </span>
          </h2>
          <div className="mt-3 h-2 overflow-hidden rounded-full bg-slate-100" role="progressbar" aria-label="Review progress"
            aria-valuemin={0} aria-valuemax={analysis.finding_count} aria-valuenow={reviewed}>
            <div className="h-2 rounded-full bg-secondary" style={{ width: `${analysis.finding_count ? (100 * reviewed) / analysis.finding_count : 0}%` }} />
          </div>
          <ul className="mt-3 space-y-1.5 text-sm">
            {REVIEW_STATUSES.map((s) => (
              <li key={s} className="flex items-center justify-between">
                <span className={`rounded-full px-2 py-0.5 text-[11px] font-semibold ring-1 ${REVIEW_META[s].className}`}>{REVIEW_META[s].label}</span>
                <span className="font-semibold text-slate-800">{(analysis.review_counts[s] ?? 0).toLocaleString()}</span>
              </li>
            ))}
          </ul>
          <Link to="/labvision/anomalies" className="mt-4 inline-flex items-center gap-1 text-sm font-semibold text-primary hover:underline">
            Open the anomaly explorer <ArrowRight className="h-4 w-4" aria-hidden />
          </Link>
        </Panel>
      </div>

      <Panel className="p-5">
        <h2 className="flex items-center gap-2 text-sm font-semibold text-slate-900">
          <ListChecks className="h-4 w-4 text-primary" aria-hidden /> Recommendations
        </h2>
        {recommendations.length === 0 ? (
          <p className="mt-2 text-sm text-slate-500">No rule was triggered by this analysis.</p>
        ) : (
          <ul className="mt-3 grid gap-3 md:grid-cols-2">
            {recommendations.slice(0, 6).map((r) => (
              <li key={r.id} className="rounded-xl border border-slate-200 p-3">
                <p className="flex flex-wrap items-center gap-2 text-sm font-semibold text-slate-800">
                  {r.title}
                  <span className={`rounded-full px-2 py-0.5 text-[10px] font-semibold ring-1 ${SEVERITY_META[r.severity].className}`}>
                    {SEVERITY_META[r.severity].label}
                  </span>
                </p>
                <p className="mt-1 text-xs text-slate-500"><b>Why:</b> {r.reason}</p>
                <p className="mt-1 text-xs text-slate-600"><b>Action:</b> {r.action}</p>
              </li>
            ))}
          </ul>
        )}
        {recommendations.length > 6 && (
          <Link to="/labvision/reports" className="mt-3 inline-flex text-sm font-semibold text-primary hover:underline">
            See all {recommendations.length} recommendations
          </Link>
        )}
        <p className="mt-3 flex flex-wrap gap-2 text-[11px] text-slate-500">
          {(["data_quality", "statistical_outlier"] as const).map((c) => (
            <span key={c} className={`rounded-full px-2 py-0.5 font-semibold ring-1 ${CATEGORY_META[c].className}`}>{CATEGORY_META[c].label}</span>
          ))}
          Data-quality findings are rule violations; statistical outliers are unusual values that may be valid.
        </p>
      </Panel>
    </div>
  );
}

export function LabVisionOverviewPage() {
  return <AnalysisGate>{(analysis) => <Overview analysis={analysis} />}</AnalysisGate>;
}
