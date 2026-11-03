export type ExpectedType = "numeric" | "date" | "text";
export type ReviewStatus = "pending" | "confirmed" | "expected" | "false_positive";
export type FindingCategory = "data_quality" | "statistical_outlier";
export type Severity = "high" | "medium" | "low";
export type InferredType = "numeric" | "integer" | "date" | "boolean" | "text" | "mixed" | "empty";

export interface MethodConfig {
  min_observations: number;
  iqr: { enabled: boolean; k: number };
  zscore: { enabled: boolean; threshold: number; variant: "standard" | "modified" };
  isolation_forest: {
    enabled: boolean;
    contamination: "auto" | number;
    n_estimators: number;
    random_state: number;
    min_rows: number;
  };
  time_series: { enabled: boolean; window: number; threshold: number; min_points: number };
}

export interface RangeRule {
  min?: number | null;
  max?: number | null;
}

export interface ValidationRule {
  type: "allowed_values" | "required" | "unique" | "no_future_dates";
  column: string;
  values?: string[];
  case_sensitive?: boolean;
}

export interface AnalyzeRequest {
  dataset_id: string;
  columns?: string[] | null;
  id_column?: string | null;
  key_columns?: string[];
  time_column?: string | null;
  expected_types?: Record<string, ExpectedType>;
  ranges?: Record<string, RangeRule>;
  rules?: ValidationRule[];
  date_dayfirst?: boolean;
  methods?: MethodConfig;
}

export interface ColumnProfile {
  name: string;
  inferred_type: InferredType;
  non_missing: number;
  missing: number;
  missing_pct: number;
  unique: number;
  numeric_ratio: number;
  date_ratio: number;
  decimal_comma: boolean;
  samples: string[];
  analysed?: boolean;
}

export interface DatasetLimits {
  max_upload_mb: number;
  max_rows: number;
  max_columns: number;
  dataset_ttl_minutes: number;
  retention_days: number;
}

export interface QualityScoreDoc {
  formula: string;
  weights: Record<string, number>;
  definitions: Record<string, string>;
  excluded: string;
}

export interface LabVisionConfig {
  limits: DatasetLimits;
  defaults: MethodConfig;
  missing_tokens: string[];
  quality_score: QualityScoreDoc;
  llm_model: string | null;
}

export interface DatasetPreview {
  dataset_id: string;
  name: string;
  file_type: "csv" | "xlsx" | "xls";
  size_bytes: number;
  sheet_name: string | null;
  sheets: string[];
  encoding: string | null;
  delimiter: string | null;
  row_count: number;
  column_count: number;
  columns: ColumnProfile[];
  preview_rows: string[][];
  warnings: string[];
  expires_at: string;
}

export interface AnalysisSummary {
  id: number;
  created_at: string;
  expires_at: string;
  dataset_name: string;
  file_type: string;
  sheet_name: string | null;
  row_count: number;
  column_count: number;
  quality_score: number | null;
  finding_count: number;
}

export interface Metrics {
  rows: number;
  columns_total: number;
  columns_analyzed: number;
  cells_analyzed: number;
  missing_cells: number;
  missing_pct: number;
  present_cells: number;
  invalid_cells: number;
  invalid_pct: number;
  rows_with_missing: number;
  complete_rows: number;
  duplicate_rows: number;
  duplicate_row_groups: number;
  duplicate_key_rows: number;
  duplicate_rows_total: number;
  key_columns: string[];
  empty_columns: string[];
  constant_columns: string[];
  anomalies_flagged: number;
  anomalous_rows: number;
  data_quality_findings: number;
  statistical_findings: number;
}

export interface QualityScore extends QualityScoreDoc {
  value: number | null;
  components: Partial<Record<"completeness" | "validity" | "uniqueness", number>>;
}

export interface MethodReport {
  method: string;
  label: string;
  status: "applied" | "skipped" | "disabled";
  parameters: Record<string, unknown>;
  columns_applied: string[];
  columns_skipped: { column: string; reason: string }[];
  flagged: number;
  notes: string[];
  assumptions: string[];
}

export interface IssueCount {
  issue_type: string;
  label: string;
  count: number;
  category: FindingCategory;
}

export interface HistogramBin {
  start: number;
  end: number;
  count: number;
  flagged: number;
  /** Values beyond Q1 − 3·IQR ("low") or Q3 + 3·IQR ("high"), grouped so they do not squash the chart. */
  tail?: "low" | "high" | null;
}

export interface Distribution {
  column: string;
  stats: { count: number; mean?: number | null; std?: number | null; min?: number | null; q1?: number | null; median?: number | null; q3?: number | null; max?: number | null };
  bins: HistogramBin[];
  fences: { low: number; high: number; q1: number; q3: number; k: number } | null;
  flagged: number;
}

export interface ScatterData {
  columns: string[];
  points: { row: number; values: (number | null)[]; methods: string[] }[];
  sampled: boolean;
  total_rows: number;
}

export interface TrendSeries {
  column: string;
  points: { t: string; v: number | null; flagged: boolean; n?: number }[];
  aggregated: boolean;
}

export interface CorrelationData {
  columns: string[];
  matrix: (number | null)[][];
  pairs: number[][];
  method: string;
  min_pairs: number;
}

export interface Charts {
  missing_by_column: { column: string; missing: number; missing_pct: number }[];
  missing_by_row: { missing_cells: number; rows: number }[];
  issue_counts: IssueCount[];
  distributions: Distribution[];
  scatter: ScatterData | null;
  time_series: { time_column: string; series: TrendSeries[] } | null;
  correlation: CorrelationData | null;
}

export interface Recommendation {
  id: string;
  severity: Severity;
  title: string;
  reason: string;
  action: string;
  trigger: { issue_type: string; label: string; count: number; columns: string[] };
}

export interface AnalysisResults {
  version: number;
  columns: ColumnProfile[];
  analysed_columns: string[];
  numeric_columns: string[];
  metrics: Metrics;
  quality_score: QualityScore;
  methods: MethodReport[];
  charts: Charts;
  recommendations: Recommendation[];
  limitations: string[];
  notes: string[];
  findings_total: number;
  findings_stored: number;
  truncated: boolean;
  safety_notice: string;
  dataset?: { encoding: string | null; delimiter: string | null; warnings: string[] };
}

export interface Explanation {
  text: string;
  model: string;
  generated_at: string;
  language: string;
}

export interface Analysis extends AnalysisSummary {
  size_bytes: number;
  sha256: string;
  config: Omit<AnalyzeRequest, "dataset_id">;
  results: AnalysisResults;
  explanation: Explanation | null;
  review_counts: Record<ReviewStatus, number>;
}

export interface Finding {
  id: number;
  analysis_id: number;
  category: FindingCategory;
  issue_type: string;
  method: string;
  severity: Severity;
  column: string | null;
  row_numbers: number[];
  affected_count: number;
  record_id: string | null;
  observed_value: string | null;
  score: number | null;
  threshold: string | null;
  explanation: string;
  suggested_action: string;
  review_status: ReviewStatus;
  review_note: string | null;
  reviewed_by: number | null;
  reviewer_name: string | null;
  reviewed_at: string | null;
}

export interface FindingPage {
  total: number;
  items: Finding[];
  facets: { column?: string[]; issue_type?: string[]; method?: string[] };
}

export interface FindingFilters {
  column?: string;
  category?: FindingCategory | "";
  issue_type?: string;
  method?: string;
  severity?: Severity | "";
  review_status?: ReviewStatus | "";
  q?: string;
}

export interface CleaningOptions {
  trim_whitespace: boolean;
  normalise_missing_tokens: boolean;
  drop_exact_duplicates: boolean;
  drop_empty_columns: boolean;
}

export interface CleaningPreview {
  operations: string[];
  rows_before: number;
  rows_after: number;
  columns_before: number;
  columns_after: number;
  cells_changed: number;
  removed_rows: number[];
  removed_columns: string[];
  examples: { row: number; column: string; before: string; after: string }[];
  note: string;
}
