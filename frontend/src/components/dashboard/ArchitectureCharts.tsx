import { Bar, BarChart, CartesianGrid, Cell, Pie, PieChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { ArchitectureTooltip } from "./ChartTooltip";
import { ARCHITECTURES, formatDuration, type ArchitectureDatum } from "./format";

const AXIS_TICK = { fontSize: 12, fill: "#64748B" };

/** Donut of the requests actually handled by each architecture, with a legend listing counts and shares. */
export function ArchitecturePieChart({ data, total }: { data: ArchitectureDatum[]; total: number }) {
  return (
    <div className="flex flex-col items-center gap-4 sm:flex-row xl:flex-col 2xl:flex-row">
      <div className="relative h-[220px] w-full max-w-[240px] shrink-0">
        <ResponsiveContainer width="100%" height="100%">
          <PieChart>
            <Pie
              data={data}
              dataKey="count"
              nameKey="label"
              innerRadius="62%"
              outerRadius="92%"
              paddingAngle={data.length > 1 ? 2 : 0}
              stroke="#FFFFFF"
              strokeWidth={2}
            >
              {data.map((d) => (
                <Cell key={d.key} fill={d.color} />
              ))}
            </Pie>
            <Tooltip content={ArchitectureTooltip} />
          </PieChart>
        </ResponsiveContainer>
        <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center">
          <span className="text-2xl font-semibold text-slate-900">{total.toLocaleString()}</span>
          <span className="text-[11px] font-medium uppercase tracking-wide text-slate-500">requests</span>
        </div>
      </div>
      <ul className="w-full min-w-0 space-y-2" aria-label="Architecture legend">
        {data.map((d) => (
          <li key={d.key} className="flex items-center gap-3 rounded-lg px-2 py-1.5 text-sm hover:bg-surface">
            <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: d.color }} />
            <span className="min-w-0 flex-1">
              <span className="block font-medium text-slate-800">{d.label}</span>
              <span className="block truncate text-[11px] text-slate-500">{ARCHITECTURES[d.key].description}</span>
            </span>
            <span className="text-right">
              <span className="block font-semibold text-slate-900">{d.count.toLocaleString()}</span>
              <span className="block text-[11px] text-slate-500">{d.percentage}%</span>
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}

export function ArchitectureBarChart({ data, height = 280 }: { data: ArchitectureDatum[]; height?: number }) {
  return (
    <div>
      <ResponsiveContainer width="100%" height={height}>
        <BarChart data={data} margin={{ top: 8, right: 8, bottom: 0, left: -16 }}>
          <CartesianGrid stroke="#E2E8F0" strokeDasharray="3 3" vertical={false} />
          <XAxis dataKey="label" tick={AXIS_TICK} tickLine={false} axisLine={{ stroke: "#E2E8F0" }} interval={0} />
          <YAxis allowDecimals={false} tick={AXIS_TICK} tickLine={false} axisLine={false} width={44} />
          <Tooltip content={ArchitectureTooltip} cursor={{ fill: "#F1F5F9" }} />
          <Bar dataKey="count" name="Requests" radius={[6, 6, 0, 0]} maxBarSize={56}>
            {data.map((d) => (
              <Cell key={d.key} fill={d.color} />
            ))}
          </Bar>
        </BarChart>
      </ResponsiveContainer>
      <dl className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-4">
        {data
          .filter((d) => d.key !== "llm")
          .map((d) => (
            <div key={d.key} className="rounded-lg bg-surface px-3 py-2">
              <dt className="text-[11px] font-medium text-slate-500">{d.label} avg.</dt>
              <dd className="text-sm font-semibold text-slate-800">{formatDuration(d.avgResponseMs)}</dd>
            </div>
          ))}
      </dl>
    </div>
  );
}
