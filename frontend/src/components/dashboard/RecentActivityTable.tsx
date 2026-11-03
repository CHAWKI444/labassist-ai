import { CheckCircle2, CircleSlash, XCircle } from "lucide-react";
import type { RecentActivityItem, RequestStatus } from "../../types";
import { ARCHITECTURES, formatDuration, formatTimestamp, isArchitecture } from "./format";

const STATUS: Record<RequestStatus, { label: string; className: string; icon: typeof CheckCircle2 }> = {
  success: { label: "Answered", className: "bg-emerald-50 text-emerald-700", icon: CheckCircle2 },
  error: { label: "Failed", className: "bg-red-50 text-red-700", icon: XCircle },
  unanswered: { label: "No answer", className: "bg-amber-50 text-amber-700", icon: CircleSlash },
};

function StatusBadge({ status }: { status: RequestStatus }) {
  const meta = STATUS[status] ?? STATUS.error;
  const Icon = meta.icon;
  return (
    <span className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-semibold ${meta.className}`}>
      <Icon className="h-3 w-3" aria-hidden />
      {meta.label}
    </span>
  );
}

function ArchitectureLabel({ item }: { item: RecentActivityItem }) {
  if (!isArchitecture(item.architecture)) return <span className="text-slate-400">—</span>;
  const meta = ARCHITECTURES[item.architecture];
  const detail = item.architecture === "hybrid" ? item.architectures.map((a) => a.toUpperCase()).join(" + ") : undefined;
  return (
    <span className="inline-flex items-center gap-1.5 font-medium text-slate-800" title={detail}>
      <span className="h-2 w-2 rounded-full" style={{ background: meta.color }} />
      {meta.label}
      {detail && <span className="hidden text-[11px] font-normal text-slate-500 lg:inline">({detail})</span>}
    </span>
  );
}

export function RecentActivityTable({ items, showRole }: { items: RecentActivityItem[]; showRole: boolean }) {
  return (
    <>
      <ul className="divide-y divide-slate-100 md:hidden" aria-label="Recent activity">
        {items.map((item, i) => (
          <li key={`${item.created_at}-${i}`} className="flex items-start justify-between gap-3 py-3">
            <div className="min-w-0 space-y-1">
              <ArchitectureLabel item={item} />
              <p className="text-xs text-slate-500">
                {formatTimestamp(item.created_at)}
                {item.mode && <> · {item.mode.toUpperCase()} mode</>}
                {showRole && item.role && <> · {item.role}</>}
              </p>
            </div>
            <div className="shrink-0 space-y-1 text-right">
              <StatusBadge status={item.status} />
              <p className="text-xs font-medium text-slate-600">{formatDuration(item.response_ms)}</p>
            </div>
          </li>
        ))}
      </ul>
      <div className="hidden overflow-x-auto md:block">
        <table className="w-full text-left text-sm">
          <thead>
            <tr className="text-[11px] uppercase tracking-wide text-slate-500">
              <th scope="col" className="px-3 py-2 font-semibold">Date</th>
              <th scope="col" className="px-3 py-2 font-semibold">Architecture</th>
              <th scope="col" className="px-3 py-2 font-semibold">Mode</th>
              {showRole && <th scope="col" className="px-3 py-2 font-semibold">Role</th>}
              <th scope="col" className="px-3 py-2 font-semibold">Status</th>
              <th scope="col" className="px-3 py-2 text-right font-semibold">Response time</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {items.map((item, i) => (
              <tr key={`${item.created_at}-${i}`} className="hover:bg-surface/60">
                <td className="whitespace-nowrap px-3 py-2.5 text-slate-600">{formatTimestamp(item.created_at)}</td>
                <td className="px-3 py-2.5"><ArchitectureLabel item={item} /></td>
                <td className="px-3 py-2.5 text-xs font-semibold uppercase text-slate-500">{item.mode ?? "—"}</td>
                {showRole && <td className="px-3 py-2.5 capitalize text-slate-600">{item.role ?? "—"}</td>}
                <td className="px-3 py-2.5"><StatusBadge status={item.status} /></td>
                <td className="whitespace-nowrap px-3 py-2.5 text-right font-medium text-slate-700">
                  {formatDuration(item.response_ms)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}
