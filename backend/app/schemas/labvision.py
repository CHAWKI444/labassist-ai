from datetime import datetime
from typing import Any, Literal

from pydantic import BaseModel, Field, model_validator

ExpectedType = Literal["numeric", "date", "text"]
ReviewStatusName = Literal["pending", "confirmed", "expected", "false_positive"]
CategoryName = Literal["data_quality", "statistical_outlier"]
SeverityName = Literal["high", "medium", "low"]
ColumnName = Field(min_length=1, max_length=255)


class IqrParams(BaseModel):
    enabled: bool = True
    k: float = Field(default=1.5, ge=0.5, le=10, description="Fence multiplier: Q1 - k*IQR, Q3 + k*IQR")


class ZScoreParams(BaseModel):
    enabled: bool = True
    threshold: float = Field(default=3.0, ge=1.0, le=10)
    variant: Literal["standard", "modified"] = "standard"


class IsolationForestParams(BaseModel):
    enabled: bool = True
    contamination: Literal["auto"] | float = Field(
        default=0.01, description="Expected share of anomalous rows, or 'auto' for the original paper's threshold"
    )
    n_estimators: int = Field(default=200, ge=50, le=500)
    random_state: int = Field(default=42, ge=0, le=2**31 - 1)
    min_rows: int = Field(default=30, ge=10, le=10_000)

    @model_validator(mode="after")
    def _check_contamination(self):
        if self.contamination != "auto" and not 0 < float(self.contamination) <= 0.5:
            raise ValueError("contamination must be 'auto' or a number in (0, 0.5]")
        return self


class TimeSeriesParams(BaseModel):
    enabled: bool = False
    window: int = Field(default=7, ge=3, le=101)
    threshold: float = Field(default=3.5, ge=1.0, le=10)
    min_points: int = Field(default=20, ge=10, le=10_000)


class MethodConfig(BaseModel):
    min_observations: int = Field(default=10, ge=5, le=10_000)
    iqr: IqrParams = IqrParams()
    zscore: ZScoreParams = ZScoreParams()
    isolation_forest: IsolationForestParams = IsolationForestParams()
    time_series: TimeSeriesParams = TimeSeriesParams()


class RangeRule(BaseModel):
    min: float | None = None
    max: float | None = None

    @model_validator(mode="after")
    def _check(self):
        if self.min is None and self.max is None:
            raise ValueError("a range needs a minimum, a maximum or both")
        if self.min is not None and self.max is not None and self.min > self.max:
            raise ValueError("range minimum is greater than its maximum")
        return self


class ValidationRule(BaseModel):
    type: Literal["allowed_values", "required", "unique", "no_future_dates"]
    column: str = ColumnName
    values: list[str] = Field(default_factory=list, max_length=500)
    case_sensitive: bool = False

    @model_validator(mode="after")
    def _check(self):
        if self.type == "allowed_values" and not [v for v in self.values if v.strip()]:
            raise ValueError("an allowed-values rule needs at least one value")
        return self


class AnalyzeRequest(BaseModel):
    dataset_id: str = Field(min_length=8, max_length=64, pattern=r"^[A-Za-z0-9_-]+$")
    columns: list[str] | None = Field(default=None, max_length=500, description="Columns to analyse; all when omitted")
    id_column: str | None = Field(default=None, max_length=255)
    key_columns: list[str] = Field(default_factory=list, max_length=10)
    time_column: str | None = Field(default=None, max_length=255)
    expected_types: dict[str, ExpectedType] = Field(default_factory=dict)
    ranges: dict[str, RangeRule] = Field(default_factory=dict)
    rules: list[ValidationRule] = Field(default_factory=list, max_length=100)
    date_dayfirst: bool = True
    methods: MethodConfig = MethodConfig()


class ColumnProfileOut(BaseModel):
    name: str
    inferred_type: str
    non_missing: int
    missing: int
    missing_pct: float
    unique: int
    numeric_ratio: float
    date_ratio: float
    decimal_comma: bool = False
    samples: list[str] = []


class DatasetLimits(BaseModel):
    max_upload_mb: int
    max_rows: int
    max_columns: int
    dataset_ttl_minutes: int
    retention_days: int


class DatasetPreview(BaseModel):
    dataset_id: str
    name: str
    file_type: str
    size_bytes: int
    sheet_name: str | None
    sheets: list[str]
    encoding: str | None
    delimiter: str | None
    row_count: int
    column_count: int
    columns: list[ColumnProfileOut]
    preview_rows: list[list[str]]
    warnings: list[str]
    expires_at: datetime


class LabVisionConfig(BaseModel):
    limits: DatasetLimits
    defaults: MethodConfig
    missing_tokens: list[str]
    quality_score: dict[str, Any]
    llm_model: str | None


class AnalysisSummary(BaseModel):
    id: int
    created_at: datetime
    expires_at: datetime
    dataset_name: str
    file_type: str
    sheet_name: str | None
    row_count: int
    column_count: int
    quality_score: float | None
    finding_count: int


class AnalysisOut(AnalysisSummary):
    size_bytes: int
    sha256: str
    config: dict[str, Any]
    results: dict[str, Any]
    explanation: dict[str, Any] | None
    review_counts: dict[str, int]


class FindingOut(BaseModel):
    id: int
    analysis_id: int
    category: CategoryName
    issue_type: str
    method: str
    severity: SeverityName
    column: str | None
    row_numbers: list[int]
    affected_count: int
    record_id: str | None
    observed_value: str | None
    score: float | None
    threshold: str | None
    explanation: str
    suggested_action: str
    review_status: ReviewStatusName
    review_note: str | None
    reviewed_by: int | None
    reviewer_name: str | None = None
    reviewed_at: datetime | None


class FindingPage(BaseModel):
    total: int
    items: list[FindingOut]
    facets: dict[str, list[str]]


class ReviewUpdate(BaseModel):
    status: ReviewStatusName
    note: str | None = Field(default=None, max_length=500)


class CleaningRequest(BaseModel):
    trim_whitespace: bool = False
    normalise_missing_tokens: bool = False
    drop_exact_duplicates: bool = False
    drop_empty_columns: bool = False


class CleaningPreview(BaseModel):
    operations: list[str]
    rows_before: int
    rows_after: int
    columns_before: int
    columns_after: int
    cells_changed: int
    removed_rows: list[int]
    removed_columns: list[str]
    examples: list[dict[str, Any]]
    note: str
