"""Aggregates for the frontend charts and the PDF report. Only derived, bounded data is kept."""

import math

import numpy as np
import pandas as pd

from app.services.labvision.anomalies import AnomalyResult
from app.services.labvision.context import AnalysisContext

MAX_DISTRIBUTIONS = 20
MAX_BINS = 30
MAX_SCATTER_COLUMNS = 8
MAX_SCATTER_POINTS = 600
MAX_TREND_SERIES = 6
MAX_TREND_POINTS = 400
MAX_CORRELATION_COLUMNS = 15
MIN_CORRELATION_PAIRS = 10


def _num(value) -> float | None:
    if value is None:
        return None
    value = float(value)
    return value if math.isfinite(value) else None


def describe(values: pd.Series) -> dict:
    present = values.dropna()
    if present.empty:
        return {"count": 0}
    q = present.quantile([0.25, 0.5, 0.75])
    return {
        "count": int(len(present)),
        "mean": _num(present.mean()),
        "std": _num(present.std(ddof=1)) if len(present) > 1 else None,
        "min": _num(present.min()),
        "q1": _num(q.iloc[0]),
        "median": _num(q.iloc[1]),
        "q3": _num(q.iloc[2]),
        "max": _num(present.max()),
    }


def histogram(values: pd.Series, flagged_rows: set[int]) -> list[dict]:
    """Bins cover Q1 - 3*IQR .. Q3 + 3*IQR; more extreme values go to labelled tail bins so that a single
    extreme observation cannot squash the whole distribution into one bar."""
    present = values.dropna()
    if present.empty:
        return []
    low, high = float(present.min()), float(present.max())
    flagged = present.index.isin(list(flagged_rows))
    if low == high:
        return [{"start": low, "end": high, "count": int(len(present)), "flagged": int(flagged.sum()), "tail": None}]
    n = len(present)
    q1, q3 = (float(q) for q in present.quantile([0.25, 0.75]))
    iqr = q3 - q1
    inner_low, inner_high = (max(low, q1 - 3 * iqr), min(high, q3 + 3 * iqr)) if iqr > 0 else (low, high)
    inner = (present >= inner_low) & (present <= inner_high)
    width = 2 * iqr / n ** (1 / 3) if iqr > 0 else 0  # Freedman-Diaconis
    bins = int(math.ceil((inner_high - inner_low) / width)) if width else int(math.ceil(math.sqrt(n)))
    bins = max(5, min(MAX_BINS, bins))
    counts, edges = np.histogram(present[inner].to_numpy(), bins=bins, range=(inner_low, inner_high))
    flagged_counts, _ = np.histogram(present[inner & flagged].to_numpy(), bins=edges)
    out = [
        {"start": float(edges[i]), "end": float(edges[i + 1]), "count": int(counts[i]),
         "flagged": int(flagged_counts[i]), "tail": None}
        for i in range(bins)
    ]
    below, above = present < inner_low, present > inner_high
    if below.any():
        out.insert(0, {"start": low, "end": inner_low, "count": int(below.sum()),
                       "flagged": int((below & flagged).sum()), "tail": "low"})
    if above.any():
        out.append({"start": inner_high, "end": high, "count": int(above.sum()),
                    "flagged": int((above & flagged).sum()), "tail": "high"})
    return out


def build_charts(
    ctx: AnalysisContext,
    numeric_columns: list[str],
    anomalies: AnomalyResult,
    time_column: str | None,
    missing_by_column: list[dict],
    issue_counts: list[dict],
    seed: int,
) -> dict:
    flagged_by_column: dict[str, set[int]] = {}
    for (index, column) in anomalies.flagged:
        flagged_by_column.setdefault(column, set()).add(index)

    distributions = []
    for column in numeric_columns[:MAX_DISTRIBUTIONS]:
        values = ctx.numbers(column)
        distributions.append({
            "column": column,
            "stats": describe(values),
            "bins": histogram(values, flagged_by_column.get(column, set())),
            "fences": anomalies.fences.get(column),
            "flagged": len(flagged_by_column.get(column, set())),
        })

    return {
        "missing_by_column": missing_by_column,
        "issue_counts": issue_counts,
        "distributions": distributions,
        "scatter": _scatter(ctx, numeric_columns, anomalies, seed),
        "time_series": _trends(ctx, numeric_columns, anomalies, time_column),
        "correlation": _correlation(ctx, numeric_columns),
    }


def _scatter(ctx: AnalysisContext, numeric_columns: list[str], anomalies: AnomalyResult, seed: int) -> dict | None:
    columns = numeric_columns[:MAX_SCATTER_COLUMNS]
    if len(columns) < 2:
        return None
    frame = pd.concat({c: ctx.numbers(c) for c in columns}, axis=1)
    usable = frame.index[frame.notna().sum(axis=1) >= 2]
    usable_set = set(usable.tolist())
    flagged = [i for i in sorted(anomalies.flagged_rows) if i in usable_set][: MAX_SCATTER_POINTS // 2]
    rest = np.setdiff1d(usable.to_numpy(), np.array(flagged, dtype=int))
    budget = MAX_SCATTER_POINTS - len(flagged)
    if len(rest) > budget:
        rest = np.sort(np.random.default_rng(seed).choice(rest, size=budget, replace=False))
    methods_by_row: dict[int, set[str]] = {}
    for (index, _column), methods in anomalies.flagged.items():
        methods_by_row.setdefault(index, set()).update(methods)
    chosen = sorted(set(flagged) | set(int(i) for i in rest.tolist()))
    values = frame.loc[chosen].to_numpy(dtype=float)
    points = [
        {
            "row": index + 1,
            "values": [float(v) if np.isfinite(v) else None for v in row],
            "methods": sorted(methods_by_row.get(index, set())),
        }
        for index, row in zip(chosen, values)
    ]
    return {"columns": columns, "points": points, "sampled": len(usable) > len(points), "total_rows": int(len(usable))}


def _trends(ctx: AnalysisContext, numeric_columns: list[str], anomalies: AnomalyResult, time_column: str | None):
    if not time_column or ctx.profiles[time_column].inferred_type != "date":
        return None
    times = ctx.dates(time_column)
    series = []
    for column in numeric_columns[:MAX_TREND_SERIES]:
        frame = pd.DataFrame({"t": times, "v": ctx.numbers(column)}).dropna().sort_values("t", kind="stable")
        if len(frame) < 3:
            continue
        flagged = {i for (i, c) in anomalies.flagged if c == column}
        frame["flagged"] = frame.index.isin(list(flagged))
        aggregated = len(frame) > MAX_TREND_POINTS
        if aggregated:
            buckets = pd.cut(frame["t"].astype("int64"), MAX_TREND_POINTS, labels=False)
            grouped = frame.groupby(buckets)
            frame = pd.DataFrame({
                "t": grouped["t"].min(),
                "v": grouped["v"].mean(),
                "flagged": grouped["flagged"].any(),
                "n": grouped["v"].size(),
            })
        points = [
            {"t": t.isoformat(), "v": _num(v), "flagged": bool(f), **({"n": int(row_n)} if aggregated else {})}
            for t, v, f, row_n in zip(frame["t"], frame["v"], frame["flagged"],
                                      frame["n"] if aggregated else [1] * len(frame))
        ]
        series.append({"column": column, "points": points, "aggregated": aggregated})
    return {"time_column": time_column, "series": series} if series else None


def _correlation(ctx: AnalysisContext, numeric_columns: list[str]) -> dict | None:
    columns = numeric_columns[:MAX_CORRELATION_COLUMNS]
    if len(columns) < 2:
        return None
    frame = pd.concat({c: ctx.numbers(c) for c in columns}, axis=1)
    matrix = frame.corr(method="pearson", min_periods=MIN_CORRELATION_PAIRS)
    present = frame.notna().astype(int)
    pairs = present.T.dot(present)
    if matrix.isna().to_numpy()[~np.eye(len(columns), dtype=bool)].all():
        return None
    return {
        "columns": columns,
        "matrix": [[_num(v) if pd.notna(v) else None for v in row] for row in matrix.to_numpy()],
        "pairs": pairs.to_numpy().astype(int).tolist(),
        "method": "pearson",
        "min_pairs": MIN_CORRELATION_PAIRS,
    }
