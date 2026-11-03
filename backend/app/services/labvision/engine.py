"""Runs a complete LabVision analysis on a parsed dataset and returns structured, serialisable results."""

from dataclasses import asdict, dataclass

import pandas as pd

from app.models.labvision import FindingCategory
from app.schemas.labvision import AnalyzeRequest
from app.services.labvision.anomalies import candidate_columns, run_anomaly_detection
from app.services.labvision.charts import build_charts
from app.services.labvision.context import AnalysisContext
from app.services.labvision.findings import ISSUE_LABELS, SEVERITY_ORDER, Finding
from app.services.labvision.profiling import MISSING_TOKENS, TYPE_THRESHOLD, profile_column
from app.services.labvision.quality import run_quality_checks
from app.services.labvision.recommendations import SAFETY_NOTICE, build_recommendations

RESULTS_VERSION = 1
QUALITY_WEIGHTS = {"completeness": 0.4, "validity": 0.4, "uniqueness": 0.2}
QUALITY_SCORE_DOC = {
    "formula": "score = 100 x (0.4 x completeness + 0.4 x validity + 0.2 x uniqueness)",
    "weights": QUALITY_WEIGHTS,
    "definitions": {
        "completeness": "1 - missing cells / analysed cells",
        "validity": "1 - invalid cells / present cells (type or parsing errors, invalid dates, values outside a "
        "user-defined range, rule violations)",
        "uniqueness": "1 - rows that repeat an earlier row (exact duplicate or duplicate key) / rows",
    },
    "excluded": "Statistical outliers do not lower the score: an unusual value can be a valid observation.",
}
STATISTICAL_TYPES = ("iqr_outlier", "zscore_outlier", "multivariate_outlier", "time_series_deviation")


class AnalysisError(ValueError):
    """Invalid analysis request for this dataset. The message is safe to show to the user."""


@dataclass
class AnalysisOutput:
    findings: list[Finding]
    results: dict
    quality_score: float | None


def _check_columns(frame: pd.DataFrame, request: AnalyzeRequest) -> list[str]:
    known = set(frame.columns)
    referenced = list(request.columns or []) + list(request.key_columns) + list(request.expected_types)
    referenced += list(request.ranges) + [r.column for r in request.rules]
    referenced += [c for c in (request.id_column, request.time_column) if c]
    unknown = sorted({c for c in referenced if c not in known})
    if unknown:
        raise AnalysisError(f"Unknown column(s): {', '.join(unknown[:5])}")
    selected = set(request.columns) if request.columns is not None else known
    if not selected:
        raise AnalysisError("Select at least one column to analyse.")
    # Columns with an explicit range or rule are always analysed.
    selected |= set(request.ranges) | {r.column for r in request.rules} | set(request.key_columns)
    return [c for c in frame.columns if c in selected]


def quality_score(metrics: dict) -> dict:
    rows, cells, present = metrics["rows"], metrics["cells_analyzed"], metrics["present_cells"]
    if not rows or not cells:
        return {**QUALITY_SCORE_DOC, "value": None, "components": {}}
    components = {
        "completeness": 1 - metrics["missing_cells"] / cells,
        "validity": 1 - metrics["invalid_cells"] / present if present else 0.0,
        "uniqueness": 1 - metrics["duplicate_rows_total"] / rows,
    }
    value = 100 * sum(QUALITY_WEIGHTS[k] * v for k, v in components.items())
    return {**QUALITY_SCORE_DOC, "value": round(value, 1),
            "components": {k: round(100 * v, 1) for k, v in components.items()}}


def run_analysis(frame: pd.DataFrame, request: AnalyzeRequest, max_findings: int) -> AnalysisOutput:
    analysed = _check_columns(frame, request)
    if len(frame) == 0:
        raise AnalysisError("The dataset has no data rows to analyse.")
    for column in (request.time_column,):
        if column and request.expected_types.get(column, "date") != "date":
            raise AnalysisError("The time column must be a date column.")

    needed = [c for c in frame.columns if c in set(analysed) | {request.id_column, request.time_column}]
    declared = dict(request.expected_types)
    if request.time_column:
        declared.setdefault(request.time_column, "date")
    profiles = {c: profile_column(c, frame[c], request.date_dayfirst, declared.get(c)) for c in needed}
    ctx = AnalysisContext(
        frame=frame,
        columns=analysed,
        profiles=profiles,
        dayfirst=request.date_dayfirst,
        id_column=request.id_column,
        max_findings=max_findings,
    )

    quality = run_quality_checks(ctx, request)
    exclude = {c for c in (request.id_column, request.time_column) if c} | set(request.key_columns)
    anomalies = run_anomaly_detection(ctx, request.methods, exclude, request.time_column)
    numeric_columns, _ = candidate_columns(ctx, exclude)

    metrics = dict(quality.metrics)
    metrics["columns_total"] = int(frame.shape[1])
    metrics["anomalies_flagged"] = len(anomalies.flagged)
    metrics["anomalous_rows"] = len(anomalies.flagged_rows)
    metrics["data_quality_findings"] = sum(v for k, v in ctx.counts.items() if k not in STATISTICAL_TYPES)
    metrics["statistical_findings"] = sum(v for k, v in ctx.counts.items() if k in STATISTICAL_TYPES)
    score = quality_score(metrics)

    findings = quality.findings + anomalies.findings
    findings.sort(key=lambda f: (
        SEVERITY_ORDER[f.severity],
        0 if f.category == FindingCategory.DATA_QUALITY else 1,
        f.issue_type,
        f.row_numbers[0] if f.row_numbers else 0,
    ))
    total = sum(ctx.counts.values())
    stored = findings[:max_findings]

    issue_counts = [
        {"issue_type": k, "label": ISSUE_LABELS.get(k, k), "count": v,
         "category": FindingCategory.STATISTICAL if k in STATISTICAL_TYPES else FindingCategory.DATA_QUALITY}
        for k, v in sorted(ctx.counts.items(), key=lambda kv: -kv[1]) if v
    ]
    seed = request.methods.isolation_forest.random_state
    charts = build_charts(ctx, numeric_columns, anomalies, request.time_column, quality.missing_by_column,
                          issue_counts, seed)
    charts["missing_by_row"] = quality.missing_by_row
    recommendations = build_recommendations(findings, ctx.counts, metrics, anomalies.methods)

    results = {
        "version": RESULTS_VERSION,
        "columns": [asdict(p) | {"analysed": p.name in analysed} for p in profiles.values()],
        "analysed_columns": analysed,
        "numeric_columns": numeric_columns,
        "metrics": metrics,
        "quality_score": score,
        "methods": anomalies.methods,
        "charts": charts,
        "recommendations": recommendations,
        "limitations": _limitations(request, total, len(stored), charts),
        "notes": ctx.notes,
        "findings_total": total,
        "findings_stored": len(stored),
        "truncated": total > len(stored),
        "safety_notice": SAFETY_NOTICE,
    }
    return AnalysisOutput(findings=stored, results=results, quality_score=score["value"])


def _limitations(request: AnalyzeRequest, total: int, stored: int, charts: dict) -> list[str]:
    tokens = ", ".join(t or "(empty)" for t in MISSING_TOKENS)
    items = [
        "Row numbers count data rows from 1; the header row is not counted (spreadsheet row = row number + 1).",
        f"Column types are inferred when at least {TYPE_THRESHOLD:.0%} of present values parse; declare expected "
        "types to override the inference.",
        f"Recognised missing-value placeholders (case-insensitive): {tokens}.",
        "Dates are read as ISO 8601 first, then as " + ("DD/MM/YYYY." if request.date_dayfirst else "MM/DD/YYYY."),
        "Exact duplicates compare the raw text of all columns; fully blank rows are reported as incomplete rows.",
        "Statistical outliers are prompts for review, not errors, and they do not lower the quality score.",
        "No value was modified, imputed or removed. The uploaded file is not stored.",
    ]
    if total > stored:
        items.append(f"{total} findings were produced; the {stored} with the highest severity are stored and "
                     "listed. Counts and metrics include all findings.")
    scatter = charts.get("scatter")
    if scatter and scatter.get("sampled"):
        items.append(f"The scatter chart shows a reproducible sample of {len(scatter['points'])} of "
                     f"{scatter['total_rows']} rows; every flagged row is included first.")
    return items
