import { FileDown, FileSpreadsheet, Loader2, Sparkles } from "lucide-react";
import { useState } from "react";
import { Panel } from "../../components/dashboard/DashboardCard";
import { AnalysisGate } from "../../components/labvision/LabVisionLayout";
import { SEVERITY_META } from "../../components/labvision/labels";
import { Button, formatDate } from "../../components/ui";
import { useLabVision } from "../../hooks/useLabVision";
import { useToast } from "../../hooks/useToast";
import { labvisionApi } from "../../services/endpoints";
import type { Analysis } from "../../types/labvision";

const STATUS_STYLE = {
  applied: "bg-emerald-50 text-emerald-800 ring-emerald-200",
  skipped: "bg-amber-50 text-amber-800 ring-amber-200",
  disabled: "bg-slate-100 text-slate-500 ring-slate-200",
};

function Reports({ analysis }: { analysis: Analysis }) {
  const { setAnalysis, config } = useLabVision();
  const toast = useToast();
  const [includeExamples, setIncludeExamples] = useState(false);
  const [busy, setBusy] = useState<"pdf" | "csv" | "llm" | null>(null);
  const [llmError, setLlmError] = useState<string | null>(null);
  const { results } = analysis;

  const run = async (kind: "pdf" | "csv", action: () => Promise<void>) => {
    setBusy(kind);
    try {
      await action();
    } catch (err) {
      toast((err as Error).message, "error");
    } finally {
      setBusy(null);
    }
  };

  const explain = async () => {
    setBusy("llm");
    setLlmError(null);
    try {
      setAnalysis(await labvisionApi.explain(analysis.id));
    } catch (err) {
      setLlmError((err as Error).message);
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="space-y-4">
      <div className="grid gap-4 lg:grid-cols-2">
        <Panel className="p-5">
          <h2 className="flex items-center gap-2 text-sm font-semibold text-slate-900"><FileDown className="h-4 w-4 text-primary" aria-hidden /> PDF summary report</h2>
          <p className="mt-1 text-xs text-slate-500">
            Dataset metadata, analysis time, rows and columns, quality metrics and score, issue and anomaly counts,
            methods and parameters, charts, human review status, recommendations and limitations.
          </p>
          <label className="mt-3 flex items-start gap-2 text-sm text-slate-700">
            <input type="checkbox" className="mt-0.5 h-4 w-4 accent-[#176B87]" checked={includeExamples} onChange={(e) => setIncludeExamples(e.target.checked)} />
            <span>
              Include up to 50 example findings
              <span className="block text-xs text-amber-700">These contain record identifiers and observed values. Leave unchecked to keep raw records out of the report.</span>
            </span>
          </label>
          <Button className="mt-4" onClick={() => run("pdf", () => labvisionApi.downloadReport(analysis.id, includeExamples))} disabled={busy !== null}>
            {busy === "pdf" ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : <FileDown className="h-4 w-4" aria-hidden />} Download PDF
          </Button>
        </Panel>
        <Panel className="p-5">
          <h2 className="flex items-center gap-2 text-sm font-semibold text-slate-900"><FileSpreadsheet className="h-4 w-4 text-primary" aria-hidden /> Findings (CSV)</h2>
          <p className="mt-1 text-xs text-slate-500">
            All {analysis.finding_count.toLocaleString()} stored findings with machine-generated fields and, in separate
            <code className="mx-1 rounded bg-surface px-1">human_review_*</code> columns, the recorded decisions. Cells that
            could be interpreted as spreadsheet formulas are escaped. Use the Anomaly Explorer to export a filtered subset.
          </p>
          <Button variant="secondary" className="mt-4" onClick={() => run("csv", () => labvisionApi.exportFindings(analysis.id, {}))} disabled={busy !== null || !analysis.finding_count}>
            {busy === "csv" ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : <FileSpreadsheet className="h-4 w-4" aria-hidden />} Download CSV
          </Button>
        </Panel>
      </div>

      <Panel className="p-5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h2 className="flex items-center gap-2 text-sm font-semibold text-slate-900">
              <Sparkles className="h-4 w-4 text-secondary" aria-hidden /> Plain-language explanation
              <span className="rounded-full bg-amber-50 px-2 py-0.5 text-[10px] font-semibold uppercase text-amber-800 ring-1 ring-amber-200">AI-generated · not verified</span>
            </h2>
            <p className="mt-1 max-w-2xl text-xs text-slate-500">
              Optional. The language model{config?.llm_model ? ` (${config.llm_model})` : ""} receives only aggregated
              results — no record values, identifiers or row numbers — and is instructed not to invent numbers. The
              computed metrics above remain the reference.
            </p>
          </div>
          <Button variant="soft" onClick={explain} disabled={busy !== null}>
            {busy === "llm" ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : <Sparkles className="h-4 w-4" aria-hidden />}
            {analysis.explanation ? "Regenerate" : "Generate explanation"}
          </Button>
        </div>
        {busy === "llm" && <p className="mt-3 text-xs text-slate-500" role="status">Generating… this can take a minute on CPU.</p>}
        {llmError && <p role="alert" className="mt-3 text-sm text-red-700">{llmError}</p>}
        {analysis.explanation && (
          <div className="mt-3 rounded-xl border border-dashed border-amber-300 bg-amber-50/40 p-4 text-sm leading-relaxed text-slate-700">
            {analysis.explanation.text.split("\n").filter((p) => p.trim()).map((p, i) => <p key={i} className="mt-2 first:mt-0">{p}</p>)}
            <p className="mt-3 text-[11px] text-slate-500">Generated by {analysis.explanation.model} on {formatDate(analysis.explanation.generated_at)}.</p>
          </div>
        )}
      </Panel>

      <Panel className="p-5">
        <h2 className="text-sm font-semibold text-slate-900">Methods and parameters</h2>
        <div className="mt-3 overflow-x-auto rounded-xl ring-1 ring-slate-200">
          <table className="min-w-full text-xs">
            <thead className="bg-surface text-left text-slate-600">
              <tr>{["Method", "Status", "Parameters", "Flagged", "Columns / notes"].map((h) => <th key={h} scope="col" className="px-3 py-2 font-semibold">{h}</th>)}</tr>
            </thead>
            <tbody className="divide-y divide-slate-100 bg-white align-top">
              {results.methods.map((m) => (
                <tr key={m.method}>
                  <th scope="row" className="whitespace-nowrap px-3 py-2 text-left font-semibold text-slate-800">{m.label}</th>
                  <td className="px-3 py-2"><span className={`rounded-full px-2 py-0.5 text-[11px] font-semibold ring-1 ${STATUS_STYLE[m.status]}`}>{m.status}</span></td>
                  <td className="px-3 py-2 font-mono text-[11px] text-slate-600">
                    {Object.entries(m.parameters).filter(([k]) => k !== "columns").map(([k, v]) => `${k}=${String(v)}`).join(", ") || "—"}
                  </td>
                  <td className="px-3 py-2 font-semibold">{m.flagged.toLocaleString()}</td>
                  <td className="max-w-md px-3 py-2 text-slate-600">
                    {m.columns_applied.length > 0 && <p>Applied to: {m.columns_applied.join(", ")}</p>}
                    {m.notes.map((n) => <p key={n} className="text-amber-800">{n}</p>)}
                    {m.columns_skipped.length > 0 && (
                      <details className="mt-1">
                        <summary className="cursor-pointer text-slate-500">{m.columns_skipped.length} column(s) not suitable</summary>
                        <ul className="mt-1 list-inside list-disc">{m.columns_skipped.map((s) => <li key={s.column}>{s.column}: {s.reason}</li>)}</ul>
                      </details>
                    )}
                    {m.assumptions.length > 0 && (
                      <details className="mt-1">
                        <summary className="cursor-pointer text-slate-500">Assumptions</summary>
                        <ul className="mt-1 list-inside list-disc">{m.assumptions.map((a) => <li key={a}>{a}</li>)}</ul>
                      </details>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Panel>

      <div className="grid gap-4 xl:grid-cols-2">
        <Panel className="p-5">
          <h2 className="text-sm font-semibold text-slate-900">Recommendations</h2>
          {results.recommendations.length === 0 ? (
            <p className="mt-2 text-sm text-slate-500">No rule was triggered.</p>
          ) : (
            <ul className="mt-3 space-y-3">
              {results.recommendations.map((r) => (
                <li key={r.id} className="rounded-xl border border-slate-200 p-3 text-xs">
                  <p className="flex flex-wrap items-center gap-2 text-sm font-semibold text-slate-800">
                    {r.title}
                    <span className={`rounded-full px-2 py-0.5 text-[10px] ring-1 ${SEVERITY_META[r.severity].className}`}>{SEVERITY_META[r.severity].label}</span>
                    <span className="font-mono text-[10px] text-slate-400">{r.id}</span>
                  </p>
                  <p className="mt-1 text-slate-500"><b>Reason:</b> {r.reason}</p>
                  <p className="mt-1 text-slate-600"><b>Action:</b> {r.action}</p>
                  <p className="mt-1 text-slate-400">Triggered by: {r.trigger.label} ({r.trigger.count.toLocaleString()}){r.trigger.columns.length ? ` in ${r.trigger.columns.join(", ")}` : ""}</p>
                </li>
              ))}
            </ul>
          )}
        </Panel>
        <Panel className="p-5">
          <h2 className="text-sm font-semibold text-slate-900">Limitations</h2>
          <ul className="mt-3 list-inside list-disc space-y-1.5 text-xs text-slate-600">
            {[...results.limitations, ...results.notes].map((l) => <li key={l}>{l}</li>)}
          </ul>
          <p className="mt-4 rounded-lg bg-surface px-3 py-2 text-xs text-slate-600">{results.safety_notice}</p>
        </Panel>
      </div>
    </div>
  );
}

export function LabVisionReportsPage() {
  return <AnalysisGate>{(analysis) => <Reports analysis={analysis} />}</AnalysisGate>;
}
