import { Download, Loader2, Search } from "lucide-react";
import { useEffect, useState } from "react";
import { ErrorState, EmptyState, Panel } from "../../components/dashboard/DashboardCard";
import { AnalysisGate } from "../../components/labvision/LabVisionLayout";
import {
  CATEGORY_META,
  REVIEW_META,
  REVIEW_STATUSES,
  SEVERITY_META,
  formatNumber,
  issueLabel,
  methodLabel,
  rowsLabel,
} from "../../components/labvision/labels";
import { Button, Modal, Pagination, Textarea, formatDate } from "../../components/ui";
import { useLabVision } from "../../hooks/useLabVision";
import { useToast } from "../../hooks/useToast";
import { labvisionApi } from "../../services/endpoints";
import type { Analysis, Finding, FindingFilters, FindingPage, ReviewStatus } from "../../types/labvision";

const selectClass =
  "w-full rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-sm text-slate-800 focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/20";

function Pill({ className, children }: { className: string; children: React.ReactNode }) {
  return <span className={`inline-flex whitespace-nowrap rounded-full px-2 py-0.5 text-[11px] font-semibold ring-1 ${className}`}>{children}</span>;
}

function ReviewDialog({ finding, onClose, onSaved }: { finding: Finding; onClose: () => void; onSaved: (f: Finding) => void }) {
  const [status, setStatus] = useState<ReviewStatus>(finding.review_status);
  const [note, setNote] = useState(finding.review_note ?? "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const save = async () => {
    setBusy(true);
    setError(null);
    try {
      onSaved(await labvisionApi.review(finding.id, status, note.trim() || null));
    } catch (err) {
      setError((err as Error).message);
      setBusy(false);
    }
  };
  const details: [string, string][] = [
    ["Rows", rowsLabel(finding.row_numbers, finding.affected_count, 10)],
    ["Record identifier", finding.record_id ?? "—"],
    ["Column", finding.column ?? "—"],
    ["Observed value (original)", finding.observed_value ?? "—"],
    ["Issue", issueLabel(finding.issue_type)],
    ["Method", methodLabel(finding.method)],
    ["Score", finding.score == null ? "—" : formatNumber(finding.score, 4)],
    ["Threshold", finding.threshold ?? "—"],
  ];
  return (
    <Modal title="Review finding" subtitle={`Finding #${finding.id}`} onClose={onClose}>
      <section aria-labelledby="machine-finding">
        <h3 id="machine-finding" className="text-xs font-semibold uppercase tracking-wide text-slate-500">Machine-generated finding (read-only)</h3>
        <dl className="mt-2 grid gap-x-4 gap-y-1.5 rounded-xl bg-surface p-3 text-sm sm:grid-cols-2">
          {details.map(([k, v]) => (
            <div key={k} className="min-w-0">
              <dt className="text-[11px] text-slate-500">{k}</dt>
              <dd className="break-words font-medium text-slate-800">{v}</dd>
            </div>
          ))}
        </dl>
        <p className="mt-2 text-sm text-slate-700">{finding.explanation}</p>
        <p className="mt-1 text-sm text-slate-600"><b>Suggested verification:</b> {finding.suggested_action}</p>
      </section>
      <fieldset className="mt-5">
        <legend className="text-xs font-semibold uppercase tracking-wide text-slate-500">Human decision</legend>
        <div className="mt-2 grid gap-2 sm:grid-cols-2">
          {REVIEW_STATUSES.map((s) => (
            <label key={s} className={`flex cursor-pointer items-start gap-2 rounded-xl border p-2.5 text-sm ${status === s ? "border-primary bg-primary/5" : "border-slate-200"}`}>
              <input type="radio" name="review-status" value={s} checked={status === s} onChange={() => setStatus(s)} className="mt-0.5 accent-[#176B87]" />
              <span>
                <span className="block font-semibold text-slate-800">{REVIEW_META[s].label}</span>
                <span className="block text-xs text-slate-500">{REVIEW_META[s].description}</span>
              </span>
            </label>
          ))}
        </div>
        <label className="mt-3 block text-sm font-medium text-slate-700">
          Note <span className="font-normal text-slate-400">(optional, max 500 characters)</span>
          <Textarea className="mt-1" rows={3} maxLength={500} value={note} onChange={(e) => setNote(e.target.value)} />
        </label>
        {finding.reviewed_at && (
          <p className="mt-2 text-xs text-slate-500">Last decision by {finding.reviewer_name ?? "a reviewer"} on {formatDate(finding.reviewed_at)}.</p>
        )}
      </fieldset>
      {error && <p role="alert" className="mt-3 text-sm text-red-700">{error}</p>}
      <div className="mt-5 flex justify-end gap-2">
        <Button variant="secondary" onClick={onClose} disabled={busy}>Cancel</Button>
        <Button onClick={save} disabled={busy}>{busy && <Loader2 className="h-4 w-4 animate-spin" aria-hidden />} Save decision</Button>
      </div>
    </Modal>
  );
}

function Explorer({ analysis }: { analysis: Analysis }) {
  const { setAnalysis } = useLabVision();
  const toast = useToast();
  const [filters, setFilters] = useState<FindingFilters>({});
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(25);
  const [data, setData] = useState<FindingPage | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [attempt, setAttempt] = useState(0);
  const [reviewing, setReviewing] = useState<Finding | null>(null);
  const [exporting, setExporting] = useState(false);

  useEffect(() => {
    const q = search.trim() || undefined;
    if (q === filters.q) return;
    const t = window.setTimeout(() => {
      setFilters((f) => ({ ...f, q }));
      setPage(1);
    }, 300);
    return () => window.clearTimeout(t);
  }, [search, filters.q]);

  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    labvisionApi.findings(analysis.id, filters, pageSize, (page - 1) * pageSize, controller.signal).then(
      (result) => {
        setData(result);
        setError(null);
        setLoading(false);
      },
      (err: Error) => {
        if (controller.signal.aborted) return;
        setError(err.message);
        setLoading(false);
      },
    );
    return () => controller.abort();
  }, [analysis.id, filters, page, pageSize, attempt]);

  const setFilter = (key: keyof FindingFilters, value: string) => {
    setFilters((f) => ({ ...f, [key]: value || undefined }));
    setPage(1);
  };

  const onSaved = (updated: Finding) => {
    const previous = data?.items.find((f) => f.id === updated.id)?.review_status;
    setData((d) => d && { ...d, items: d.items.map((f) => (f.id === updated.id ? updated : f)) });
    if (previous && previous !== updated.review_status) {
      const counts = { ...analysis.review_counts };
      counts[previous] = Math.max(0, (counts[previous] ?? 0) - 1);
      counts[updated.review_status] = (counts[updated.review_status] ?? 0) + 1;
      setAnalysis({ ...analysis, review_counts: counts });
    }
    setReviewing(null);
    toast(`Finding #${updated.id} marked as ${REVIEW_META[updated.review_status].label.toLowerCase()}.`);
  };

  const exportCsv = async () => {
    setExporting(true);
    try {
      await labvisionApi.exportFindings(analysis.id, filters);
    } catch (err) {
      toast((err as Error).message, "error");
    } finally {
      setExporting(false);
    }
  };

  const facets = data?.facets ?? {};
  const active = Object.values(filters).some(Boolean);

  return (
    <div className="space-y-4">
      <Panel className="p-4">
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-7">
          <label className="relative block xl:col-span-2">
            <span className="sr-only">Search findings</span>
            <Search className="pointer-events-none absolute start-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" aria-hidden />
            <input type="search" value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search value, record, explanation…"
              className={`${selectClass} ps-9`} />
          </label>
          {([
            ["column", "Column", "All columns", (facets.column ?? []).map((c) => [c, c])],
            ["category", "Category", "All categories", [["data_quality", "Data quality"], ["statistical_outlier", "Statistical outlier"]]],
            ["issue_type", "Anomaly type", "All types", (facets.issue_type ?? []).map((t) => [t, issueLabel(t)])],
            ["method", "Method", "All methods", (facets.method ?? []).map((m) => [m, methodLabel(m)])],
            ["review_status", "Review status", "Any review status", REVIEW_STATUSES.map((s) => [s, REVIEW_META[s].label])],
          ] as [keyof FindingFilters, string, string, [string, string][]][]).map(([key, label, all, options]) => (
            <label key={key} className="block">
              <span className="sr-only">{label}</span>
              <select aria-label={label} value={(filters[key] as string) ?? ""} onChange={(e) => setFilter(key, e.target.value)} className={selectClass}>
                <option value="">{all}</option>
                {options.map(([value, text]) => <option key={value} value={value}>{text}</option>)}
              </select>
            </label>
          ))}
        </div>
        <div className="mt-3 flex flex-wrap items-center justify-between gap-2 text-xs text-slate-500">
          <span>
            {data ? `${data.total.toLocaleString()} finding${data.total === 1 ? "" : "s"}${active ? " match the filters" : ""}` : "Loading findings…"}
            {analysis.results.truncated && ` · ${analysis.results.findings_stored.toLocaleString()} of ${analysis.results.findings_total.toLocaleString()} findings stored (highest severity first)`}
          </span>
          <span className="flex gap-2">
            {active && (
              <button type="button" onClick={() => { setFilters({}); setSearch(""); setPage(1); }} className="font-semibold text-primary hover:underline">
                Clear filters
              </button>
            )}
            <Button variant="secondary" size="sm" onClick={exportCsv} disabled={exporting || !data?.total}>
              {exporting ? <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden /> : <Download className="h-3.5 w-3.5" aria-hidden />}
              Export {active ? "filtered " : ""}CSV
            </Button>
          </span>
        </div>
      </Panel>

      <Panel className="overflow-hidden">
        {error ? (
          <ErrorState message={error} onRetry={() => setAttempt((n) => n + 1)} />
        ) : !data ? (
          <div role="status" aria-label="Loading findings" className="animate-pulse space-y-2 p-5">
            {Array.from({ length: 6 }, (_, i) => <div key={i} className="h-10 rounded-lg bg-slate-100" />)}
          </div>
        ) : data.total === 0 ? (
          <EmptyState
            title={active ? "No finding matches these filters" : "No findings"}
            message={active ? "Change or clear the filters." : "No data-quality issue or statistical anomaly was detected in this analysis."}
          />
        ) : (
          <>
            <div className={`overflow-x-auto ${loading ? "opacity-60" : ""}`} aria-busy={loading || undefined}>
              <table className="min-w-full text-xs">
                <caption className="sr-only">Findings of analysis #{analysis.id}</caption>
                <thead className="bg-surface text-left text-slate-600">
                  <tr className="text-[10px] uppercase tracking-wide text-slate-400">
                    <th colSpan={8} scope="colgroup" className="px-3 pt-2 font-semibold">Machine-generated finding</th>
                    <th colSpan={2} scope="colgroup" className="border-s border-slate-200 px-3 pt-2 font-semibold">Human review</th>
                  </tr>
                  <tr>
                    {["Rows", "Record", "Column", "Observed value", "Issue", "Method", "Severity", "Explanation & suggested check"].map((h) => (
                      <th key={h} scope="col" className="whitespace-nowrap px-3 py-2 font-semibold">{h}</th>
                    ))}
                    <th scope="col" className="whitespace-nowrap border-s border-slate-200 px-3 py-2 font-semibold">Status</th>
                    <th scope="col" className="px-3 py-2"><span className="sr-only">Actions</span></th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 bg-white align-top">
                  {data.items.map((f) => (
                    <tr key={f.id}>
                      <td className="whitespace-nowrap px-3 py-2 font-medium text-slate-700">{rowsLabel(f.row_numbers, f.affected_count)}</td>
                      <td className="max-w-[8rem] truncate px-3 py-2 text-slate-600" title={f.record_id ?? ""}>{f.record_id ?? "—"}</td>
                      <td className="max-w-[9rem] truncate px-3 py-2 text-slate-700" title={f.column ?? ""}>{f.column ?? "—"}</td>
                      <td className="max-w-[9rem] truncate px-3 py-2 font-mono text-slate-800" title={f.observed_value ?? ""}>{f.observed_value ?? "—"}</td>
                      <td className="px-3 py-2">
                        <span className="block font-medium text-slate-800">{issueLabel(f.issue_type)}</span>
                        <Pill className={CATEGORY_META[f.category].className}>{CATEGORY_META[f.category].label}</Pill>
                      </td>
                      <td className="whitespace-nowrap px-3 py-2 text-slate-600">{methodLabel(f.method)}</td>
                      <td className="px-3 py-2"><Pill className={SEVERITY_META[f.severity].className}>{SEVERITY_META[f.severity].label}</Pill></td>
                      <td className="min-w-[18rem] max-w-md px-3 py-2 text-slate-600">
                        <p>{f.explanation}</p>
                        <p className="mt-1 text-slate-500"><b>Check:</b> {f.suggested_action}</p>
                      </td>
                      <td className="border-s border-slate-100 px-3 py-2">
                        <Pill className={REVIEW_META[f.review_status].className}>{REVIEW_META[f.review_status].label}</Pill>
                        {f.review_note && <p className="mt-1 max-w-[10rem] truncate text-[11px] text-slate-500" title={f.review_note}>{f.review_note}</p>}
                      </td>
                      <td className="px-3 py-2">
                        <Button variant="soft" size="sm" onClick={() => setReviewing(f)} aria-label={`Review finding ${f.id}`}>Review</Button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <Pagination total={data.total} page={page} pageSize={pageSize} onPage={setPage}
              onPageSize={(s) => { setPageSize(s); setPage(1); }} noun="findings" />
          </>
        )}
      </Panel>
      <p className="text-xs text-slate-500">
        Row numbers count data rows from 1 (header excluded). Observed values are shown exactly as they appear in the
        file. Severity follows explicit rules: user-defined ranges, rules and duplicate keys are high; statistical
        outliers are low unless two or more methods flag the same observation.
      </p>
      {reviewing && <ReviewDialog finding={reviewing} onClose={() => setReviewing(null)} onSaved={onSaved} />}
    </div>
  );
}

export function LabVisionAnomaliesPage() {
  return <AnalysisGate>{(analysis) => <Explorer analysis={analysis} />}</AnalysisGate>;
}
