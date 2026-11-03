import { BarChart3, Gauge, Rows3, Table2 } from "lucide-react";
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { DashboardCard, Panel } from "../../components/dashboard/DashboardCard";
import { InfoTip } from "../../components/InfoTip";
import { MissingValuesChart } from "../../components/labvision/charts";
import { AnalysisGate } from "../../components/labvision/LabVisionLayout";
import { COLORS, SEVERITY_META, TYPE_LABELS, formatPct } from "../../components/labvision/labels";
import { Notice } from "../../components/ui";
import type { Analysis } from "../../types/labvision";

const STATISTICAL = new Set(["iqr_outlier", "zscore_outlier", "multivariate_outlier", "time_series_deviation"]);

function ScoreBreakdown({ analysis }: { analysis: Analysis }) {
  const score = analysis.results.quality_score;
  const parts = (["completeness", "validity", "uniqueness"] as const).map((k) => ({
    key: k,
    value: score.components[k],
    weight: score.weights[k],
    definition: score.definitions[k],
  }));
  return (
    <Panel className="p-5">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h2 className="flex items-center gap-2 text-sm font-semibold text-slate-900">
            <Gauge className="h-4 w-4 text-primary" aria-hidden /> Data quality score
          </h2>
          <p className="mt-1 text-xs text-slate-500">{score.formula}</p>
        </div>
        <p className="text-4xl font-semibold text-slate-900">
          {score.value ?? "—"}
          <span className="text-base font-medium text-slate-400"> / 100</span>
        </p>
      </div>
      <div className="mt-4 grid gap-4 md:grid-cols-3">
        {parts.map((p) => (
          <div key={p.key}>
            <p className="flex items-center justify-between text-xs font-semibold uppercase tracking-wide text-slate-500">
              <span className="flex items-center gap-1">{p.key} <InfoTip label={p.key}>{p.definition}</InfoTip></span>
              <span className="text-slate-400">weight {Math.round((p.weight ?? 0) * 100)}%</span>
            </p>
            <p className="mt-1 text-xl font-semibold text-slate-900">{formatPct(p.value)}</p>
            <div className="mt-1.5 h-1.5 rounded-full bg-slate-100">
              <div className="h-1.5 rounded-full bg-primary" style={{ width: `${Math.max(0, Math.min(100, p.value ?? 0))}%` }} />
            </div>
          </div>
        ))}
      </div>
      <p className="mt-4 text-xs text-slate-500">{score.excluded}</p>
    </Panel>
  );
}

function Quality({ analysis }: { analysis: Analysis }) {
  const { charts, metrics, columns, recommendations, notes } = analysis.results;
  const warnings = analysis.results.dataset?.warnings ?? [];
  const missingTotal = charts.missing_by_column.reduce((s, d) => s + d.missing, 0);
  const qualityIssues = charts.issue_counts.filter((i) => !STATISTICAL.has(i.issue_type));
  const qualityRecs = recommendations.filter((r) => !["R-OUTLIERS", "R-METHODS-SKIPPED"].includes(r.id));
  const analysed = columns.filter((c) => c.analysed !== false);

  return (
    <div className="space-y-4">
      {(warnings.length > 0 || notes.length > 0) && (
        <Notice tone="warning">
          <ul className="list-inside list-disc space-y-0.5">{[...warnings, ...notes].map((n) => <li key={n}>{n}</li>)}</ul>
        </Notice>
      )}
      <ScoreBreakdown analysis={analysis} />

      <div className="grid gap-4 xl:grid-cols-2">
        <DashboardCard
          title="Missing values by column"
          subtitle={`${metrics.missing_cells.toLocaleString()} missing cells (${formatPct(metrics.missing_pct)})`}
          icon={BarChart3}
          loading={false}
          error={null}
          hasData
          isEmpty={missingTotal === 0}
          emptyTitle="No missing values"
          emptyMessage="Every analysed cell has a value."
          height={220}
        >
          <MissingValuesChart data={charts.missing_by_column} />
        </DashboardCard>
        <DashboardCard
          title="Missing values per row"
          subtitle={`${metrics.complete_rows.toLocaleString()} complete rows · ${metrics.rows_with_missing.toLocaleString()} with at least one gap`}
          icon={Rows3}
          loading={false}
          error={null}
          hasData
          isEmpty={charts.missing_by_row.length === 0}
          emptyTitle="No rows"
          height={220}
        >
          <ResponsiveContainer width="100%" height={240}>
            <BarChart data={charts.missing_by_row} margin={{ top: 8, right: 8, bottom: 16, left: -8 }}>
              <CartesianGrid stroke={COLORS.grid} strokeDasharray="3 3" vertical={false} />
              <XAxis dataKey="missing_cells" tick={{ fontSize: 11, fill: "#64748B" }} tickLine={false}
                label={{ value: "Missing cells in the row", position: "insideBottom", offset: -8, fontSize: 11, fill: "#475569" }} />
              <YAxis allowDecimals={false} tick={{ fontSize: 11, fill: "#64748B" }} tickLine={false} axisLine={false} width={48} />
              <Tooltip cursor={{ fill: "#F1F5F9" }} formatter={(v) => [Number(v).toLocaleString(), "Rows"]}
                labelFormatter={(l) => `${l} missing cell(s)`} />
              <Bar dataKey="rows" name="Rows" fill={COLORS.secondary} radius={[4, 4, 0, 0]} maxBarSize={48} />
            </BarChart>
          </ResponsiveContainer>
        </DashboardCard>
      </div>

      <Panel className="p-5">
        <h2 className="flex items-center gap-2 text-sm font-semibold text-slate-900">
          <Table2 className="h-4 w-4 text-primary" aria-hidden /> Column profile
        </h2>
        <div className="mt-3 overflow-x-auto rounded-xl ring-1 ring-slate-200">
          <table className="min-w-full text-xs">
            <caption className="sr-only">Profile of the analysed columns</caption>
            <thead className="bg-surface text-left text-slate-600">
              <tr>
                {["Column", "Type", "Present", "Missing", "Unique", "Numeric share", "Status"].map((h) => (
                  <th key={h} scope="col" className="whitespace-nowrap px-3 py-2 font-semibold">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 bg-white">
              {analysed.map((c) => {
                const flags = [
                  metrics.empty_columns.includes(c.name) && "Empty",
                  metrics.constant_columns.includes(c.name) && "Constant",
                  c.inferred_type === "mixed" && "Mixed types",
                  c.decimal_comma && "Decimal comma",
                  c.missing_pct >= 20 && "≥ 20% missing",
                ].filter(Boolean) as string[];
                return (
                  <tr key={c.name}>
                    <th scope="row" className="whitespace-nowrap px-3 py-1.5 text-left font-semibold text-slate-800">{c.name}</th>
                    <td className="px-3 py-1.5">{TYPE_LABELS[c.inferred_type] ?? c.inferred_type}</td>
                    <td className="px-3 py-1.5">{c.non_missing.toLocaleString()}</td>
                    <td className="px-3 py-1.5">{c.missing.toLocaleString()} ({formatPct(c.missing_pct)})</td>
                    <td className="px-3 py-1.5">{c.unique.toLocaleString()}</td>
                    <td className="px-3 py-1.5">{formatPct(c.numeric_ratio * 100)}</td>
                    <td className="px-3 py-1.5">
                      {flags.length ? (
                        <span className="flex flex-wrap gap-1">
                          {flags.map((f) => <span key={f} className="rounded bg-amber-50 px-1.5 py-0.5 text-[10px] font-semibold text-amber-800">{f}</span>)}
                        </span>
                      ) : <span className="text-emerald-700">OK</span>}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </Panel>

      <div className="grid gap-4 xl:grid-cols-2">
        <Panel className="p-5">
          <h2 className="text-sm font-semibold text-slate-900">Data-quality issues</h2>
          {qualityIssues.length === 0 ? (
            <p className="mt-2 text-sm text-slate-500">No data-quality issue was detected.</p>
          ) : (
            <ul className="mt-3 divide-y divide-slate-100 text-sm">
              {qualityIssues.map((i) => (
                <li key={i.issue_type} className="flex items-center justify-between py-1.5">
                  <span className="text-slate-700">{i.label}</span>
                  <span className="font-semibold text-slate-900">{i.count.toLocaleString()}</span>
                </li>
              ))}
            </ul>
          )}
          <dl className="mt-4 grid grid-cols-2 gap-2 text-xs">
            {[
              ["Invalid values", `${metrics.invalid_cells.toLocaleString()} (${formatPct(metrics.invalid_pct)})`],
              ["Exact duplicates", metrics.duplicate_rows.toLocaleString()],
              ["Duplicate keys", metrics.key_columns.length ? metrics.duplicate_key_rows.toLocaleString() : "No key selected"],
              ["Empty / constant columns", `${metrics.empty_columns.length} / ${metrics.constant_columns.length}`],
            ].map(([k, v]) => (
              <div key={k} className="rounded-lg bg-surface px-3 py-2">
                <dt className="text-slate-500">{k}</dt>
                <dd className="font-semibold text-slate-800">{v}</dd>
              </div>
            ))}
          </dl>
        </Panel>
        <Panel className="p-5">
          <h2 className="text-sm font-semibold text-slate-900">Recommended checks</h2>
          {qualityRecs.length === 0 ? (
            <p className="mt-2 text-sm text-slate-500">No data-quality rule was triggered.</p>
          ) : (
            <ul className="mt-3 space-y-3">
              {qualityRecs.map((r) => (
                <li key={r.id} className="rounded-xl border border-slate-200 p-3 text-xs">
                  <p className="flex flex-wrap items-center gap-2 text-sm font-semibold text-slate-800">
                    {r.title}
                    <span className={`rounded-full px-2 py-0.5 text-[10px] ring-1 ${SEVERITY_META[r.severity].className}`}>{SEVERITY_META[r.severity].label}</span>
                  </p>
                  <p className="mt-1 text-slate-500"><b>Triggered by:</b> {r.trigger.label} ({r.trigger.count.toLocaleString()}) — {r.reason}</p>
                  <p className="mt-1 text-slate-600"><b>Action:</b> {r.action}</p>
                </li>
              ))}
            </ul>
          )}
        </Panel>
      </div>
    </div>
  );
}

export function LabVisionQualityPage() {
  return <AnalysisGate>{(analysis) => <Quality analysis={analysis} />}</AnalysisGate>;
}
