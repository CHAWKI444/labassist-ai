"""Column profiling and type interpretation. Pure functions; the source frame is never modified."""

import re
from dataclasses import dataclass, field

import numpy as np
import pandas as pd

# Compared after trimming and lower-casing. "ND" / "not detected" is deliberately absent: it is a result.
MISSING_TOKENS = ("", "na", "n/a", "nan", "null", "none", "#n/a")
BOOLEAN_TOKENS = {"true", "false", "yes", "no", "oui", "non", "vrai", "faux"}
TYPE_THRESHOLD = 0.8  # share of present values that must parse for a column to be numeric/date
MIXED_THRESHOLD = 0.2

DECIMAL_COMMA = re.compile(r"^[+-]?\d+,\d+$")
DOT_DECIMAL = re.compile(r"^[+-]?\d*\.\d+$")
CENSORED = re.compile(r"^[<>]=?\s*[+-]?\d+([.,]\d+)?$")
NUMBER_WITH_UNIT = re.compile(r"^[+-]?\d+([.,]\d+)?\s*[^\d\s.,+-][^\d]*$")
SPREADSHEET_ERROR = re.compile(r"^#(DIV/0!|N/A|VALUE!|REF!|NAME\?|NUM!|NULL!|SPILL!|CALC!)$", re.IGNORECASE)
DATE_LIKE = re.compile(
    r"^\d{1,4}[-/.]\d{1,2}[-/.]\d{1,4}([ T]\d{1,2}:\d{2}(:\d{2}(\.\d+)?)?)?(Z|[+-]\d{2}:?\d{2})?$"
)


@dataclass
class ColumnProfile:
    name: str
    inferred_type: str  # numeric | integer | date | boolean | text | mixed | empty
    non_missing: int
    missing: int
    missing_pct: float
    unique: int
    numeric_ratio: float
    date_ratio: float
    decimal_comma: bool = False
    samples: list[str] = field(default_factory=list)

    @property
    def is_numeric(self) -> bool:
        return self.inferred_type in ("numeric", "integer")


def missing_mask(values: pd.Series) -> pd.Series:
    return values.str.strip().str.lower().isin(MISSING_TOKENS)


def uses_decimal_comma(present: pd.Series) -> bool:
    """A column written with decimal commas (common in French exports) is read as numbers, and reported."""
    if present.empty:
        return False
    comma = present.str.match(DECIMAL_COMMA)
    return bool(comma.any()) and not bool(present.str.match(DOT_DECIMAL).any()) and comma.mean() >= 0.05


def to_numeric(values: pd.Series, decimal_comma: bool) -> pd.Series:
    """Float series aligned with `values`; NaN where missing or not a finite number."""
    text = values.str.strip()
    if decimal_comma:
        text = text.str.replace(",", ".", regex=False)
    numbers = pd.to_numeric(text, errors="coerce").astype("float64")
    return numbers.where(np.isfinite(numbers))


def to_datetime(values: pd.Series, dayfirst: bool) -> pd.Series:
    """Datetime series (UTC-naive) aligned with `values`; NaT where missing or unparseable.

    ISO 8601 is tried first, then the remaining values with `dayfirst` (DD/MM/YYYY when true)."""
    text = values.str.strip()
    plausible = text.str.match(DATE_LIKE)
    # Microsecond resolution covers years 1-9999 (nanoseconds overflow after 2262).
    result = pd.Series(pd.NaT, index=values.index, dtype="datetime64[us]")
    if not plausible.any():
        return result
    candidates = text[plausible]
    parsed = pd.to_datetime(candidates, errors="coerce", format="ISO8601", utc=True)
    rest = parsed.isna()
    if rest.any():
        parsed[rest] = pd.to_datetime(candidates[rest], errors="coerce", format="mixed", dayfirst=dayfirst, utc=True)
    result[plausible] = parsed.dt.tz_convert(None).astype("datetime64[us]")
    return result


def describe_unparseable(value: str) -> str:
    """Human explanation of why a present value is not a valid number."""
    text = value.strip()
    if SPREADSHEET_ERROR.match(text):
        return "is a spreadsheet error code, not a measured value"
    if CENSORED.match(text):
        return "is reported relative to a limit (censored value such as a detection limit), not as a number"
    if DECIMAL_COMMA.match(text):
        return "uses a decimal comma while the column uses decimal points"
    if NUMBER_WITH_UNIT.match(text):
        return "contains a unit or text next to the number"
    return "cannot be read as a number"


def profile_column(name: str, values: pd.Series, dayfirst: bool, declared: str | None = None) -> ColumnProfile:
    missing = missing_mask(values)
    present = values[~missing].str.strip()
    n_present = int(len(present))
    total = int(len(values))
    decimal_comma = uses_decimal_comma(present)
    numeric_ratio = float(to_numeric(present, decimal_comma).notna().mean()) if n_present else 0.0
    date_ratio = float(to_datetime(present, dayfirst).notna().mean()) if n_present and numeric_ratio < 1 else 0.0

    if declared == "numeric":
        inferred = "numeric"
    elif declared == "date":
        inferred = "date"
    elif declared == "text":
        inferred = "text"
    elif n_present == 0:
        inferred = "empty"
    elif numeric_ratio >= TYPE_THRESHOLD:
        inferred = "numeric"
    elif date_ratio >= TYPE_THRESHOLD:
        inferred = "date"
    elif present.str.lower().isin(BOOLEAN_TOKENS).all():
        inferred = "boolean"
    elif numeric_ratio >= MIXED_THRESHOLD:
        inferred = "mixed"
    else:
        inferred = "text"
    if inferred == "numeric":
        numbers = to_numeric(present, decimal_comma).dropna()
        if len(numbers) and bool((numbers == numbers.round()).all()) and declared is None:
            inferred = "integer"

    samples = [s[:60] for s in present.drop_duplicates().head(5).tolist()]
    return ColumnProfile(
        name=name,
        inferred_type=inferred,
        non_missing=n_present,
        missing=total - n_present,
        missing_pct=round(100 * (total - n_present) / total, 2) if total else 0.0,
        unique=int(present.nunique()),
        numeric_ratio=round(numeric_ratio, 4),
        date_ratio=round(date_ratio, 4),
        decimal_comma=decimal_comma and inferred in ("numeric", "integer"),
        samples=samples,
    )


def profile_frame(frame: pd.DataFrame, dayfirst: bool = True, declared: dict[str, str] | None = None) -> list[ColumnProfile]:
    declared = declared or {}
    return [profile_column(c, frame[c], dayfirst, declared.get(c)) for c in frame.columns]
