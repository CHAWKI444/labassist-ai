import { Plus, X } from "lucide-react";
import { useId, useState, type ReactNode } from "react";
import type { MethodConfig, ValidationRule } from "../../types/labvision";
import { InfoTip } from "../InfoTip";

export const DEFAULT_METHODS: MethodConfig = {
  min_observations: 10,
  iqr: { enabled: true, k: 1.5 },
  zscore: { enabled: true, threshold: 3, variant: "standard" },
  isolation_forest: { enabled: true, contamination: 0.01, n_estimators: 200, random_state: 42, min_rows: 30 },
  time_series: { enabled: false, window: 7, threshold: 3.5, min_points: 20 },
};

const inputClass =
  "w-full rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-sm text-slate-800 focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/20 disabled:bg-slate-50 disabled:text-slate-400";

function NumberField({
  label,
  value,
  onChange,
  min,
  max,
  step,
  disabled,
  hint,
}: {
  label: string;
  value: number;
  onChange: (v: number) => void;
  min: number;
  max: number;
  step: number;
  disabled?: boolean;
  hint?: string;
}) {
  const id = useId();
  const invalid = !Number.isFinite(value) || value < min || value > max;
  return (
    <div className="text-xs">
      <label htmlFor={id} className="mb-1 block font-medium text-slate-600">{label}</label>
      <input
        id={id}
        type="number"
        inputMode="decimal"
        value={Number.isFinite(value) ? value : ""}
        min={min}
        max={max}
        step={step}
        disabled={disabled}
        aria-invalid={invalid || undefined}
        onChange={(e) => onChange(e.target.value === "" ? Number.NaN : Number(e.target.value))}
        className={`${inputClass} ${invalid && !disabled ? "border-red-300" : ""}`}
      />
      <span className={`mt-0.5 block ${invalid && !disabled ? "text-red-600" : "text-slate-400"}`}>
        {invalid && !disabled ? `Between ${min} and ${max}` : hint}
      </span>
    </div>
  );
}

function MethodCard({
  title,
  enabled,
  onToggle,
  info,
  children,
}: {
  title: string;
  enabled: boolean;
  onToggle: (v: boolean) => void;
  info: ReactNode;
  children: ReactNode;
}) {
  const id = useId();
  return (
    <fieldset className={`rounded-xl border p-3 ${enabled ? "border-primary/30 bg-white" : "border-slate-200 bg-slate-50/60"}`}>
      <legend className="sr-only">{title}</legend>
      <div className="mb-2 flex items-center justify-between gap-2">
        <label htmlFor={id} className="flex items-center gap-2 text-sm font-semibold text-slate-800">
          <input id={id} type="checkbox" checked={enabled} onChange={(e) => onToggle(e.target.checked)}
            className="h-4 w-4 rounded border-slate-300 accent-[#176B87]" />
          {title}
        </label>
        <InfoTip label={title} align="end">{info}</InfoTip>
      </div>
      <div className="grid grid-cols-2 gap-2">{children}</div>
    </fieldset>
  );
}

export function methodsValid(m: MethodConfig): boolean {
  const inRange = (v: number, lo: number, hi: number) => Number.isFinite(v) && v >= lo && v <= hi;
  const contamination = m.isolation_forest.contamination;
  return (
    inRange(m.min_observations, 5, 10000) &&
    inRange(m.iqr.k, 0.5, 10) &&
    inRange(m.zscore.threshold, 1, 10) &&
    (contamination === "auto" || inRange(contamination, 0.001, 0.5)) &&
    inRange(m.isolation_forest.n_estimators, 50, 500) &&
    inRange(m.isolation_forest.random_state, 0, 2 ** 31 - 1) &&
    inRange(m.time_series.window, 3, 101) &&
    inRange(m.time_series.threshold, 1, 10)
  );
}

export function MethodsPanel({ value, onChange, hasTimeColumn }: { value: MethodConfig; onChange: (m: MethodConfig) => void; hasTimeColumn: boolean }) {
  const set = <K extends Exclude<keyof MethodConfig, "min_observations">>(key: K, patch: Partial<MethodConfig[K]>) =>
    onChange({ ...value, [key]: { ...value[key], ...patch } });
  const contamination = value.isolation_forest.contamination;
  return (
    <div className="space-y-3">
      <div className="grid gap-3 md:grid-cols-2">
        <MethodCard
          title="IQR fences"
          enabled={value.iqr.enabled}
          onToggle={(enabled) => set("iqr", { enabled })}
          info="Flags values below Q1 − k·IQR or above Q3 + k·IQR. Distribution-free and robust; skewed data produces more flags on the long tail."
        >
          <NumberField label="Multiplier k" value={value.iqr.k} min={0.5} max={10} step={0.1} disabled={!value.iqr.enabled}
            onChange={(k) => set("iqr", { k })} hint="1.5 = Tukey, 3 = far out" />
        </MethodCard>
        <MethodCard
          title="Z-score"
          enabled={value.zscore.enabled}
          onToggle={(enabled) => set("zscore", { enabled })}
          info="Standard: |x − mean| / SD; assumes roughly normal, independent values and can be masked by the outliers themselves. Modified: 0.6745·|x − median| / MAD, robust to outliers (3.5 recommended)."
        >
          <NumberField label="Threshold |z|" value={value.zscore.threshold} min={1} max={10} step={0.1} disabled={!value.zscore.enabled}
            onChange={(threshold) => set("zscore", { threshold })} />
          <div className="text-xs">
            <label className="mb-1 block font-medium text-slate-600" htmlFor="zscore-variant">Variant</label>
            <select id="zscore-variant" className={inputClass} value={value.zscore.variant} disabled={!value.zscore.enabled}
              onChange={(e) => {
                const variant = e.target.value as "standard" | "modified";
                const defaults = { standard: 3, modified: 3.5 };
                const previous = defaults[value.zscore.variant];
                set("zscore", { variant, ...(value.zscore.threshold === previous ? { threshold: defaults[variant] } : {}) });
              }}>
              <option value="standard">Standard (mean/SD)</option>
              <option value="modified">Modified (median/MAD)</option>
            </select>
          </div>
        </MethodCard>
        <MethodCard
          title="Isolation Forest"
          enabled={value.isolation_forest.enabled}
          onToggle={(enabled) => set("isolation_forest", { enabled })}
          info="Multivariate (≥ 2 numeric columns, ≥ 30 complete rows). A numeric contamination flags about that share of rows even in clean data; rows with missing values are excluded, never imputed. The seed makes results reproducible."
        >
          <div className="text-xs">
            <label className="mb-1 block font-medium text-slate-600" htmlFor="if-contamination">Contamination</label>
            <select id="if-contamination" className={inputClass} disabled={!value.isolation_forest.enabled}
              value={contamination === "auto" ? "auto" : String(contamination)}
              onChange={(e) => set("isolation_forest", { contamination: e.target.value === "auto" ? "auto" : Number(e.target.value) })}>
              {[0.005, 0.01, 0.02, 0.05, 0.1].map((c) => <option key={c} value={c}>{c * 100}% of rows</option>)}
              <option value="auto">auto (paper threshold)</option>
            </select>
          </div>
          <NumberField label="Random seed" value={value.isolation_forest.random_state} min={0} max={2 ** 31 - 1} step={1}
            disabled={!value.isolation_forest.enabled} onChange={(random_state) => set("isolation_forest", { random_state })} />
          <NumberField label="Trees" value={value.isolation_forest.n_estimators} min={50} max={500} step={10}
            disabled={!value.isolation_forest.enabled} onChange={(n_estimators) => set("isolation_forest", { n_estimators })} />
        </MethodCard>
        <MethodCard
          title="Time-series deviation"
          enabled={value.time_series.enabled}
          onToggle={(enabled) => set("time_series", { enabled })}
          info="Orders values by the time column and compares each one with the rolling median of its window, scaled by the robust spread of the residuals. Requires a valid date column and enough dated observations."
        >
          <NumberField label="Window (observations)" value={value.time_series.window} min={3} max={101} step={2}
            disabled={!value.time_series.enabled} onChange={(window) => set("time_series", { window })} />
          <NumberField label="Threshold |robust z|" value={value.time_series.threshold} min={1} max={10} step={0.1}
            disabled={!value.time_series.enabled} onChange={(threshold) => set("time_series", { threshold })} />
          {value.time_series.enabled && !hasTimeColumn && (
            <p className="col-span-2 text-xs text-amber-700">Select a time column above, otherwise this method is skipped.</p>
          )}
        </MethodCard>
      </div>
      <div className="max-w-xs">
        <NumberField label="Minimum observations per column" value={value.min_observations} min={5} max={10000} step={1}
          onChange={(min_observations) => onChange({ ...value, min_observations })}
          hint="Columns with fewer values are skipped by IQR and Z-score" />
      </div>
    </div>
  );
}

const RULE_LABELS: Record<ValidationRule["type"], string> = {
  allowed_values: "Allowed values",
  required: "Value required",
  unique: "Values must be unique",
  no_future_dates: "No future dates",
};

export function RulesEditor({ columns, rules, onChange }: { columns: string[]; rules: ValidationRule[]; onChange: (r: ValidationRule[]) => void }) {
  const [type, setType] = useState<ValidationRule["type"]>("allowed_values");
  const [column, setColumn] = useState(columns[0] ?? "");
  const [values, setValues] = useState("");
  const parsedValues = values.split(/[,;\n]/).map((v) => v.trim()).filter(Boolean);
  const canAdd = column && (type !== "allowed_values" || parsedValues.length > 0);
  const add = () => {
    if (!canAdd) return;
    onChange([...rules, { type, column, ...(type === "allowed_values" ? { values: parsedValues } : {}) }]);
    setValues("");
  };
  return (
    <div className="space-y-3">
      <div className="grid gap-2 sm:grid-cols-[1fr_1fr_2fr_auto] sm:items-end">
        <label className="text-xs font-medium text-slate-600">
          Rule
          <select className={`${inputClass} mt-1`} value={type} onChange={(e) => setType(e.target.value as ValidationRule["type"])}>
            {Object.entries(RULE_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
          </select>
        </label>
        <label className="text-xs font-medium text-slate-600">
          Column
          <select className={`${inputClass} mt-1`} value={column} onChange={(e) => setColumn(e.target.value)}>
            {columns.map((c) => <option key={c} value={c}>{c}</option>)}
          </select>
        </label>
        <label className="text-xs font-medium text-slate-600">
          Allowed values (comma-separated)
          <input className={`${inputClass} mt-1`} value={values} disabled={type !== "allowed_values"}
            placeholder={type === "allowed_values" ? "e.g. F, M" : "Not needed for this rule"}
            onChange={(e) => setValues(e.target.value)} onKeyDown={(e) => e.key === "Enter" && (e.preventDefault(), add())} />
        </label>
        <button type="button" onClick={add} disabled={!canAdd}
          className="inline-flex items-center justify-center gap-1 rounded-lg bg-primary/10 px-3 py-2 text-sm font-semibold text-primary hover:bg-primary/15 disabled:opacity-50">
          <Plus className="h-4 w-4" aria-hidden /> Add rule
        </button>
      </div>
      {rules.length > 0 && (
        <ul className="space-y-1.5" aria-label="Validation rules">
          {rules.map((r, i) => (
            <li key={`${r.type}-${r.column}-${i}`} className="flex items-center justify-between gap-2 rounded-lg bg-surface px-3 py-1.5 text-sm">
              <span className="min-w-0 truncate">
                <b>{RULE_LABELS[r.type]}</b> · {r.column}
                {r.values?.length ? <span className="text-slate-500"> — {r.values.join(", ")}</span> : null}
              </span>
              <button type="button" aria-label={`Remove rule ${RULE_LABELS[r.type]} on ${r.column}`}
                onClick={() => onChange(rules.filter((_, j) => j !== i))} className="rounded p-1 text-slate-400 hover:bg-white hover:text-red-600">
                <X className="h-4 w-4" aria-hidden />
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
