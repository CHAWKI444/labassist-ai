"""Data-quality checks. Each check reports what it found and never alters, imputes or drops data."""

from dataclasses import dataclass, field

import numpy as np
import pandas as pd

from app.models.base import utcnow
from app.models.labvision import FindingCategory
from app.schemas.labvision import AnalyzeRequest
from app.services.labvision.context import AnalysisContext
from app.services.labvision.findings import VERIFY_MEASUREMENT, Finding, fmt, rows_text
from app.services.labvision.profiling import describe_unparseable

DQ = FindingCategory.DATA_QUALITY
MISSING_MEDIUM_PCT = 20.0
INCOMPLETE_ROW_SHARE = 0.5


@dataclass
class QualityResult:
    findings: list[Finding] = field(default_factory=list)
    metrics: dict = field(default_factory=dict)
    missing_by_column: list[dict] = field(default_factory=list)
    missing_by_row: list[dict] = field(default_factory=list)


def run_quality_checks(ctx: AnalysisContext, request: AnalyzeRequest) -> QualityResult:
    result = QualityResult()
    rows = ctx.rows
    invalid = {c: np.zeros(rows, dtype=bool) for c in ctx.columns}
    duplicate_rows = np.zeros(rows, dtype=bool)

    _check_missing(ctx, result)
    _check_structure(ctx, result)
    exact_groups, exact_extra = _check_exact_duplicates(ctx, result, duplicate_rows)
    key_extra = _check_key_duplicates(ctx, result, request.key_columns, duplicate_rows)
    _check_types(ctx, result, invalid)
    _check_ranges(ctx, result, request, invalid)
    _check_rules(ctx, result, request, invalid)

    missing_cells = sum(int(ctx.missing(c).sum()) for c in ctx.columns)
    cells = rows * len(ctx.columns)
    present_cells = cells - missing_cells
    invalid_cells = int(sum(int((invalid[c] & ~ctx.missing(c).to_numpy()).sum()) for c in ctx.columns))
    result.metrics.update(
        rows=rows,
        columns_analyzed=len(ctx.columns),
        cells_analyzed=cells,
        missing_cells=missing_cells,
        missing_pct=round(100 * missing_cells / cells, 2) if cells else 0.0,
        present_cells=present_cells,
        invalid_cells=invalid_cells,
        invalid_pct=round(100 * invalid_cells / present_cells, 2) if present_cells else 0.0,
        duplicate_rows=exact_extra,
        duplicate_row_groups=exact_groups,
        duplicate_key_rows=key_extra,
        duplicate_rows_total=int(duplicate_rows.sum()),
        key_columns=list(request.key_columns),
    )
    return result


def _check_missing(ctx: AnalysisContext, result: QualityResult) -> None:
    rows = ctx.rows
    masks = []
    for column in ctx.columns:
        mask = ctx.missing(column)
        masks.append(mask.to_numpy())
        count = int(mask.sum())
        pct = round(100 * count / rows, 2) if rows else 0.0
        result.missing_by_column.append({"column": column, "missing": count, "missing_pct": pct})
        if not count or ctx.profiles[column].inferred_type == "empty":
            continue
        positions = np.flatnonzero(mask.to_numpy())
        ctx.emit(result.findings, Finding(
            category=DQ,
            issue_type="missing_values",
            method="completeness_check",
            severity="medium" if pct >= MISSING_MEDIUM_PCT else "low",
            column=column,
            row_numbers=(positions + 1).tolist(),
            affected_count=count,
            observed_value=f"{count} missing ({pct}%)",
            score=pct,
            threshold=f"medium when >= {MISSING_MEDIUM_PCT:g}% of rows are missing",
            explanation=(
                f"{count} of {rows} values ({pct}%) are missing in \u201c{column}\u201d "
                "(empty cells or placeholders such as NA, N/A or null)."
            ),
            suggested_action=(
                f"Check the data source and export for \u201c{column}\u201d: confirm whether the values were not "
                "measured, not transcribed or lost during export. Do not fill them in without a documented procedure."
            ),
        ))

    matrix = np.column_stack(masks) if masks else np.zeros((rows, 0), dtype=bool)
    per_row = matrix.sum(axis=1) if rows else np.zeros(0, dtype=int)
    histogram = np.bincount(per_row, minlength=len(ctx.columns) + 1) if rows else np.zeros(1, dtype=int)
    result.missing_by_row = [{"missing_cells": k, "rows": int(n)} for k, n in enumerate(histogram) if n]
    result.metrics["rows_with_missing"] = int((per_row > 0).sum())
    result.metrics["complete_rows"] = int((per_row == 0).sum())

    if len(ctx.columns) >= 2:
        mostly = np.flatnonzero(per_row > INCOMPLETE_ROW_SHARE * len(ctx.columns))
        if len(mostly):
            ctx.emit(result.findings, Finding(
                category=DQ,
                issue_type="incomplete_rows",
                method="completeness_check",
                severity="low",
                row_numbers=(mostly + 1).tolist(),
                affected_count=len(mostly),
                record_id=ctx.record_id(mostly),
                threshold=f"more than {INCOMPLETE_ROW_SHARE:.0%} of analysed columns missing",
                explanation=(
                    f"{len(mostly)} row(s) have more than half of the analysed columns missing "
                    f"(rows {rows_text((mostly + 1).tolist())})."
                ),
                suggested_action="Check whether these rows are partial entries, separators or export artefacts.",
            ))


def _check_structure(ctx: AnalysisContext, result: QualityResult) -> None:
    empty, constant = [], []
    for column in ctx.columns:
        profile = ctx.profiles[column]
        if profile.inferred_type == "empty":
            empty.append(column)
            ctx.emit(result.findings, Finding(
                category=DQ,
                issue_type="empty_column",
                method="structure_check",
                severity="medium",
                column=column,
                affected_count=ctx.rows,
                explanation=f"\u201c{column}\u201d has no value in any of the {ctx.rows} rows.",
                suggested_action="Confirm whether this column is expected to be empty in this export, or whether "
                "the mapping from the source system is broken.",
            ))
        elif profile.unique == 1 and ctx.rows > 1:
            constant.append(column)
            value = profile.samples[0] if profile.samples else ""
            ctx.emit(result.findings, Finding(
                category=DQ,
                issue_type="constant_column",
                method="structure_check",
                severity="low",
                column=column,
                affected_count=profile.non_missing,
                observed_value=value,
                explanation=f"\u201c{column}\u201d has the same value \u201c{value}\u201d in every non-missing row.",
                suggested_action="A constant column can be expected (for example a unit or batch column). Confirm "
                "that it is not an export or mapping error. It is excluded from outlier detection.",
            ))
    result.metrics["empty_columns"] = empty
    result.metrics["constant_columns"] = constant


def _check_exact_duplicates(ctx: AnalysisContext, result: QualityResult, duplicate_rows: np.ndarray) -> tuple[int, int]:
    frame = ctx.frame
    if ctx.rows < 2:
        return 0, 0
    blank = (frame.apply(lambda s: s.str.strip()) == "").all(axis=1).to_numpy()
    hashes = pd.util.hash_pandas_object(frame, index=False).to_numpy()
    series = pd.Series(hashes)[~blank]
    dup = series.duplicated(keep=False)
    if not dup.any():
        return 0, 0
    groups = series[dup].groupby(series[dup], sort=False).groups
    extra = int(series.duplicated(keep="first").sum())
    for index in series.index[series.duplicated(keep="first").to_numpy()]:
        duplicate_rows[index] = True
    for members in groups.values():
        positions = sorted(int(i) for i in members)
        row_numbers = [p + 1 for p in positions]
        ctx.emit(result.findings, Finding(
            category=DQ,
            issue_type="duplicate_rows",
            method="duplicate_check",
            severity="medium",
            row_numbers=row_numbers,
            affected_count=len(positions),
            record_id=ctx.record_id(positions),
            explanation=f"Rows {rows_text(row_numbers)} are identical in all {frame.shape[1]} columns.",
            suggested_action="Review whether these rows are repeated entries or a double import of the same record "
            "before removing any of them. Keep the original file unchanged.",
        ))
    return len(groups), extra


def _check_key_duplicates(
    ctx: AnalysisContext, result: QualityResult, key_columns: list[str], duplicate_rows: np.ndarray
) -> int:
    if not key_columns or ctx.rows < 2:
        return 0
    keys = ctx.frame[key_columns].apply(lambda s: s.str.strip())
    complete = ~pd.concat([ctx.missing(c) for c in key_columns], axis=1).any(axis=1)
    keys = keys[complete]
    dup = keys.duplicated(keep=False)
    if not dup.any():
        return 0
    extra_mask = keys.duplicated(keep="first")
    for index in keys.index[extra_mask.to_numpy()]:
        duplicate_rows[index] = True
    label = ", ".join(key_columns)
    for key, members in keys[dup].groupby(key_columns, sort=False).groups.items():
        values = key if isinstance(key, tuple) else (key,)
        observed = "; ".join(f"{c}={v}" for c, v in zip(key_columns, values))
        positions = sorted(int(i) for i in members)
        row_numbers = [p + 1 for p in positions]
        ctx.emit(result.findings, Finding(
            category=DQ,
            issue_type="duplicate_keys",
            method="duplicate_check",
            severity="high",
            column=label,
            row_numbers=row_numbers,
            affected_count=len(positions),
            record_id=ctx.record_id(positions),
            observed_value=observed,
            threshold=f"key columns: {label}",
            explanation=f"The key ({label}) value {observed} appears in {len(positions)} rows: {rows_text(row_numbers)}.",
            suggested_action=f"Review the key fields ({label}): confirm whether these are distinct records sharing a "
            "key (for example repeat measurements) or duplicated entries.",
        ))
    return int(extra_mask.sum())


def _check_types(ctx: AnalysisContext, result: QualityResult, invalid: dict[str, np.ndarray]) -> None:
    for column in ctx.columns:
        profile = ctx.profiles[column]
        present = ~ctx.missing(column)
        if profile.is_numeric:
            if profile.decimal_comma:
                ctx.notes.append(
                    f"\u201c{column}\u201d uses decimal commas; values were read as decimal numbers (source unchanged)."
                )
            bad = (present & ctx.numbers(column).isna()).to_numpy()
            invalid[column] |= bad
            share = round(100 * profile.numeric_ratio, 1)
            ctx.emit_cells(result.findings, bad, "numeric_parse_error", lambda i, c=column, s=share: Finding(
                category=DQ,
                issue_type="numeric_parse_error",
                method="type_check",
                severity="medium",
                column=c,
                row_numbers=[i + 1],
                record_id=ctx.record_id([i]),
                observed_value=ctx.value(i, c),
                threshold="expected type: numeric",
                explanation=f"\u201c{ctx.value(i, c).strip()}\u201d {describe_unparseable(ctx.value(i, c))}; "
                f"{s}% of the present values in \u201c{c}\u201d are numeric.",
                suggested_action="Inspect this value against the expected schema. If it is a censored result or "
                "carries a unit, record it according to the laboratory's documented convention.",
            ))
        elif profile.inferred_type == "date":
            bad = (present & ctx.dates(column).isna()).to_numpy()
            invalid[column] |= bad
            order = "DD/MM/YYYY" if ctx.dayfirst else "MM/DD/YYYY"
            ctx.emit_cells(result.findings, bad, "invalid_date", lambda i, c=column: Finding(
                category=DQ,
                issue_type="invalid_date",
                method="type_check",
                severity="medium",
                column=c,
                row_numbers=[i + 1],
                record_id=ctx.record_id([i]),
                observed_value=ctx.value(i, c),
                threshold=f"expected type: date (ISO 8601 or {order})",
                explanation=f"\u201c{ctx.value(i, c).strip()}\u201d in \u201c{c}\u201d is not a valid date "
                f"(expected ISO 8601 such as 2024-03-15, or {order}).",
                suggested_action="Inspect the value and the date format used by the source system.",
            ))
        elif profile.inferred_type == "mixed":
            numeric = ctx.numbers(column).notna().to_numpy()
            minority = (present.to_numpy() & ~numeric) if profile.numeric_ratio >= 0.5 else numeric
            positions = np.flatnonzero(minority)
            share = round(100 * profile.numeric_ratio, 1)
            ctx.emit(result.findings, Finding(
                category=DQ,
                issue_type="type_inconsistency",
                method="type_check",
                severity="medium",
                column=column,
                row_numbers=(positions + 1).tolist(),
                affected_count=len(positions),
                observed_value=", ".join(profile.samples[:3]),
                threshold="consistent when >= 80% of present values share one type",
                explanation=f"\u201c{column}\u201d mixes numbers ({share}% of present values) and text "
                f"({round(100 - share, 1)}%).",
                suggested_action="Inspect the affected values and declare the expected type for this column "
                "(numeric, date or text) so that each value can be validated.",
            ))


def _check_ranges(ctx: AnalysisContext, result: QualityResult, request: AnalyzeRequest, invalid: dict) -> None:
    for column, rule in request.ranges.items():
        if not ctx.profiles[column].is_numeric:
            ctx.notes.append(f"The valid range for \u201c{column}\u201d was not applied: the column is not numeric.")
            continue
        numbers = ctx.numbers(column)
        low = numbers < rule.min if rule.min is not None else pd.Series(False, index=numbers.index)
        high = numbers > rule.max if rule.max is not None else pd.Series(False, index=numbers.index)
        mask = (low | high).to_numpy()
        invalid[column] |= mask
        bounds = f"[{fmt(rule.min) if rule.min is not None else '-inf'}, {fmt(rule.max) if rule.max is not None else '+inf'}]"

        def build(i: int, c=column, low=low, rule=rule, bounds=bounds) -> Finding:
            below = bool(low.iat[i])
            limit = rule.min if below else rule.max
            return Finding(
                category=DQ,
                issue_type="out_of_range",
                method="range_check",
                severity="high",
                column=c,
                row_numbers=[i + 1],
                record_id=ctx.record_id([i]),
                observed_value=ctx.value(i, c),
                score=float(numbers.iat[i]),
                threshold=f"valid range {bounds} (user-defined)",
                explanation=f"{fmt(float(numbers.iat[i]))} is {'below the minimum' if below else 'above the maximum'} "
                f"{fmt(limit)} defined for \u201c{c}\u201d.",
                suggested_action=VERIFY_MEASUREMENT,
            )

        ctx.emit_cells(result.findings, mask, "out_of_range", build)


def _check_rules(ctx: AnalysisContext, result: QualityResult, request: AnalyzeRequest, invalid: dict) -> None:
    now = utcnow().replace(tzinfo=None)
    for rule in request.rules:
        column = rule.column
        present = ~ctx.missing(column)
        if rule.type == "allowed_values":
            allowed = [v.strip() for v in rule.values if v.strip()]
            values = ctx.frame[column].str.strip()
            if not rule.case_sensitive:
                allowed = [v.lower() for v in allowed]
                values = values.str.lower()
            mask = (present & ~values.isin(allowed)).to_numpy()
            invalid[column] |= mask
            shown = ", ".join(allowed[:8]) + (" ..." if len(allowed) > 8 else "")
            ctx.emit_cells(result.findings, mask, "rule_violation", lambda i, c=column, shown=shown: _rule_cell(
                ctx, i, c, f"allowed values: {shown}",
                f"\u201c{ctx.value(i, c).strip()}\u201d is not one of the allowed values for \u201c{c}\u201d ({shown}).",
            ))
        elif rule.type == "no_future_dates":
            if ctx.profiles[column].inferred_type != "date":
                ctx.notes.append(f"The no-future-dates rule for \u201c{column}\u201d was not applied: not a date column.")
                continue
            dates = ctx.dates(column)
            mask = (dates > now).fillna(False).to_numpy()
            invalid[column] |= mask
            ctx.emit_cells(result.findings, mask, "rule_violation", lambda i, c=column: _rule_cell(
                ctx, i, c, "dates must not be in the future",
                f"The date \u201c{ctx.value(i, c).strip()}\u201d in \u201c{c}\u201d is later than the analysis time.",
            ))
        elif rule.type == "required":
            positions = np.flatnonzero(ctx.missing(column).to_numpy())
            if len(positions):
                ctx.emit(result.findings, Finding(
                    category=DQ,
                    issue_type="rule_violation",
                    method="rule_check",
                    severity="high",
                    column=column,
                    row_numbers=(positions + 1).tolist(),
                    affected_count=len(positions),
                    threshold="value required",
                    explanation=f"\u201c{column}\u201d is required but {len(positions)} row(s) have no value.",
                    suggested_action="Retrieve the missing values from the source record; do not fill them in "
                    "without a documented procedure.",
                ))
        elif rule.type == "unique":
            values = ctx.frame[column].str.strip()[present]
            if not rule.case_sensitive:
                values = values.str.lower()
            dup = values.duplicated(keep=False)
            for value, members in values[dup].groupby(values[dup], sort=False).groups.items():
                positions = sorted(int(i) for i in members)
                row_numbers = [p + 1 for p in positions]
                ctx.emit(result.findings, Finding(
                    category=DQ,
                    issue_type="rule_violation",
                    method="rule_check",
                    severity="high",
                    column=column,
                    row_numbers=row_numbers,
                    affected_count=len(positions),
                    record_id=ctx.record_id(positions),
                    observed_value=ctx.value(positions[0], column),
                    threshold="values must be unique",
                    explanation=f"\u201c{ctx.value(positions[0], column).strip()}\u201d must be unique in "
                    f"\u201c{column}\u201d but appears in rows {rows_text(row_numbers)}.",
                    suggested_action=f"Review the rows sharing this \u201c{column}\u201d value and the source records.",
                ))


def _rule_cell(ctx: AnalysisContext, i: int, column: str, threshold: str, explanation: str) -> Finding:
    return Finding(
        category=DQ,
        issue_type="rule_violation",
        method="rule_check",
        severity="high",
        column=column,
        row_numbers=[i + 1],
        record_id=ctx.record_id([i]),
        observed_value=ctx.value(i, column),
        threshold=threshold,
        explanation=explanation,
        suggested_action="Check the value against the documented rule and the source record.",
    )
