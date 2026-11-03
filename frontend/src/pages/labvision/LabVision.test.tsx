import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { cloneElement, type ReactElement } from "react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ToastProvider } from "../../hooks/useToast";
import type { Analysis, AnalysisSummary, DatasetPreview, Finding, FindingPage, LabVisionConfig } from "../../types/labvision";

const api = vi.hoisted(() => ({
  config: vi.fn(),
  history: vi.fn(),
  get: vi.fn(),
  preview: vi.fn(),
  analyze: vi.fn(),
  findings: vi.fn(),
  review: vi.fn(),
  exportFindings: vi.fn(),
  discardDataset: vi.fn(),
  remove: vi.fn(),
  downloadReport: vi.fn(),
  explain: vi.fn(),
  cleaningPreview: vi.fn(),
  downloadCleanedCopy: vi.fn(),
}));
vi.mock("../../services/endpoints", () => ({ labvisionApi: api }));
vi.mock("recharts", async (importOriginal) => {
  const actual = await importOriginal<typeof import("recharts")>();
  return {
    ...actual,
    ResponsiveContainer: ({ children }: { children: ReactElement }) =>
      cloneElement(children as ReactElement<{ width: number; height: number }>, { width: 640, height: 280 }),
  };
});

const { LabVisionLayout } = await import("../../components/labvision/LabVisionLayout");
const { LabVisionOverviewPage } = await import("./OverviewPage");
const { LabVisionImportPage, validateFile } = await import("./ImportPage");
const { LabVisionAnomaliesPage } = await import("./AnomaliesPage");
const { LabVisionTrendsPage } = await import("./TrendsPage");

const config: LabVisionConfig = {
  limits: { max_upload_mb: 1, max_rows: 1000, max_columns: 50, dataset_ttl_minutes: 30, retention_days: 30 },
  defaults: {
    min_observations: 10,
    iqr: { enabled: true, k: 1.5 },
    zscore: { enabled: true, threshold: 3, variant: "standard" },
    isolation_forest: { enabled: true, contamination: 0.01, n_estimators: 200, random_state: 42, min_rows: 30 },
    time_series: { enabled: false, window: 7, threshold: 3.5, min_points: 20 },
  },
  missing_tokens: ["na", "n/a"],
  quality_score: { formula: "score = 100 x (...)", weights: { completeness: 0.4, validity: 0.4, uniqueness: 0.2 }, definitions: { completeness: "1 - missing / cells" }, excluded: "Outliers excluded." },
  llm_model: "test-llm",
};

const summary: AnalysisSummary = {
  id: 7,
  created_at: "2026-10-25T10:00:00Z",
  expires_at: "2026-11-24T10:00:00Z",
  dataset_name: "glucose.csv",
  file_type: "csv",
  sheet_name: null,
  row_count: 1234,
  column_count: 4,
  quality_score: 91.5,
  finding_count: 3,
};

function analysis(overrides: Partial<Analysis["results"]> = {}): Analysis {
  return {
    ...summary,
    size_bytes: 2048,
    sha256: "a".repeat(64),
    config: {},
    explanation: null,
    review_counts: { pending: 2, confirmed: 1, expected: 0, false_positive: 0 },
    results: {
      version: 1,
      columns: [{ name: "glucose", inferred_type: "numeric", non_missing: 1200, missing: 34, missing_pct: 2.76, unique: 400, numeric_ratio: 1, date_ratio: 0, decimal_comma: false, samples: ["5.1"], analysed: true }],
      analysed_columns: ["glucose"],
      numeric_columns: ["glucose"],
      metrics: {
        rows: 1234, columns_total: 4, columns_analyzed: 4, cells_analyzed: 4936, missing_cells: 34, missing_pct: 0.69,
        present_cells: 4902, invalid_cells: 2, invalid_pct: 0.04, rows_with_missing: 30, complete_rows: 1204,
        duplicate_rows: 5, duplicate_row_groups: 5, duplicate_key_rows: 2, duplicate_rows_total: 7, key_columns: ["sample_id"],
        empty_columns: [], constant_columns: [], anomalies_flagged: 12, anomalous_rows: 11, data_quality_findings: 9, statistical_findings: 12,
      },
      quality_score: { ...config.quality_score, value: 91.5, components: { completeness: 99.3, validity: 99.9, uniqueness: 99.4 } },
      methods: [],
      charts: {
        missing_by_column: [{ column: "glucose", missing: 34, missing_pct: 2.76 }],
        missing_by_row: [{ missing_cells: 0, rows: 1204 }],
        issue_counts: [{ issue_type: "iqr_outlier", label: "IQR outlier", count: 12, category: "statistical_outlier" }],
        distributions: [{ column: "glucose", stats: { count: 1200, mean: 5 }, bins: [{ start: 4, end: 5, count: 600, flagged: 0 }, { start: 5, end: 9, count: 600, flagged: 12 }], fences: null, flagged: 12 }],
        scatter: null,
        time_series: null,
        correlation: null,
      },
      recommendations: [{ id: "R-MISSING", severity: "low", title: "Check the source of missing values", reason: "1 column", action: "Check the export", trigger: { issue_type: "missing_values", label: "Missing values", count: 1, columns: ["glucose"] } }],
      limitations: [],
      notes: [],
      findings_total: 3,
      findings_stored: 3,
      truncated: false,
      safety_notice: "LabVision flags observations for qualified human review.",
      ...overrides,
    },
  };
}

const finding = (overrides: Partial<Finding> = {}): Finding => ({
  id: 101, analysis_id: 7, category: "statistical_outlier", issue_type: "iqr_outlier", method: "iqr", severity: "low",
  column: "glucose", row_numbers: [12], affected_count: 1, record_id: "S012", observed_value: "19.5", score: 4.2,
  threshold: "fences [3.9, 6.3]", explanation: "19.5 is above the upper fence 6.3.", suggested_action: "Verify the units.",
  review_status: "pending", review_note: null, reviewed_by: null, reviewer_name: null, reviewed_at: null, ...overrides,
});

function renderAt(path: string) {
  return render(
    <ToastProvider>
      <MemoryRouter initialEntries={[path]}>
        <Routes>
          <Route path="/labvision" element={<LabVisionLayout />}>
            <Route index element={<LabVisionOverviewPage />} />
            <Route path="import" element={<LabVisionImportPage />} />
            <Route path="anomalies" element={<LabVisionAnomaliesPage />} />
            <Route path="trends" element={<LabVisionTrendsPage />} />
          </Route>
        </Routes>
      </MemoryRouter>
    </ToastProvider>,
  );
}

const kpi = (label: string) => screen.getByText(label).closest("section") as HTMLElement;

beforeEach(() => {
  vi.clearAllMocks();
  sessionStorage.clear();
  api.config.mockResolvedValue(config);
  api.discardDataset.mockResolvedValue(undefined);
});

describe("LabVision overview", () => {
  it("shows a loading state, then KPI cards computed by the backend", async () => {
    let release: (v: AnalysisSummary[]) => void = () => {};
    api.history.mockReturnValue(new Promise<AnalysisSummary[]>((r) => (release = r)));
    api.get.mockResolvedValue(analysis());
    renderAt("/labvision");
    expect(screen.getByRole("status", { name: "Loading analysis" })).toBeInTheDocument();
    await act(async () => release([summary]));
    // Testing Library collapses the DOM's (narrow) no-break spaces, so compare against the same normalisation.
    const rows = (1234).toLocaleString().replace(/\s/g, " ");
    await waitFor(() => expect(within(kpi("Rows analysed")).getByText(rows)).toBeInTheDocument());
    expect(within(kpi("Missing values")).getByText("34")).toBeInTheDocument();
    expect(within(kpi("Duplicate rows")).getByText("7")).toBeInTheDocument();
    expect(within(kpi("Statistical anomalies")).getByText("12")).toBeInTheDocument();
    expect(within(kpi("Data quality score")).getByText("91.5")).toBeInTheDocument();
    expect(api.get).toHaveBeenCalledWith(7);

    fireEvent.focus(screen.getByRole("button", { name: "About Data quality score" }));
    expect(screen.getByRole("tooltip")).toHaveTextContent("score = 100 x (...)");
  });

  it("shows an empty state without fabricated numbers when nothing was analysed", async () => {
    api.history.mockResolvedValue([]);
    renderAt("/labvision");
    expect(await screen.findByText("No dataset analysed yet")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /Import a dataset/ })).toHaveAttribute("href", "/labvision/import");
    expect(screen.queryByText("Rows analysed")).not.toBeInTheDocument();
    expect(api.get).not.toHaveBeenCalled();
  });

  it("shows an error state and retries", async () => {
    api.history.mockRejectedValueOnce(new Error("Cannot reach the LabAssist server. Is the backend running?"));
    api.history.mockResolvedValueOnce([]);
    renderAt("/labvision");
    expect(await screen.findByText("Cannot reach the LabAssist server. Is the backend running?")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Retry" }));
    expect(await screen.findByText("No dataset analysed yet")).toBeInTheDocument();
  });
});

describe("LabVision import", () => {
  const preview: DatasetPreview = {
    dataset_id: "abc123abc123abc123abc123", name: "glucose.csv", file_type: "csv", size_bytes: 40, sheet_name: null, sheets: [],
    encoding: "utf-8", delimiter: ",", row_count: 2, column_count: 2, warnings: ["Duplicate header renamed."], expires_at: "2026-10-25T11:00:00Z",
    columns: [
      { name: "sample_id", inferred_type: "text", non_missing: 2, missing: 0, missing_pct: 0, unique: 2, numeric_ratio: 0, date_ratio: 0, decimal_comma: false, samples: ["S1", "S2"] },
      { name: "glucose", inferred_type: "numeric", non_missing: 2, missing: 0, missing_pct: 0, unique: 2, numeric_ratio: 1, date_ratio: 0, decimal_comma: false, samples: ["5.1", "6.2"] },
    ],
    preview_rows: [["S1", "5.1"], ["S2", "6.2"]],
  };

  it("validates extension and size before uploading", () => {
    expect(validateFile(new File(["x"], "data.exe"), 1)).toMatch(/Only CSV, XLSX and XLS/);
    expect(validateFile(new File([], "data.csv"), 1)).toMatch(/empty/);
    expect(validateFile(new File([new Uint8Array(2 * 1024 * 1024)], "data.xlsx"), 1)).toMatch(/limit is 1 MB/);
    expect(validateFile(new File(["a,b"], "DATA.CSV"), 1)).toBeNull();
  });

  it("rejects an unsupported file without calling the server", async () => {
    api.history.mockResolvedValue([]);
    renderAt("/labvision/import");
    fireEvent.change(await screen.findByLabelText("Choose a CSV or Excel file"), { target: { files: [new File(["x"], "notes.pdf")] } });
    expect(await screen.findByRole("alert")).toHaveTextContent("Only CSV, XLSX and XLS files are accepted.");
    expect(api.preview).not.toHaveBeenCalled();
  });

  it("uploads, previews, configures and runs an analysis", async () => {
    api.history.mockResolvedValue([]);
    api.preview.mockImplementation(async (_file: File, _sheet: string | null, onProgress?: (f: number) => void) => {
      onProgress?.(0.5);
      return preview;
    });
    api.analyze.mockResolvedValue(analysis());
    api.get.mockResolvedValue(analysis());
    renderAt("/labvision/import");
    fireEvent.change(await screen.findByLabelText("Choose a CSV or Excel file"), { target: { files: [new File(["sample_id,glucose\nS1,5.1"], "glucose.csv")] } });

    expect(await screen.findByText("Duplicate header renamed.")).toBeInTheDocument();
    expect(screen.getByRole("table", { name: "First 2 data rows" })).toHaveTextContent("6.2");
    fireEvent.change(screen.getByLabelText("Minimum valid value for glucose"), { target: { value: "8" } });
    fireEvent.change(screen.getByLabelText("Maximum valid value for glucose"), { target: { value: "2" } });
    expect(screen.getByText("The minimum of “glucose” is greater than its maximum.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Run analysis" })).toBeDisabled();

    fireEvent.change(screen.getByLabelText("Minimum valid value for glucose"), { target: { value: "0,5" } });
    fireEvent.click(screen.getByLabelText("Use sample_id as a key column"));
    fireEvent.change(screen.getByLabelText("Row identifier column"), { target: { value: "sample_id" } });
    fireEvent.click(screen.getByRole("button", { name: "Run analysis" }));

    await waitFor(() => expect(api.analyze).toHaveBeenCalledTimes(1));
    expect(api.analyze.mock.calls[0][0]).toMatchObject({
      dataset_id: preview.dataset_id,
      columns: ["sample_id", "glucose"],
      id_column: "sample_id",
      key_columns: ["sample_id"],
      ranges: { glucose: { min: 0.5, max: 2 } },
      methods: { isolation_forest: { random_state: 42 } },
    });
    expect(await screen.findByText("Rows analysed")).toBeInTheDocument();
  });

  it("shows server-side validation errors", async () => {
    api.history.mockResolvedValue([]);
    api.preview.mockRejectedValue(new Error("Malformed CSV at line 4: a row has more fields than the header."));
    renderAt("/labvision/import");
    fireEvent.change(await screen.findByLabelText("Choose a CSV or Excel file"), { target: { files: [new File(["a"], "bad.csv")] } });
    expect(await screen.findByRole("alert")).toHaveTextContent("Malformed CSV at line 4");
  });
});

describe("LabVision anomaly explorer", () => {
  const page = (items: Finding[]): FindingPage => ({ total: items.length, items, facets: { column: ["glucose"], issue_type: ["iqr_outlier"], method: ["iqr"] } });

  it("lists, filters and records a human review without altering the finding", async () => {
    api.history.mockResolvedValue([summary]);
    api.get.mockResolvedValue(analysis());
    api.findings.mockResolvedValue(page([finding()]));
    api.review.mockResolvedValue(finding({ review_status: "expected", review_note: "Known patient", reviewed_by: 2, reviewer_name: "Staff", reviewed_at: "2026-10-25T10:05:00Z" }));
    renderAt("/labvision/anomalies");

    const table = await screen.findByRole("table", { name: "Findings of analysis #7" });
    expect(within(table).getByText("19.5")).toBeInTheDocument();
    expect(within(table).getByText("Pending review")).toBeInTheDocument();
    expect(within(table).getByText("Statistical outlier")).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText("Review status"), { target: { value: "pending" } });
    await waitFor(() => expect(api.findings).toHaveBeenLastCalledWith(7, { review_status: "pending" }, 25, 0, expect.anything()));

    fireEvent.click(screen.getByRole("button", { name: "Review finding 101" }));
    const dialog = screen.getByRole("dialog");
    expect(within(dialog).getByText("Machine-generated finding (read-only)")).toBeInTheDocument();
    fireEvent.click(within(dialog).getByLabelText(/Expected observation/));
    fireEvent.change(within(dialog).getByRole("textbox"), { target: { value: "Known patient" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Save decision" }));

    await waitFor(() => expect(api.review).toHaveBeenCalledWith(101, "expected", "Known patient"));
    expect(await within(table).findByText("Expected observation")).toBeInTheDocument();
    expect(within(table).getByText("19.5")).toBeInTheDocument();
  });

  it("shows an empty state when filters match nothing", async () => {
    api.history.mockResolvedValue([summary]);
    api.get.mockResolvedValue(analysis());
    api.findings.mockResolvedValueOnce(page([finding()])).mockResolvedValue({ ...page([]), total: 0 });
    renderAt("/labvision/anomalies");
    await screen.findByRole("table", { name: "Findings of analysis #7" });
    fireEvent.change(screen.getByLabelText("Method"), { target: { value: "iqr" } });
    expect(await screen.findByText("No finding matches these filters")).toBeInTheDocument();
  });
});

describe("LabVision charts", () => {
  it("renders charts from real results and explains why others are not shown", async () => {
    api.history.mockResolvedValue([summary]);
    api.get.mockResolvedValue(analysis());
    const { container } = renderAt("/labvision/trends");
    expect(await screen.findByText("Value distribution")).toBeInTheDocument();
    await waitFor(() => expect(container.querySelectorAll(".recharts-surface").length).toBeGreaterThanOrEqual(2));
    expect(screen.getAllByText("Not shown for this dataset")).toHaveLength(3); // scatter, correlation, trend
  });
});
