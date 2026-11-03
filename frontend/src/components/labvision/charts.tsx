import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Legend,
  Line,
  LineChart,
  ResponsiveContainer,
  Scatter,
  ScatterChart,
  Tooltip,
  XAxis,
  YAxis,
  ZAxis,
} from "recharts";
import type { CorrelationData, Distribution, IssueCount, ScatterData, TrendSeries } from "../../types/labvision";
import { COLORS, formatNumber, methodLabel } from "./labels";

const AXIS_TICK = { fontSize: 11, fill: "#64748B" };

interface TipEntry {
  name?: string | number;
  value?: unknown;
  color?: string;
  payload?: Record<string, unknown>;
}

function TipBox({ title, rows }: { title: string; rows: [string, string, string?][] }) {
  return (
    <div className="min-w-[160px] rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-xs shadow-lg">
      <p className="mb-1.5 font-semibold text-slate-900">{title}</p>
      {rows.map(([label, value, color]) => (
        <p key={label} className="flex items-center justify-between gap-4 text-slate-600">
          <span className="flex items-center gap-1.5">
            {color && <span className="h-2 w-2 rounded-full" style={{ background: color }} />}
            {label}
          </span>
          <span className="font-semibold text-slate-900">{value}</span>
        </p>
      ))}
    </div>
  );
}

const truncate = (text: string, n = 18) => (text.length > n ? `${text.slice(0, n - 1)}…` : text);

/** A. Missing values per column (horizontal bars so long column names stay readable). */
export function MissingValuesChart({ data }: { data: { column: string; missing: number; missing_pct: number }[] }) {
  const rows = [...data].filter((d) => Number.isFinite(d.missing)).sort((a, b) => b.missing - a.missing).slice(0, 25);
  const height = Math.max(160, rows.length * 28 + 40);
  return (
    <ResponsiveContainer width="100%" height={height}>
      <BarChart data={rows} layout="vertical" margin={{ top: 4, right: 24, bottom: 4, left: 8 }}>
        <CartesianGrid stroke={COLORS.grid} strokeDasharray="3 3" horizontal={false} />
        <XAxis type="number" allowDecimals={false} tick={AXIS_TICK} tickLine={false} axisLine={false} />
        <YAxis type="category" dataKey="column" width={130} tick={AXIS_TICK} tickLine={false} tickFormatter={(v: string) => truncate(v)} />
        <Tooltip
          cursor={{ fill: "#F1F5F9" }}
          content={({ active, payload }) => {
            const d = (payload?.[0] as TipEntry | undefined)?.payload as (typeof rows)[number] | undefined;
            return active && d ? <TipBox title={d.column} rows={[["Missing", d.missing.toLocaleString()], ["Share", `${d.missing_pct}%`]]} /> : null;
          }}
        />
        <Bar dataKey="missing" name="Missing values" fill={COLORS.primary} radius={[0, 4, 4, 0]} maxBarSize={20} />
      </BarChart>
    </ResponsiveContainer>
  );
}

/** B. Histogram of one numeric column; flagged observations are stacked in a contrasting colour. */
export function DistributionChart({ distribution, height = 260 }: { distribution: Distribution; height?: number }) {
  const data = distribution.bins
    .filter((b) => Number.isFinite(b.start) && Number.isFinite(b.end))
    .map((b) => ({
      label: `${formatNumber(b.start)}–${formatNumber(b.end)}`,
      tick: b.tail === "low" ? `< ${formatNumber(b.end)}` : b.tail === "high" ? `> ${formatNumber(b.start)}` : formatNumber((b.start + b.end) / 2),
      typical: Math.max(0, b.count - b.flagged),
      flagged: b.flagged,
      count: b.count,
    }));
  return (
    <ResponsiveContainer width="100%" height={height}>
      <BarChart data={data} margin={{ top: 8, right: 8, bottom: 0, left: -12 }} barCategoryGap={1}>
        <CartesianGrid stroke={COLORS.grid} strokeDasharray="3 3" vertical={false} />
        <XAxis dataKey="tick" tick={AXIS_TICK} tickLine={false} minTickGap={16} />
        <YAxis allowDecimals={false} tick={AXIS_TICK} tickLine={false} axisLine={false} width={44} />
        <Tooltip
          cursor={{ fill: "#F1F5F9" }}
          content={({ active, payload }) => {
            const d = (payload?.[0] as TipEntry | undefined)?.payload as (typeof data)[number] | undefined;
            return active && d ? (
              <TipBox
                title={`${distribution.column}: ${d.label}`}
                rows={[["Observations", d.count.toLocaleString()], ["Flagged", d.flagged.toLocaleString(), COLORS.flagged]]}
              />
            ) : null;
          }}
        />
        <Legend wrapperStyle={{ fontSize: 12 }} />
        <Bar dataKey="typical" name="Observations" stackId="a" fill={COLORS.primary} />
        <Bar dataKey="flagged" name="Flagged as unusual" stackId="a" fill={COLORS.flagged} />
      </BarChart>
    </ResponsiveContainer>
  );
}

/** C. Two numeric columns against each other, flagged rows highlighted. */
export function OutlierScatterChart({ data, x, y, height = 320 }: { data: ScatterData; x: string; y: string; height?: number }) {
  const xi = data.columns.indexOf(x);
  const yi = data.columns.indexOf(y);
  const points = data.points
    .map((p) => ({ row: p.row, x: p.values[xi], y: p.values[yi], methods: p.methods }))
    .filter((p): p is { row: number; x: number; y: number; methods: string[] } => Number.isFinite(p.x) && Number.isFinite(p.y));
  const typical = points.filter((p) => !p.methods.length);
  const flagged = points.filter((p) => p.methods.length);
  return (
    <ResponsiveContainer width="100%" height={height}>
      <ScatterChart margin={{ top: 8, right: 16, bottom: 16, left: 0 }}>
        <CartesianGrid stroke={COLORS.grid} strokeDasharray="3 3" />
        <XAxis type="number" dataKey="x" name={x} tick={AXIS_TICK} tickFormatter={(v: number) => formatNumber(v)}
          label={{ value: x, position: "insideBottom", offset: -8, fontSize: 11, fill: "#475569" }} domain={["auto", "auto"]} />
        <YAxis type="number" dataKey="y" name={y} tick={AXIS_TICK} tickFormatter={(v: number) => formatNumber(v)} width={56}
          label={{ value: y, angle: -90, position: "insideLeft", fontSize: 11, fill: "#475569" }} domain={["auto", "auto"]} />
        <ZAxis range={[28, 28]} />
        <Tooltip
          cursor={{ strokeDasharray: "3 3" }}
          content={({ active, payload }) => {
            const d = (payload?.[0] as TipEntry | undefined)?.payload as (typeof points)[number] | undefined;
            return active && d ? (
              <TipBox
                title={`Row ${d.row}`}
                rows={[
                  [x, formatNumber(d.x, 4)],
                  [y, formatNumber(d.y, 4)],
                  ["Flagged by", d.methods.length ? d.methods.map(methodLabel).join(", ") : "—"],
                ]}
              />
            ) : null;
          }}
        />
        <Legend verticalAlign="top" height={28} wrapperStyle={{ fontSize: 12 }} />
        <Scatter name="Observations" data={typical} fill={COLORS.primary} fillOpacity={0.55} isAnimationActive={false} />
        <Scatter name="Flagged in any column" data={flagged} fill={COLORS.flagged} shape="diamond" isAnimationActive={false} />
      </ScatterChart>
    </ResponsiveContainer>
  );
}

/** D. Number of findings per issue type, coloured by category. */
export function AnomalyTypeChart({ data, height = 280 }: { data: IssueCount[]; height?: number }) {
  const rows = data.filter((d) => d.count > 0);
  return (
    <ResponsiveContainer width="100%" height={Math.max(height, rows.length * 30 + 40)}>
      <BarChart data={rows} layout="vertical" margin={{ top: 4, right: 24, bottom: 4, left: 8 }}>
        <CartesianGrid stroke={COLORS.grid} strokeDasharray="3 3" horizontal={false} />
        <XAxis type="number" allowDecimals={false} tick={AXIS_TICK} tickLine={false} axisLine={false} />
        <YAxis type="category" dataKey="label" width={150} tick={AXIS_TICK} tickLine={false} tickFormatter={(v: string) => truncate(v, 22)} />
        <Tooltip
          cursor={{ fill: "#F1F5F9" }}
          content={({ active, payload }) => {
            const d = (payload?.[0] as TipEntry | undefined)?.payload as IssueCount | undefined;
            return active && d ? (
              <TipBox title={d.label} rows={[["Findings", d.count.toLocaleString()],
                ["Category", d.category === "data_quality" ? "Data quality" : "Statistical outlier"]]} />
            ) : null;
          }}
        />
        <Bar dataKey="count" name="Findings" radius={[0, 4, 4, 0]} maxBarSize={20}>
          {rows.map((d) => (
            <Cell key={d.issue_type} fill={d.category === "data_quality" ? COLORS.primary : COLORS.secondary} />
          ))}
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  );
}

function FlaggedDot(props: { cx?: number; cy?: number; payload?: { flagged?: boolean } }) {
  const { cx, cy, payload } = props;
  if (!payload?.flagged || cx == null || cy == null) return <g />;
  return <circle cx={cx} cy={cy} r={4.5} fill={COLORS.flagged} stroke="#fff" strokeWidth={1.5} />;
}

/** E. Values over time; only rendered when the analysis has a valid time column. */
export function TrendChart({ series, timeColumn, height = 300 }: { series: TrendSeries; timeColumn: string; height?: number }) {
  const data = series.points
    .map((p) => ({ ...p, ts: Date.parse(p.t) }))
    .filter((p) => Number.isFinite(p.ts) && p.v != null && Number.isFinite(p.v));
  const spanDays = data.length > 1 ? (data[data.length - 1].ts - data[0].ts) / 86_400_000 : 0;
  const fmt = (ts: number) =>
    new Date(ts).toLocaleDateString(undefined, spanDays > 400 ? { year: "numeric", month: "short" } : { month: "short", day: "numeric" });
  return (
    <ResponsiveContainer width="100%" height={height}>
      <LineChart data={data} margin={{ top: 8, right: 16, bottom: 0, left: 0 }}>
        <CartesianGrid stroke={COLORS.grid} strokeDasharray="3 3" vertical={false} />
        <XAxis dataKey="ts" type="number" scale="time" domain={["dataMin", "dataMax"]} tick={AXIS_TICK} tickFormatter={fmt} minTickGap={24} />
        <YAxis tick={AXIS_TICK} tickLine={false} axisLine={false} width={56} tickFormatter={(v: number) => formatNumber(v)} domain={["auto", "auto"]} />
        <Tooltip
          content={({ active, payload }) => {
            const d = (payload?.[0] as TipEntry | undefined)?.payload as (typeof data)[number] | undefined;
            return active && d ? (
              <TipBox
                title={new Date(d.ts).toLocaleString()}
                rows={[
                  [series.aggregated ? `Mean ${series.column}` : series.column, formatNumber(d.v, 4)],
                  ...(d.n ? ([["Observations", String(d.n)]] as [string, string][]) : []),
                  ["Flagged", d.flagged ? "Yes" : "No", d.flagged ? COLORS.flagged : undefined],
                ]}
              />
            ) : null;
          }}
        />
        <Legend wrapperStyle={{ fontSize: 12 }} />
        <Line
          type="monotone"
          dataKey="v"
          name={`${series.column} by ${timeColumn}${series.aggregated ? " (bucket mean)" : ""}`}
          stroke={COLORS.primary}
          strokeWidth={2}
          dot={FlaggedDot}
          activeDot={{ r: 4 }}
          isAnimationActive={false}
        />
      </LineChart>
    </ResponsiveContainer>
  );
}

function correlationColor(r: number | null): string {
  if (r == null || !Number.isFinite(r)) return "#F8FAFC";
  const alpha = Math.min(1, Math.abs(r));
  return r >= 0 ? `rgba(23, 107, 135, ${alpha * 0.85})` : `rgba(217, 83, 79, ${alpha * 0.85})`;
}

/** F. Pearson correlation matrix rendered as an accessible table heatmap. */
export function CorrelationHeatmap({ data }: { data: CorrelationData }) {
  return (
    <div className="overflow-x-auto">
      <table className="border-separate border-spacing-0.5 text-[11px]" aria-label="Correlation matrix">
        <thead>
          <tr>
            <th scope="col" className="sr-only">Column</th>
            {data.columns.map((c) => (
              <th key={c} scope="col" className="max-w-[5.5rem] truncate px-1 pb-1 font-medium text-slate-500" title={c}>
                {truncate(c, 10)}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {data.columns.map((row, i) => (
            <tr key={row}>
              <th scope="row" className="max-w-[8rem] truncate pe-2 text-right font-medium text-slate-500" title={row}>
                {truncate(row, 16)}
              </th>
              {data.matrix[i].map((r, j) => {
                const strong = r != null && Math.abs(r) >= 0.5;
                return (
                  <td
                    key={j}
                    title={`${row} × ${data.columns[j]}: ${r == null ? "not enough paired values" : r.toFixed(2)} (n=${data.pairs[i]?.[j] ?? 0})`}
                    className={`h-10 w-14 min-w-[3.5rem] rounded text-center font-semibold ${strong ? "text-white" : "text-slate-700"}`}
                    style={{ background: correlationColor(r) }}
                  >
                    {r == null ? "–" : r.toFixed(2)}
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
      <p className="mt-2 flex flex-wrap items-center gap-3 text-[11px] text-slate-500">
        <span className="inline-flex items-center gap-1"><span className="h-2.5 w-2.5 rounded-sm" style={{ background: correlationColor(0.9) }} /> positive</span>
        <span className="inline-flex items-center gap-1"><span className="h-2.5 w-2.5 rounded-sm" style={{ background: correlationColor(-0.9) }} /> negative</span>
        <span>
          Pearson r on pairwise complete rows (minimum {data.min_pairs} pairs). A single extreme value can strongly
          raise or hide a correlation; correlation does not imply causation.
        </span>
      </p>
    </div>
  );
}
