import { CheckCircle2, FileSpreadsheet, Loader2, Play, RotateCcw, Upload, Wand2 } from "lucide-react";
import { useMemo, useRef, useState, type DragEvent } from "react";
import { useNavigate } from "react-router-dom";
import { Panel } from "../../components/dashboard/DashboardCard";
import { InfoTip } from "../../components/InfoTip";
import { DEFAULT_METHODS, MethodsPanel, RulesEditor, methodsValid } from "../../components/labvision/AnalysisSettings";
import { TYPE_LABELS, formatPct } from "../../components/labvision/labels";
import { ErrorBanner, Notice, formatBytes } from "../../components/ui";
import { useLabVision } from "../../hooks/useLabVision";
import { ApiError } from "../../services/api";
import { labvisionApi } from "../../services/endpoints";
import type {
  AnalyzeRequest,
  CleaningOptions,
  CleaningPreview,
  DatasetPreview,
  ExpectedType,
  MethodConfig,
  RangeRule,
  ValidationRule,
} from "../../types/labvision";

export const ACCEPTED_EXTENSIONS = [".csv", ".xlsx", ".xls"];

interface ColumnSetting {
  selected: boolean;
  expected: ExpectedType | "";
  min: string;
  max: string;
  key: boolean;
}

type Phase = "idle" | "uploading" | "parsing" | "ready" | "analyzing";

export function validateFile(file: File, maxMb: number): string | null {
  const extension = file.name.slice(file.name.lastIndexOf(".")).toLowerCase();
  if (!ACCEPTED_EXTENSIONS.includes(extension)) return "Only CSV, XLSX and XLS files are accepted.";
  if (file.size === 0) return "The file is empty.";
  if (file.size > maxMb * 1024 * 1024) return `The file is ${formatBytes(file.size)}; the limit is ${maxMb} MB.`;
  return null;
}

function parseBound(text: string): number | null | "invalid" {
  if (!text.trim()) return null;
  const value = Number(text.replace(",", "."));
  return Number.isFinite(value) ? value : "invalid";
}

const card = "p-5";
const sectionTitle = "flex items-center gap-2 text-sm font-semibold text-slate-900";
const smallSelect =
  "w-full min-w-[7rem] rounded-md border border-slate-200 bg-white px-2 py-1 text-xs focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/20";

export function LabVisionImportPage() {
  const { config, setAnalysis } = useLabVision();
  const navigate = useNavigate();
  const maxMb = config?.limits.max_upload_mb ?? 10;
  const inputRef = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const [phase, setPhase] = useState<Phase>("idle");
  const [progress, setProgress] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [dragging, setDragging] = useState(false);
  const [preview, setPreview] = useState<DatasetPreview | null>(null);
  const [settings, setSettings] = useState<Record<string, ColumnSetting>>({});
  const [idColumn, setIdColumn] = useState("");
  const [timeColumn, setTimeColumn] = useState("");
  const [dayfirst, setDayfirst] = useState(true);
  const [methods, setMethods] = useState<MethodConfig>(config?.defaults ?? DEFAULT_METHODS);
  const [rules, setRules] = useState<ValidationRule[]>([]);
  const [cleaning, setCleaning] = useState<CleaningOptions>({
    trim_whitespace: false, normalise_missing_tokens: false, drop_exact_duplicates: false, drop_empty_columns: false,
  });
  const [cleaningPreview, setCleaningPreview] = useState<CleaningPreview | null>(null);
  const [cleaningBusy, setCleaningBusy] = useState(false);

  const upload = async (target: File, sheet?: string | null): Promise<DatasetPreview | null> => {
    setError(null);
    setPhase("uploading");
    setProgress(0);
    try {
      const result = await labvisionApi.preview(target, sheet, (f) => {
        setProgress(f);
        if (f >= 1) setPhase("parsing");
      });
      setPreview(result);
      setCleaningPreview(null);
      setSettings(Object.fromEntries(result.columns.map((c) => [c.name, { selected: true, expected: "", min: "", max: "", key: false }])));
      setTimeColumn((prev) => (prev && result.columns.some((c) => c.name === prev) ? prev : ""));
      setIdColumn((prev) => (prev && result.columns.some((c) => c.name === prev) ? prev : ""));
      setPhase("ready");
      return result;
    } catch (err) {
      setError((err as Error).message);
      setPhase(preview ? "ready" : "idle");
      return null;
    }
  };

  const choose = (candidate: File | undefined) => {
    if (!candidate) return;
    const problem = validateFile(candidate, maxMb);
    if (problem) {
      setError(problem);
      return;
    }
    if (preview) labvisionApi.discardDataset(preview.dataset_id).catch(() => undefined);
    setFile(candidate);
    setPreview(null);
    setRules([]);
    upload(candidate);
  };

  const onDrop = (e: DragEvent) => {
    e.preventDefault();
    setDragging(false);
    choose(e.dataTransfer.files?.[0]);
  };

  const reset = () => {
    if (preview) labvisionApi.discardDataset(preview.dataset_id).catch(() => undefined);
    setFile(null);
    setPreview(null);
    setError(null);
    setPhase("idle");
    if (inputRef.current) inputRef.current.value = "";
  };

  const columns = preview?.columns ?? [];
  const selected = columns.filter((c) => settings[c.name]?.selected);
  const dateColumns = columns.filter((c) => c.inferred_type === "date" || settings[c.name]?.expected === "date");
  const update = (name: string, patch: Partial<ColumnSetting>) => setSettings((s) => ({ ...s, [name]: { ...s[name], ...patch } }));

  const built = useMemo(() => {
    if (!preview) return { request: null, problems: [] as string[] };
    const problems: string[] = [];
    const ranges: Record<string, RangeRule> = {};
    const expected: Record<string, ExpectedType> = {};
    for (const c of preview.columns) {
      const s = settings[c.name];
      if (!s) continue;
      if (s.expected) expected[c.name] = s.expected;
      const min = parseBound(s.min);
      const max = parseBound(s.max);
      if (min === "invalid" || max === "invalid") problems.push(`The valid range of “${c.name}” is not a number.`);
      else if (min !== null && max !== null && min > max) problems.push(`The minimum of “${c.name}” is greater than its maximum.`);
      else if (min !== null || max !== null) ranges[c.name] = { min, max };
    }
    if (!selected.length) problems.push("Select at least one column to analyse.");
    if (!methodsValid(methods)) problems.push("Some method parameters are outside their allowed range.");
    if (preview.row_count === 0) problems.push("The dataset has no data rows to analyse.");
    const request: Omit<AnalyzeRequest, "dataset_id"> = {
      columns: selected.map((c) => c.name),
      id_column: idColumn || null,
      key_columns: preview.columns.filter((c) => settings[c.name]?.key).map((c) => c.name),
      time_column: timeColumn || null,
      expected_types: expected,
      ranges,
      rules,
      date_dayfirst: dayfirst,
      methods,
    };
    return { request, problems };
  }, [preview, settings, selected, idColumn, timeColumn, rules, dayfirst, methods]);

  const analyze = async () => {
    if (!preview || !built.request || built.problems.length) return;
    setError(null);
    setPhase("analyzing");
    try {
      let datasetId = preview.dataset_id;
      let analysis;
      try {
        analysis = await labvisionApi.analyze({ dataset_id: datasetId, ...built.request });
      } catch (err) {
        // The in-memory copy expired (or the server restarted): upload the same file again once.
        if (!(err instanceof ApiError && err.status === 404 && file)) throw err;
        const fresh = await upload(file, preview.sheet_name);
        if (!fresh) return;
        setPhase("analyzing");
        datasetId = fresh.dataset_id;
        analysis = await labvisionApi.analyze({ dataset_id: datasetId, ...built.request });
      }
      setAnalysis(analysis);
      navigate("/labvision");
    } catch (err) {
      setError((err as Error).message);
      setPhase("ready");
    }
  };

  const runCleaningPreview = async () => {
    if (!preview) return;
    setCleaningBusy(true);
    try {
      setCleaningPreview(await labvisionApi.cleaningPreview(preview.dataset_id, cleaning));
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setCleaningBusy(false);
    }
  };

  const busy = phase === "uploading" || phase === "parsing" || phase === "analyzing";
  const anyCleaning = Object.values(cleaning).some(Boolean);

  return (
    <div className="space-y-4">
      {error && <ErrorBanner message={error} onDismiss={() => setError(null)} />}

      <Panel className={card}>
        <h2 className={sectionTitle}><Upload className="h-4 w-4 text-primary" aria-hidden /> 1. Upload a dataset</h2>
        <label
          onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
          onDragLeave={() => setDragging(false)}
          onDrop={onDrop}
          className={`mt-3 flex cursor-pointer flex-col items-center justify-center gap-2 rounded-2xl border-2 border-dashed px-6 py-10 text-center transition-colors focus-within:ring-2 focus-within:ring-primary ${
            dragging ? "border-primary bg-primary/5" : "border-slate-300 bg-surface/60 hover:border-primary/60"
          } ${busy ? "pointer-events-none opacity-70" : ""}`}
        >
          <FileSpreadsheet className="h-8 w-8 text-primary" aria-hidden />
          <span className="text-sm font-semibold text-slate-800">Drag and drop a CSV or Excel file, or <span className="text-primary underline">browse</span></span>
          <span className="text-xs text-slate-500">
            .csv, .xlsx, .xls · up to {maxMb} MB · {config ? `${config.limits.max_rows.toLocaleString()} rows, ${config.limits.max_columns} columns` : "server limits apply"}
          </span>
          <input
            ref={inputRef}
            type="file"
            accept={ACCEPTED_EXTENSIONS.join(",")}
            className="sr-only"
            aria-label="Choose a CSV or Excel file"
            disabled={busy}
            onChange={(e) => choose(e.target.files?.[0])}
          />
        </label>
        <p className="mt-2 text-xs text-slate-500">
          The file is parsed in server memory for {config?.limits.dataset_ttl_minutes ?? 30} minutes and never written to
          disk. Cell contents are read as text; formulas are never evaluated. Only the computed results are kept
          ({config?.limits.retention_days ?? 30} days). Use fictitious or authorised data only.
        </p>

        {(phase === "uploading" || phase === "parsing") && file && (
          <div className="mt-4" role="status" aria-live="polite">
            <div className="flex items-center justify-between text-xs text-slate-600">
              <span className="flex items-center gap-1.5">
                <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden />
                {phase === "uploading" ? `Uploading ${file.name}…` : "Reading and validating the file…"}
              </span>
              <span>{phase === "uploading" ? `${Math.round(progress * 100)}%` : ""}</span>
            </div>
            <div className="mt-1.5 h-2 overflow-hidden rounded-full bg-slate-100">
              <div className={`h-2 rounded-full bg-primary transition-all ${phase === "parsing" ? "animate-pulse" : ""}`}
                style={{ width: `${phase === "parsing" ? 100 : Math.round(progress * 100)}%` }} />
            </div>
          </div>
        )}
      </Panel>

      {preview && (
        <>
          <Panel className={card}>
            <div className="flex flex-wrap items-start justify-between gap-3">
              <h2 className={sectionTitle}><CheckCircle2 className="h-4 w-4 text-secondary" aria-hidden /> 2. Preview</h2>
              <button type="button" onClick={reset} disabled={busy} className="inline-flex items-center gap-1 text-xs font-semibold text-slate-500 hover:text-slate-800">
                <RotateCcw className="h-3.5 w-3.5" aria-hidden /> Choose another file
              </button>
            </div>
            <dl className="mt-3 flex flex-wrap gap-2 text-xs">
              {[
                ["File", preview.name],
                ["Format", preview.file_type.toUpperCase()],
                ["Size", formatBytes(preview.size_bytes)],
                ["Rows", preview.row_count.toLocaleString()],
                ["Columns", String(preview.column_count)],
                ...(preview.encoding ? [["Encoding", preview.encoding]] : []),
                ...(preview.delimiter ? [["Delimiter", preview.delimiter === "\t" ? "tab" : `“${preview.delimiter}”`]] : []),
              ].map(([k, v]) => (
                <div key={k} className="rounded-lg bg-surface px-2.5 py-1.5">
                  <dt className="inline text-slate-500">{k}: </dt>
                  <dd className="inline font-semibold text-slate-800">{v}</dd>
                </div>
              ))}
            </dl>
            {preview.sheets.length > 1 && (
              <label className="mt-3 flex max-w-sm items-center gap-2 text-sm text-slate-600">
                Sheet
                <select className={smallSelect} value={preview.sheet_name ?? ""} disabled={busy}
                  onChange={(e) => file && upload(file, e.target.value)}>
                  {preview.sheets.map((s) => <option key={s} value={s}>{s}</option>)}
                </select>
              </label>
            )}
            {preview.warnings.length > 0 && (
              <div className="mt-3">
                <Notice tone="warning">
                  <ul className="list-inside list-disc space-y-0.5">{preview.warnings.map((w) => <li key={w}>{w}</li>)}</ul>
                </Notice>
              </div>
            )}
            <div className="mt-4 max-h-80 overflow-auto rounded-xl ring-1 ring-slate-200">
              <table className="min-w-full text-xs">
                <caption className="sr-only">First {preview.preview_rows.length} data rows</caption>
                <thead className="sticky top-0 bg-surface text-left text-slate-600">
                  <tr>
                    <th scope="col" className="px-2 py-1.5 font-semibold">Row</th>
                    {preview.columns.map((c) => <th key={c.name} scope="col" className="whitespace-nowrap px-2 py-1.5 font-semibold">{c.name}</th>)}
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 bg-white">
                  {preview.preview_rows.map((row, i) => (
                    <tr key={i}>
                      <td className="px-2 py-1 text-slate-400">{i + 1}</td>
                      {row.map((cell, j) => (
                        <td key={j} className="max-w-[14rem] truncate whitespace-nowrap px-2 py-1 text-slate-700" title={cell}>
                          {cell === "" ? <span className="text-slate-300">empty</span> : cell}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p className="mt-1.5 text-[11px] text-slate-400">Row 1 is the first data row below the header.</p>
          </Panel>

          <Panel className={card}>
            <h2 className={sectionTitle}>3. Columns to analyse</h2>
            <div className="mt-3 grid gap-3 sm:grid-cols-3">
              <label className="text-xs font-medium text-slate-600">
                Row identifier column
                <select className={`${smallSelect} mt-1`} value={idColumn} onChange={(e) => setIdColumn(e.target.value)}>
                  <option value="">None (use row numbers)</option>
                  {columns.map((c) => <option key={c.name} value={c.name}>{c.name}</option>)}
                </select>
              </label>
              <label className="text-xs font-medium text-slate-600">
                Time column (trends)
                <select className={`${smallSelect} mt-1`} value={timeColumn} onChange={(e) => setTimeColumn(e.target.value)}>
                  <option value="">None</option>
                  {dateColumns.map((c) => <option key={c.name} value={c.name}>{c.name}</option>)}
                </select>
              </label>
              <label className="text-xs font-medium text-slate-600">
                Date format for ambiguous dates
                <select className={`${smallSelect} mt-1`} value={dayfirst ? "dmy" : "mdy"} onChange={(e) => setDayfirst(e.target.value === "dmy")}>
                  <option value="dmy">Day first (31/12/2024)</option>
                  <option value="mdy">Month first (12/31/2024)</option>
                </select>
              </label>
            </div>
            <div className="mt-4 overflow-x-auto rounded-xl ring-1 ring-slate-200">
              <table className="min-w-full text-xs">
                <caption className="sr-only">Column profile and analysis settings</caption>
                <thead className="bg-surface text-left text-slate-600">
                  <tr>
                    <th scope="col" className="px-2 py-2">
                      <label className="flex items-center gap-1.5 font-semibold">
                        <input type="checkbox" className="h-3.5 w-3.5 accent-[#176B87]"
                          checked={selected.length === columns.length}
                          ref={(el) => { if (el) el.indeterminate = selected.length > 0 && selected.length < columns.length; }}
                          onChange={(e) => setSettings((s) => Object.fromEntries(Object.entries(s).map(([k, v]) => [k, { ...v, selected: e.target.checked }])))}
                          aria-label="Select all columns" />
                        Analyse
                      </label>
                    </th>
                    <th scope="col" className="px-2 py-2 font-semibold">Column</th>
                    <th scope="col" className="px-2 py-2 font-semibold">Detected type</th>
                    <th scope="col" className="px-2 py-2 font-semibold">Missing</th>
                    <th scope="col" className="px-2 py-2 font-semibold">Unique</th>
                    <th scope="col" className="px-2 py-2 font-semibold">Examples</th>
                    <th scope="col" className="px-2 py-2 font-semibold">
                      <span className="inline-flex items-center gap-1">Expected type
                        <InfoTip label="Expected type">Declare the expected type to validate every value against it instead of relying on the detected type.</InfoTip>
                      </span>
                    </th>
                    <th scope="col" className="px-2 py-2 font-semibold">
                      <span className="inline-flex items-center gap-1">Valid range
                        <InfoTip label="Valid range">Documented limits for numeric columns. Values outside are reported as data-quality findings (high severity).</InfoTip>
                      </span>
                    </th>
                    <th scope="col" className="px-2 py-2 font-semibold">
                      <span className="inline-flex items-center gap-1">Key
                        <InfoTip label="Key columns" align="end">Rows sharing the same values in all key columns are reported as duplicate keys.</InfoTip>
                      </span>
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 bg-white">
                  {columns.map((c) => {
                    const s = settings[c.name];
                    if (!s) return null;
                    const numeric = c.inferred_type === "numeric" || c.inferred_type === "integer" || s.expected === "numeric";
                    return (
                      <tr key={c.name} className={s.selected ? "" : "bg-slate-50 text-slate-400"}>
                        <td className="px-2 py-1.5">
                          <input type="checkbox" className="h-3.5 w-3.5 accent-[#176B87]" checked={s.selected}
                            aria-label={`Analyse ${c.name}`} onChange={(e) => update(c.name, { selected: e.target.checked })} />
                        </td>
                        <th scope="row" className="whitespace-nowrap px-2 py-1.5 text-left font-semibold text-slate-800">{c.name}</th>
                        <td className="whitespace-nowrap px-2 py-1.5">
                          {TYPE_LABELS[c.inferred_type] ?? c.inferred_type}
                          {c.decimal_comma && <span className="ms-1 rounded bg-amber-50 px-1 text-[10px] text-amber-800">decimal comma</span>}
                        </td>
                        <td className="whitespace-nowrap px-2 py-1.5">{c.missing.toLocaleString()} ({formatPct(c.missing_pct)})</td>
                        <td className="px-2 py-1.5">{c.unique.toLocaleString()}</td>
                        <td className="max-w-[12rem] truncate px-2 py-1.5 text-slate-500" title={c.samples.join(" · ")}>{c.samples.join(" · ") || "—"}</td>
                        <td className="px-2 py-1.5">
                          <select className={smallSelect} value={s.expected} aria-label={`Expected type of ${c.name}`}
                            onChange={(e) => update(c.name, { expected: e.target.value as ExpectedType | "" })}>
                            <option value="">Auto-detect</option>
                            <option value="numeric">Numeric</option>
                            <option value="date">Date</option>
                            <option value="text">Text</option>
                          </select>
                        </td>
                        <td className="px-2 py-1.5">
                          <div className="flex items-center gap-1">
                            <input className={`${smallSelect} !min-w-[4.5rem]`} inputMode="decimal" placeholder="min" value={s.min} disabled={!numeric}
                              aria-label={`Minimum valid value for ${c.name}`} onChange={(e) => update(c.name, { min: e.target.value })} />
                            <span aria-hidden>–</span>
                            <input className={`${smallSelect} !min-w-[4.5rem]`} inputMode="decimal" placeholder="max" value={s.max} disabled={!numeric}
                              aria-label={`Maximum valid value for ${c.name}`} onChange={(e) => update(c.name, { max: e.target.value })} />
                          </div>
                        </td>
                        <td className="px-2 py-1.5 text-center">
                          <input type="checkbox" className="h-3.5 w-3.5 accent-[#176B87]" checked={s.key}
                            aria-label={`Use ${c.name} as a key column`} onChange={(e) => update(c.name, { key: e.target.checked })} />
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </Panel>

          <Panel className={card}>
            <h2 className={sectionTitle}>4. Anomaly detection methods</h2>
            <p className="mb-3 mt-1 text-xs text-slate-500">
              Methods run only on suitable numeric columns (identifier, key and time columns are excluded). Unsuitable
              columns are skipped and the reason is reported.
            </p>
            <MethodsPanel value={methods} onChange={setMethods} hasTimeColumn={Boolean(timeColumn)} />
          </Panel>

          <Panel className={card}>
            <h2 className={sectionTitle}>5. Validation rules <span className="text-xs font-normal text-slate-500">(optional)</span></h2>
            <p className="mb-3 mt-1 text-xs text-slate-500">Rules you configure are reported as high-severity data-quality findings.</p>
            <RulesEditor columns={columns.map((c) => c.name)} rules={rules} onChange={setRules} />
          </Panel>

          <Panel className={card}>
            <h2 className={sectionTitle}><Wand2 className="h-4 w-4 text-primary" aria-hidden /> Optional cleaning preview</h2>
            <p className="mt-1 text-xs text-slate-500">
              Cleaning is never applied to the analysis. It produces a separate copy you can preview and download; the
              original data stays unchanged, so discarding the copy undoes it.
            </p>
            <div className="mt-3 grid gap-2 sm:grid-cols-2">
              {([
                ["trim_whitespace", "Trim leading and trailing spaces"],
                ["normalise_missing_tokens", "Replace NA / N/A / null placeholders with empty cells"],
                ["drop_exact_duplicates", "Remove exact duplicate rows (keep the first)"],
                ["drop_empty_columns", "Remove columns without any value"],
              ] as [keyof CleaningOptions, string][]).map(([key, label]) => (
                <label key={key} className="flex items-center gap-2 text-sm text-slate-700">
                  <input type="checkbox" className="h-4 w-4 accent-[#176B87]" checked={cleaning[key]}
                    onChange={(e) => { setCleaning((c) => ({ ...c, [key]: e.target.checked })); setCleaningPreview(null); }} />
                  {label}
                </label>
              ))}
            </div>
            <div className="mt-3 flex flex-wrap gap-2">
              <button type="button" onClick={runCleaningPreview} disabled={!anyCleaning || cleaningBusy || busy}
                className="inline-flex items-center gap-1.5 rounded-lg bg-primary/10 px-3 py-1.5 text-sm font-semibold text-primary hover:bg-primary/15 disabled:opacity-50">
                {cleaningBusy && <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden />} Preview changes
              </button>
              {cleaningPreview && (
                <button type="button" onClick={() => labvisionApi.downloadCleanedCopy(preview.dataset_id, cleaning).catch((e: Error) => setError(e.message))}
                  className="rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-sm font-semibold text-slate-700 hover:bg-slate-50">
                  Download cleaned copy (CSV)
                </button>
              )}
            </div>
            {cleaningPreview && (
              <div className="mt-3 rounded-xl bg-surface p-3 text-xs text-slate-600" aria-live="polite">
                <p>
                  Rows {cleaningPreview.rows_before.toLocaleString()} → <b>{cleaningPreview.rows_after.toLocaleString()}</b> ·
                  columns {cleaningPreview.columns_before} → <b>{cleaningPreview.columns_after}</b> ·
                  {" "}<b>{cleaningPreview.cells_changed.toLocaleString()}</b> cells changed
                </p>
                {cleaningPreview.removed_columns.length > 0 && <p className="mt-1">Removed columns: {cleaningPreview.removed_columns.join(", ")}</p>}
                {cleaningPreview.removed_rows.length > 0 && <p className="mt-1">Removed rows: {cleaningPreview.removed_rows.slice(0, 20).join(", ")}{cleaningPreview.removed_rows.length > 20 ? "…" : ""}</p>}
                {cleaningPreview.examples.length > 0 && (
                  <ul className="mt-2 space-y-0.5">
                    {cleaningPreview.examples.map((ex) => (
                      <li key={`${ex.row}-${ex.column}`}>Row {ex.row}, {ex.column}: “{ex.before}” → “{ex.after}”</li>
                    ))}
                  </ul>
                )}
                <p className="mt-2 text-slate-500">{cleaningPreview.note}</p>
              </div>
            )}
          </Panel>

          <div className="sticky bottom-0 z-10 -mx-1 flex flex-col gap-2 rounded-2xl bg-white/95 p-4 shadow-lg ring-1 ring-slate-200 backdrop-blur sm:flex-row sm:items-center sm:justify-between">
            <div className="text-xs text-slate-600">
              {built.problems.length ? (
                <ul className="space-y-0.5 text-red-700" role="alert">{built.problems.map((p) => <li key={p}>{p}</li>)}</ul>
              ) : (
                <span>{selected.length} of {columns.length} columns · {preview.row_count.toLocaleString()} rows will be analysed.</span>
              )}
            </div>
            <button
              type="button"
              onClick={analyze}
              disabled={busy || built.problems.length > 0}
              className="inline-flex items-center justify-center gap-1.5 rounded-xl bg-primary px-5 py-2.5 text-sm font-semibold text-white shadow-sm hover:bg-primary-dark focus:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 disabled:opacity-60"
            >
              {phase === "analyzing" ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : <Play className="h-4 w-4" aria-hidden />}
              {phase === "analyzing" ? "Analysing…" : "Run analysis"}
            </button>
          </div>
        </>
      )}
    </div>
  );
}
