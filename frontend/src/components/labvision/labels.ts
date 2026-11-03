import type { FindingCategory, ReviewStatus, Severity } from "../../types/labvision";

export const COLORS = {
  primary: "#176B87",
  secondary: "#35B6A0",
  flagged: "#D9534F",
  amber: "#E3A33B",
  muted: "#94A3B8",
  grid: "#E2E8F0",
};

export const ISSUE_LABELS: Record<string, string> = {
  missing_values: "Missing values",
  incomplete_rows: "Mostly empty rows",
  duplicate_rows: "Exact duplicate rows",
  duplicate_keys: "Duplicate key values",
  type_inconsistency: "Inconsistent data type",
  numeric_parse_error: "Numeric parsing error",
  invalid_date: "Invalid date",
  empty_column: "Empty column",
  constant_column: "Constant column",
  out_of_range: "Outside valid range",
  rule_violation: "Validation rule violation",
  iqr_outlier: "IQR outlier",
  zscore_outlier: "Z-score outlier",
  multivariate_outlier: "Multivariate outlier",
  time_series_deviation: "Time-series deviation",
};

export const METHOD_LABELS: Record<string, string> = {
  completeness_check: "Completeness check",
  duplicate_check: "Duplicate check",
  type_check: "Type check",
  structure_check: "Structure check",
  range_check: "Range check",
  rule_check: "Validation rule",
  iqr: "IQR fences",
  zscore: "Z-score",
  modified_zscore: "Modified Z-score (MAD)",
  isolation_forest: "Isolation Forest",
  rolling_median: "Rolling median (time series)",
};

export const CATEGORY_META: Record<FindingCategory, { label: string; className: string }> = {
  data_quality: { label: "Data quality", className: "bg-primary/10 text-primary ring-primary/20" },
  statistical_outlier: { label: "Statistical outlier", className: "bg-secondary/15 text-[#1F7A6B] ring-secondary/30" },
};

export const SEVERITY_META: Record<Severity, { label: string; className: string }> = {
  high: { label: "High", className: "bg-red-50 text-red-700 ring-red-200" },
  medium: { label: "Medium", className: "bg-amber-50 text-amber-800 ring-amber-200" },
  low: { label: "Low", className: "bg-slate-100 text-slate-600 ring-slate-200" },
};

export const REVIEW_META: Record<ReviewStatus, { label: string; className: string; description: string }> = {
  pending: {
    label: "Pending review",
    className: "bg-sky-50 text-sky-800 ring-sky-200",
    description: "No human decision recorded yet.",
  },
  confirmed: {
    label: "Confirmed issue",
    className: "bg-red-50 text-red-700 ring-red-200",
    description: "A reviewer confirmed that the data has a problem.",
  },
  expected: {
    label: "Expected observation",
    className: "bg-emerald-50 text-emerald-800 ring-emerald-200",
    description: "The value is unusual but valid.",
  },
  false_positive: {
    label: "False positive",
    className: "bg-slate-100 text-slate-600 ring-slate-200",
    description: "The finding does not apply.",
  },
};

export const REVIEW_STATUSES = Object.keys(REVIEW_META) as ReviewStatus[];

export const TYPE_LABELS: Record<string, string> = {
  numeric: "Numeric",
  integer: "Integer",
  date: "Date",
  boolean: "Boolean",
  text: "Text",
  mixed: "Mixed",
  empty: "Empty",
};

export const issueLabel = (key: string) => ISSUE_LABELS[key] ?? key;
export const methodLabel = (key: string) => METHOD_LABELS[key] ?? key;

/** Locale-aware number formatting that never shows NaN/Infinity. */
export function formatNumber(value: number | null | undefined, digits = 2): string {
  if (value == null || !Number.isFinite(value)) return "—";
  const abs = Math.abs(value);
  if (abs !== 0 && (abs >= 1e6 || abs < 1e-3)) return value.toExponential(2);
  return value.toLocaleString(undefined, { maximumFractionDigits: digits });
}

export function formatPct(value: number | null | undefined, digits = 1): string {
  return value == null || !Number.isFinite(value) ? "—" : `${value.toLocaleString(undefined, { maximumFractionDigits: digits })}%`;
}

export function rowsLabel(rows: number[], affected: number, limit = 4): string {
  if (!rows.length) return affected ? `${affected.toLocaleString()} rows` : "—";
  const shown = rows.slice(0, limit).join(", ");
  const more = Math.max(affected, rows.length) - Math.min(rows.length, limit);
  return more > 0 ? `${shown} +${more.toLocaleString()}` : shown;
}
