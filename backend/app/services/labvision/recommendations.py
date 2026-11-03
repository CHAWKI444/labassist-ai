"""Deterministic recommendations derived from validated findings. Each one names the rule and the finding
that triggered it; no language model is involved."""

from collections import defaultdict

from app.services.labvision.findings import ISSUE_LABELS, Finding

SAFETY_NOTICE = (
    "LabVision flags observations for qualified human review. It does not alter measurements, diagnose "
    "patients, or approve or reject laboratory results."
)


def _columns(findings: list[Finding], issue_type: str) -> list[str]:
    seen: dict[str, None] = {}
    for f in findings:
        if f.issue_type == issue_type and f.column:
            seen.setdefault(f.column, None)
    return list(seen)


def _quote(columns: list[str], limit: int = 4) -> str:
    shown = ", ".join(f"\u201c{c}\u201d" for c in columns[:limit])
    return shown + (f" and {len(columns) - limit} more" if len(columns) > limit else "")


def _why_skipped(method: dict) -> str:
    if method["notes"]:
        return method["notes"][0]
    if method["columns_skipped"]:
        first = method["columns_skipped"][0]
        return f"\u201c{first['column']}\u201d {first['reason']}"
    return "no suitable numeric column"


def build_recommendations(findings: list[Finding], counts: dict[str, int], metrics: dict, methods: list[dict]) -> list[dict]:
    recs: list[dict] = []

    def add(rule: str, severity: str, title: str, reason: str, action: str, issue_type: str, columns: list[str],
            label: str | None = None, count: int | None = None):
        recs.append({
            "id": rule,
            "severity": severity,
            "title": title,
            "reason": reason,
            "action": action,
            "trigger": {"issue_type": issue_type, "label": label or ISSUE_LABELS.get(issue_type, issue_type),
                        "count": counts.get(issue_type, 0) if count is None else count, "columns": columns},
        })

    by_column_missing = {f.column: f for f in findings if f.issue_type == "missing_values"}
    if by_column_missing:
        worst = sorted(by_column_missing.values(), key=lambda f: f.score or 0, reverse=True)
        cols = [f.column for f in worst]
        add("R-MISSING", "medium" if any((f.score or 0) >= 20 for f in worst) else "low",
            "Check the source of missing values",
            f"{len(cols)} column(s) have missing values; highest: \u201c{worst[0].column}\u201d ({worst[0].score}%).",
            f"Check the data source and export for {_quote(cols)}: confirm whether values were not measured, not "
            "transcribed or lost during export before any further use.", "missing_values", cols)

    if counts.get("empty_column"):
        cols = _columns(findings, "empty_column")
        add("R-EMPTY-COLUMN", "medium", "Review empty columns",
            f"{len(cols)} column(s) contain no values at all.",
            f"Confirm whether {_quote(cols)} are expected to be empty or whether the export mapping is broken.",
            "empty_column", cols)

    if counts.get("constant_column"):
        cols = _columns(findings, "constant_column")
        add("R-CONSTANT-COLUMN", "low", "Confirm constant columns",
            f"{len(cols)} column(s) hold a single repeated value.",
            f"Constant columns such as {_quote(cols)} can be expected (units, batch); confirm they are not an error.",
            "constant_column", cols)

    if metrics.get("duplicate_rows"):
        add("R-DUPLICATE-ROWS", "medium", "Review duplicated records",
            f"{metrics['duplicate_rows']} row(s) are exact copies of an earlier row.",
            "Review the duplicated rows (see the Anomaly Explorer) to determine whether they are double entries or "
            "repeated imports. Keep the original file unchanged; any removal must be documented.",
            "duplicate_rows", [])

    if metrics.get("duplicate_key_rows"):
        keys = metrics.get("key_columns", [])
        add("R-DUPLICATE-KEYS", "high", "Review duplicated key fields",
            f"{metrics['duplicate_key_rows']} row(s) repeat a key value of ({', '.join(keys)}).",
            f"Review the key fields {_quote(keys)}: distinguish legitimate repeat measurements from duplicated "
            "entries, and check the sample identification process.", "duplicate_keys", keys)

    for issue_type, title in (("numeric_parse_error", "Inspect non-numeric values"),
                              ("type_inconsistency", "Fix inconsistent column types"),
                              ("invalid_date", "Inspect invalid dates")):
        if counts.get(issue_type):
            cols = _columns(findings, issue_type)
            add(f"R-{issue_type.upper().replace('_', '-')}", "medium", title,
                f"{counts[issue_type]} {ISSUE_LABELS[issue_type].lower()} finding(s) in {_quote(cols) or 'the data'}.",
                "Inspect the affected values against the expected schema (type, decimal separator, date format). "
                "Censored results (e.g. \u201c<0.5\u201d) and values with units must follow the laboratory's "
                "documented convention.", issue_type, cols)

    if counts.get("out_of_range"):
        cols = _columns(findings, "out_of_range")
        add("R-OUT-OF-RANGE", "high", "Verify values outside the valid range",
            f"{counts['out_of_range']} value(s) fall outside the user-defined valid range in {_quote(cols)}.",
            "Verify units, transcription, measurement conditions and the applicable documented limits for each "
            "value. Refer to a qualified reviewer; do not correct values without the source record.",
            "out_of_range", cols)

    if counts.get("rule_violation"):
        cols = _columns(findings, "rule_violation")
        add("R-RULE", "high", "Resolve validation rule violations",
            f"{counts['rule_violation']} violation(s) of the configured validation rules in {_quote(cols)}.",
            "Check each violation against the documented rule and the source record.", "rule_violation", cols)

    statistical = sum(counts.get(t, 0) for t in ("iqr_outlier", "zscore_outlier", "multivariate_outlier",
                                                 "time_series_deviation"))
    if statistical:
        cols = sorted({f.column for f in findings if f.is_statistical and f.column})
        add("R-OUTLIERS", "low", "Verify unusual values",
            f"{metrics.get('anomalies_flagged', statistical)} observation(s) were flagged as statistically unusual "
            f"in {_quote(cols)}.",
            "Verify units, transcription and measurement conditions. An unusual value can be a valid observation: "
            "mark it as an expected observation after review instead of excluding it.", "statistical_outlier", cols,
            label="Statistical anomalies", count=statistical)

    skipped = [m for m in methods if m["status"] == "skipped"]
    if skipped:
        add("R-METHODS-SKIPPED", "low", "Some detection methods could not run",
            "; ".join(f"{m['label']}: {_why_skipped(m)}" for m in skipped),
            "Review the method notes. Small datasets or unsuitable columns limit what can be detected.",
            "methods", [], label="Skipped detection methods", count=len(skipped))
    return recs
