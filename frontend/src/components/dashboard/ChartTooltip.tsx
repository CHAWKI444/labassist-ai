import type { ReactNode } from "react";
import { formatDayLong, formatDuration, type ArchitectureDatum } from "./format";

/** Subset of the props Recharts passes to a custom tooltip `content` component. */
export interface TooltipProps<T> {
  active?: boolean;
  label?: string | number;
  payload?: ReadonlyArray<{ name?: string | number; value?: unknown; color?: string; payload?: T }>;
}

function TooltipBox({ title, children }: { title: ReactNode; children: ReactNode }) {
  return (
    <div className="min-w-[160px] rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-xs shadow-lg">
      <p className="mb-1.5 font-semibold text-slate-900">{title}</p>
      <div className="space-y-1">{children}</div>
    </div>
  );
}

function Row({ color, label, value }: { color?: string; label: ReactNode; value: ReactNode }) {
  return (
    <p className="flex items-center justify-between gap-4 text-slate-600">
      <span className="flex items-center gap-1.5">
        {color && <span className="h-2 w-2 rounded-full" style={{ background: color }} />}
        {label}
      </span>
      <span className="font-semibold text-slate-900">{value}</span>
    </p>
  );
}

export function ActivityTooltip({ active, label, payload }: TooltipProps<unknown>) {
  if (!active || !payload?.length || typeof label !== "string") return null;
  return (
    <TooltipBox title={formatDayLong(label)}>
      {payload.map((entry) => (
        <Row
          key={String(entry.name)}
          color={entry.color}
          label={entry.name}
          value={typeof entry.value === "number" ? entry.value.toLocaleString() : "—"}
        />
      ))}
    </TooltipBox>
  );
}

export function ArchitectureTooltip({ active, payload }: TooltipProps<ArchitectureDatum>) {
  const datum = payload?.[0]?.payload;
  if (!active || !datum) return null;
  return (
    <TooltipBox title={<span className="flex items-center gap-1.5"><span className="h-2 w-2 rounded-full" style={{ background: datum.color }} />{datum.label}</span>}>
      <Row label="Requests" value={datum.count.toLocaleString()} />
      <Row label="Share" value={`${datum.percentage}%`} />
      <Row label="Avg. response" value={formatDuration(datum.avgResponseMs)} />
    </TooltipBox>
  );
}
