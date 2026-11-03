from dataclasses import dataclass, field

from app.models.labvision import FindingCategory

MAX_ROWS_PER_FINDING = 200
MAX_VALUE_CHARS = 500

SEVERITY_ORDER = {"high": 0, "medium": 1, "low": 2}

# Labels shared by the API, reports and recommendations.
ISSUE_LABELS = {
    "missing_values": "Missing values",
    "incomplete_rows": "Mostly empty rows",
    "duplicate_rows": "Exact duplicate rows",
    "duplicate_keys": "Duplicate key values",
    "type_inconsistency": "Inconsistent data type",
    "numeric_parse_error": "Numeric parsing error",
    "invalid_date": "Invalid date",
    "empty_column": "Empty column",
    "constant_column": "Constant column",
    "out_of_range": "Outside valid range",
    "rule_violation": "Validation rule violation",
    "iqr_outlier": "IQR outlier",
    "zscore_outlier": "Z-score outlier",
    "multivariate_outlier": "Multivariate outlier",
    "time_series_deviation": "Time-series deviation",
}

METHOD_LABELS = {
    "completeness_check": "Completeness check",
    "duplicate_check": "Duplicate check",
    "type_check": "Type check",
    "structure_check": "Structure check",
    "range_check": "Range check",
    "rule_check": "Validation rule",
    "iqr": "IQR fences",
    "zscore": "Z-score",
    "modified_zscore": "Modified Z-score (MAD)",
    "isolation_forest": "Isolation Forest",
    "rolling_median": "Rolling median (time series)",
}

VERIFY_MEASUREMENT = (
    "Verify the units, transcription and measurement conditions, and compare with the applicable documented "
    "limits. An unusual value can be valid: mark it as an expected observation if it is confirmed."
)


@dataclass
class Finding:
    category: str
    issue_type: str
    method: str
    severity: str
    explanation: str
    suggested_action: str
    column: str | None = None
    row_numbers: list[int] = field(default_factory=list)
    affected_count: int = 0
    record_id: str | None = None
    observed_value: str | None = None
    score: float | None = None
    threshold: str | None = None

    def __post_init__(self):
        if not self.affected_count:
            self.affected_count = len(self.row_numbers)
        self.row_numbers = [int(r) for r in self.row_numbers[:MAX_ROWS_PER_FINDING]]
        if self.observed_value is not None:
            self.observed_value = self.observed_value[:MAX_VALUE_CHARS]

    @property
    def is_statistical(self) -> bool:
        return self.category == FindingCategory.STATISTICAL


def fmt(value: float | None, digits: int = 4) -> str:
    """Compact, locale-independent number formatting for explanations."""
    if value is None or value != value:
        return "n/a"
    return f"{value:.{digits}g}"


def rows_text(rows: list[int], limit: int = 5) -> str:
    shown = ", ".join(str(r) for r in rows[:limit])
    return shown + (f" (+{len(rows) - limit} more)" if len(rows) > limit else "")
