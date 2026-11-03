"""Statistical anomaly detection.

These methods flag observations that are *unusual* relative to the rest of the data. An unusual value is
not necessarily an error: every finding produced here is a prompt for qualified human review.
"""

import math
from dataclasses import dataclass, field

import numpy as np
import pandas as pd

from app.models.labvision import FindingCategory
from app.schemas.labvision import MethodConfig
from app.services.labvision.context import AnalysisContext
from app.services.labvision.findings import VERIFY_MEASUREMENT, Finding, fmt

STAT = FindingCategory.STATISTICAL
MAD_TO_SIGMA = 1.4826  # scales the median absolute deviation to a standard deviation under normality

ASSUMPTIONS = {
    "iqr": [
        "Distribution-free: uses quartiles, so it is robust to the outliers themselves.",
        "Skewed distributions (common for concentrations) produce more flags on the long tail.",
        "Not applied when the IQR is zero (at least half of the values are identical).",
    ],
    "zscore": [
        "Assumes values are roughly normally distributed and independent.",
        "The mean and standard deviation include the outliers, which can mask them (masking effect).",
        "With n observations no |z| can exceed (n-1)/sqrt(n), so small samples may never be flagged.",
    ],
    "modified_zscore": [
        "Uses the median and the median absolute deviation (MAD), which are robust to outliers.",
        "Iglewicz & Hoaglin recommend a threshold of 3.5.",
        "Not applied when the MAD is zero (at least half of the values are identical).",
    ],
    "isolation_forest": [
        "Multivariate: flags rows whose combination of values is easy to isolate with random splits.",
        "Rows with a missing value in any of the selected columns are excluded (never imputed).",
        "Results depend on the random seed; the seed is recorded so the analysis can be reproduced.",
        "A numeric contamination flags about that share of complete rows, even in clean data; 'auto' uses the "
        "original paper's threshold instead, which can flag many rows in dense data.",
    ],
    "rolling_median": [
        "Observations are ordered by the time column; each value is compared with the median of its window.",
        "The deviation is scaled by the robust spread (MAD) of all residuals of that column.",
        "Irregular sampling intervals are not resampled; the window counts observations, not time.",
    ],
}


@dataclass
class AnomalyResult:
    findings: list[Finding] = field(default_factory=list)
    methods: list[dict] = field(default_factory=list)
    fences: dict[str, dict] = field(default_factory=dict)
    flagged: dict[tuple[int, str], set[str]] = field(default_factory=dict)  # (row index, column) -> methods
    flagged_rows: set[int] = field(default_factory=set)


def candidate_columns(ctx: AnalysisContext, exclude: set[str]) -> tuple[list[str], list[dict]]:
    columns, skipped = [], []
    for column in ctx.columns:
        profile = ctx.profiles[column]
        if column in exclude:
            skipped.append({"column": column, "reason": "identifier, key or time column"})
        elif not profile.is_numeric:
            if profile.inferred_type not in ("empty",):
                skipped.append({"column": column, "reason": f"not numeric ({profile.inferred_type})"})
            else:
                skipped.append({"column": column, "reason": "empty column"})
        elif ctx.numbers(column).nunique() == 0:
            skipped.append({"column": column, "reason": "no valid numeric value"})
        elif ctx.numbers(column).nunique() == 1:
            skipped.append({"column": column, "reason": "constant column"})
        else:
            columns.append(column)
    return columns, skipped


def run_anomaly_detection(
    ctx: AnalysisContext, methods: MethodConfig, exclude: set[str], time_column: str | None
) -> AnomalyResult:
    result = AnomalyResult()
    columns, skipped = candidate_columns(ctx, exclude)
    min_n = methods.min_observations

    if methods.iqr.enabled:
        _iqr(ctx, result, columns, skipped, min_n, methods.iqr.k)
    else:
        result.methods.append(_disabled("iqr", "IQR fences"))

    if methods.zscore.enabled:
        _zscore(ctx, result, columns, skipped, min_n, methods.zscore.threshold, methods.zscore.variant)
    else:
        result.methods.append(_disabled("zscore", "Z-score"))

    if methods.isolation_forest.enabled:
        _isolation_forest(ctx, result, columns, methods)
    else:
        result.methods.append(_disabled("isolation_forest", "Isolation Forest"))

    if methods.time_series.enabled:
        _time_series(ctx, result, columns, time_column, methods)
    else:
        result.methods.append(_disabled("rolling_median", "Time-series deviation"))

    _assign_severity(result)
    return result


def _disabled(method: str, label: str) -> dict:
    return {"method": method, "label": label, "status": "disabled", "parameters": {}, "columns_applied": [],
            "columns_skipped": [], "flagged": 0, "notes": [], "assumptions": ASSUMPTIONS.get(method, [])}


def _report(method: str, label: str, parameters: dict, applied: list, skipped: list, flagged: int, notes: list) -> dict:
    if applied:
        status = "applied"
    else:
        status = "skipped"
    return {"method": method, "label": label, "status": status, "parameters": parameters, "columns_applied": applied,
            "columns_skipped": skipped, "flagged": flagged, "notes": notes, "assumptions": ASSUMPTIONS.get(method, [])}


def _flag(result: AnomalyResult, index: int, column: str, method: str) -> None:
    result.flagged.setdefault((index, column), set()).add(method)
    result.flagged_rows.add(index)


def _flag_mask(result: AnomalyResult, mask: np.ndarray, column: str, method: str) -> None:
    for index in np.flatnonzero(mask):
        _flag(result, int(index), column, method)


def _iqr(ctx, result: AnomalyResult, columns, skipped, min_n: int, k: float) -> None:
    applied, col_skipped, flagged, notes = [], list(skipped), 0, []
    for column in columns:
        values = ctx.numbers(column)
        present = values.dropna()
        if len(present) < min_n:
            col_skipped.append({"column": column, "reason": f"only {len(present)} values (minimum {min_n})"})
            continue
        q1, q3 = (float(q) for q in present.quantile([0.25, 0.75]))
        iqr = q3 - q1
        if iqr == 0:
            col_skipped.append({"column": column, "reason": "IQR is zero (at least half of the values are identical)"})
            continue
        low, high = q1 - k * iqr, q3 + k * iqr
        result.fences[column] = {"low": low, "high": high, "q1": q1, "q3": q3, "k": k}
        applied.append(column)
        mask = ((values < low) | (values > high)).fillna(False).to_numpy()
        _flag_mask(result, mask, column, "iqr")

        def build(i: int, c=column, values=values, low=low, high=high, q1=q1, q3=q3, iqr=iqr) -> Finding:
            x = float(values.iat[i])
            above = x > high
            distance = (x - q3) / iqr if above else (q1 - x) / iqr
            return Finding(
                category=STAT,
                issue_type="iqr_outlier",
                method="iqr",
                severity="low",
                column=c,
                row_numbers=[i + 1],
                record_id=ctx.record_id([i]),
                observed_value=ctx.value(i, c),
                score=round(distance, 4),
                threshold=f"fences [{fmt(low)}, {fmt(high)}] = Q1 - {k:g}*IQR, Q3 + {k:g}*IQR",
                explanation=(
                    f"{fmt(x)} is {'above the upper' if above else 'below the lower'} fence "
                    f"{fmt(high if above else low)} (Q1 {fmt(q1)}, Q3 {fmt(q3)}, IQR {fmt(iqr)}); it lies "
                    f"{fmt(distance, 3)} IQR {'above Q3' if above else 'below Q1'}."
                ),
                suggested_action=VERIFY_MEASUREMENT,
            )

        flagged += ctx.emit_cells(result.findings, mask, "iqr_outlier", build)
    result.methods.append(_report("iqr", "IQR fences", {"k": k, "min_observations": min_n}, applied, col_skipped,
                                  flagged, notes))


def _zscore(ctx, result: AnomalyResult, columns, skipped, min_n: int, threshold: float, variant: str) -> None:
    method = "zscore" if variant == "standard" else "modified_zscore"
    label = "Z-score" if variant == "standard" else "Modified Z-score (MAD)"
    applied, col_skipped, flagged, notes = [], list(skipped), 0, []
    for column in columns:
        values = ctx.numbers(column)
        present = values.dropna()
        n = len(present)
        if n < min_n:
            col_skipped.append({"column": column, "reason": f"only {n} values (minimum {min_n})"})
            continue
        if variant == "standard":
            center, spread = float(present.mean()), float(present.std(ddof=1))
            if not spread:
                col_skipped.append({"column": column, "reason": "standard deviation is zero"})
                continue
            if not math.isfinite(spread):
                col_skipped.append({"column": column, "reason": "values too large to compute a standard deviation"})
                continue
            scores = (values - center) / spread
            max_attainable = (n - 1) / math.sqrt(n)
            if max_attainable <= threshold:
                notes.append(f"\u201c{column}\u201d: with n={n} no |z| can exceed {max_attainable:.2f}, so the "
                             f"threshold {threshold:g} cannot be reached.")
            basis = f"mean {fmt(center)}, SD {fmt(spread)}"
        else:
            center = float(present.median())
            mad = float((present - center).abs().median())
            if not mad:
                col_skipped.append({"column": column, "reason": "MAD is zero (at least half of the values are identical)"})
                continue
            scores = 0.6745 * (values - center) / mad
            basis = f"median {fmt(center)}, MAD {fmt(mad)}"
        applied.append(column)
        mask = (scores.abs() > threshold).fillna(False).to_numpy()
        _flag_mask(result, mask, column, method)
        symbol = "z" if variant == "standard" else "modified z"

        def build(i: int, c=column, values=values, scores=scores, basis=basis) -> Finding:
            z = float(scores.iat[i])
            return Finding(
                category=STAT,
                issue_type="zscore_outlier",
                method=method,
                severity="low",
                column=c,
                row_numbers=[i + 1],
                record_id=ctx.record_id([i]),
                observed_value=ctx.value(i, c),
                score=round(z, 4),
                threshold=f"|{symbol}| > {threshold:g}",
                explanation=f"{fmt(float(values.iat[i]))} has {symbol} = {z:.2f} ({basis}), beyond the "
                f"threshold of {threshold:g}.",
                suggested_action=VERIFY_MEASUREMENT,
            )

        flagged += ctx.emit_cells(result.findings, mask, "zscore_outlier", build)
    result.methods.append(_report(method, label, {"threshold": threshold, "variant": variant,
                                                  "min_observations": min_n}, applied, col_skipped, flagged, notes))


def _isolation_forest(ctx, result: AnomalyResult, columns, methods: MethodConfig) -> None:
    params = methods.isolation_forest
    parameters = {"contamination": params.contamination, "n_estimators": params.n_estimators,
                  "random_state": params.random_state, "min_rows": params.min_rows}
    usable = [c for c in columns if ctx.numbers(c).notna().sum() >= methods.min_observations]
    if len(usable) < 2:
        result.methods.append({**_report("isolation_forest", "Isolation Forest", parameters, [], [], 0, [
            "Needs at least two suitable numeric columns; use IQR or Z-score for a single column."]),
            "status": "skipped"})
        return
    frame = pd.concat({c: ctx.numbers(c) for c in usable}, axis=1)
    complete = frame.dropna()
    excluded = len(frame) - len(complete)
    if len(complete) < params.min_rows:
        result.methods.append(_report("isolation_forest", "Isolation Forest", parameters, [], [], 0, [
            f"Only {len(complete)} complete rows across {len(usable)} columns (minimum {params.min_rows})."]))
        return

    from sklearn.ensemble import IsolationForest

    model = IsolationForest(
        n_estimators=params.n_estimators,
        contamination=params.contamination,
        random_state=params.random_state,
    )
    X = complete.to_numpy(dtype=float)
    model.fit(X)
    decision = model.decision_function(X)
    labels = model.predict(X)

    median = complete.median()
    spread = (complete - median).abs().median() * MAD_TO_SIGMA
    spread = spread.where(spread > 0, complete.std(ddof=1)).replace(0, np.nan)
    robust_z = ((complete - median) / spread).abs()

    positions = complete.index.to_numpy()
    flagged_idx = np.flatnonzero(labels == -1)
    mask = np.zeros(ctx.rows, dtype=bool)
    mask[positions[flagged_idx]] = True
    decision_by_row = dict(zip(positions.tolist(), decision.tolist()))
    z_values = np.nan_to_num(robust_z.to_numpy(dtype=float), nan=-1.0)
    order = np.argsort(-z_values, axis=1)[:, :2]
    row_of = {int(p): k for k, p in enumerate(positions)}

    def top_columns(i: int) -> list[tuple[str, float]]:
        k = row_of[i]
        return [(usable[j], float(z_values[k, j])) for j in order[k] if z_values[k, j] >= 0] or [(usable[0], 0.0)]

    for index in np.flatnonzero(mask):
        _flag(result, int(index), top_columns(int(index))[0][0], "isolation_forest")

    def build(i: int) -> Finding:
        contributions = top_columns(i)
        top = [c for c, _ in contributions]
        observed = "; ".join(f"{c}={ctx.value(i, c).strip()}" for c in top)
        detail = ", ".join(f"{c} (robust z {z:.1f})" for c, z in contributions)
        return Finding(
            category=STAT,
            issue_type="multivariate_outlier",
            method="isolation_forest",
            severity="low",
            column=top[0],
            row_numbers=[i + 1],
            record_id=ctx.record_id([i]),
            observed_value=observed,
            score=round(decision_by_row[i], 4),
            threshold="decision score < 0" + (f" (contamination {params.contamination})"
                                              if params.contamination != "auto" else " (contamination auto)"),
            explanation=(
                f"Isolation Forest isolated this row faster than typical rows across {len(usable)} columns "
                f"(decision score {decision_by_row[i]:.3f} < 0). Most unusual values: {detail or 'n/a'}."
            ),
            suggested_action=VERIFY_MEASUREMENT,
        )

    flagged = ctx.emit_cells(result.findings, mask, "multivariate_outlier", build)
    notes = [f"{excluded} row(s) with a missing value in the selected columns were excluded."] if excluded else []
    result.methods.append(_report("isolation_forest", "Isolation Forest", {**parameters, "columns": usable,
                                  "rows_used": len(complete)}, usable, [], flagged, notes))


def _time_series(ctx, result: AnomalyResult, columns, time_column: str | None, methods: MethodConfig) -> None:
    params = methods.time_series
    parameters = {"time_column": time_column, "window": params.window, "threshold": params.threshold,
                  "min_points": params.min_points}
    if not time_column:
        result.methods.append(_report("rolling_median", "Time-series deviation", parameters, [], [], 0,
                                      ["No time column was selected."]))
        return
    if ctx.profiles[time_column].inferred_type != "date":
        result.methods.append(_report("rolling_median", "Time-series deviation", parameters, [], [], 0,
                                      [f"\u201c{time_column}\u201d is not a valid date column."]))
        return
    times = ctx.dates(time_column)
    applied, skipped, flagged = [], [], 0
    for column in columns:
        series = pd.DataFrame({"t": times, "v": ctx.numbers(column)}).dropna()
        if len(series) < max(params.min_points, 2 * params.window):
            skipped.append({"column": column, "reason": f"only {len(series)} dated values "
                            f"(minimum {max(params.min_points, 2 * params.window)})"})
            continue
        series = series.sort_values("t", kind="stable")
        # (window + 1) // 2 keeps the first and last observations scored when the window is even.
        rolling = series["v"].rolling(params.window, center=True, min_periods=(params.window + 1) // 2).median()
        residual = series["v"] - rolling
        scale = float((residual - residual.median()).abs().median()) * MAD_TO_SIGMA
        if not scale:
            skipped.append({"column": column, "reason": "residual spread is zero"})
            continue
        applied.append(column)
        rz = residual / scale
        mask = np.zeros(ctx.rows, dtype=bool)
        hits = rz.index[(rz.abs() > params.threshold).to_numpy()]
        mask[hits.to_numpy()] = True
        _flag_mask(result, mask, column, "rolling_median")

        def build(i: int, c=column, series=series, rolling=rolling, rz=rz) -> Finding:
            value, local = float(series.at[i, "v"]), float(rolling.at[i])
            when = series.at[i, "t"]
            return Finding(
                category=STAT,
                issue_type="time_series_deviation",
                method="rolling_median",
                severity="low",
                column=c,
                row_numbers=[i + 1],
                record_id=ctx.record_id([i]),
                observed_value=ctx.value(i, c),
                score=round(float(rz.at[i]), 4),
                threshold=f"|robust z| > {params.threshold:g} vs rolling median (window {params.window})",
                explanation=(
                    f"{fmt(value)} on {when:%Y-%m-%d %H:%M} deviates from the local rolling median {fmt(local)} "
                    f"(window of {params.window} observations) by {fmt(value - local)}, robust z = "
                    f"{float(rz.at[i]):.2f}."
                ),
                suggested_action=VERIFY_MEASUREMENT + " Check instrument events (calibration, maintenance, "
                "reagent lot changes) around this time.",
            )

        flagged += ctx.emit_cells(result.findings, mask, "time_series_deviation", build)
    result.methods.append(_report("rolling_median", "Time-series deviation", parameters, applied, skipped, flagged, []))


def _assign_severity(result: AnomalyResult) -> None:
    """Explicit rule: an observation flagged by two or more independent methods gets medium priority."""
    for finding in result.findings:
        index = finding.row_numbers[0] - 1
        methods = result.flagged.get((index, finding.column or ""), set())
        finding.severity = "medium" if len(methods) >= 2 else "low"
        if len(methods) >= 2:
            others = sorted(m for m in methods if m != finding.method)
            if others:
                finding.explanation += f" Also flagged by: {', '.join(others)}."
