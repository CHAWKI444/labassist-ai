from dataclasses import dataclass, field

import numpy as np
import pandas as pd

from app.services.labvision.findings import Finding
from app.services.labvision.profiling import ColumnProfile, missing_mask, to_datetime, to_numeric


@dataclass
class AnalysisContext:
    """Read-only view of the dataset plus cached interpretations shared by every check."""

    frame: pd.DataFrame
    columns: list[str]
    profiles: dict[str, ColumnProfile]
    dayfirst: bool
    id_column: str | None
    max_findings: int
    counts: dict[str, int] = field(default_factory=dict)
    notes: list[str] = field(default_factory=list)
    _missing: dict[str, pd.Series] = field(default_factory=dict)
    _numbers: dict[str, pd.Series] = field(default_factory=dict)
    _dates: dict[str, pd.Series] = field(default_factory=dict)

    @property
    def rows(self) -> int:
        return len(self.frame)

    def missing(self, column: str) -> pd.Series:
        if column not in self._missing:
            self._missing[column] = missing_mask(self.frame[column])
        return self._missing[column]

    def numbers(self, column: str) -> pd.Series:
        if column not in self._numbers:
            values = to_numeric(self.frame[column], self.profiles[column].decimal_comma)
            self._numbers[column] = values.where(~self.missing(column))
        return self._numbers[column]

    def dates(self, column: str) -> pd.Series:
        if column not in self._dates:
            self._dates[column] = to_datetime(self.frame[column], self.dayfirst).where(~self.missing(column))
        return self._dates[column]

    def value(self, row_index: int, column: str) -> str:
        return str(self.frame.iat[row_index, self.frame.columns.get_loc(column)])

    def record_id(self, row_indexes) -> str | None:
        if not self.id_column:
            return None
        ids = [self.value(int(i), self.id_column).strip() for i in list(row_indexes)[:3]]
        ids = [i for i in ids if i]
        if not ids:
            return None
        more = len(list(row_indexes)) - 3
        return (", ".join(ids) + (f" (+{more})" if more > 0 else ""))[:255]

    def emit_cells(self, out: list[Finding], mask, issue_type: str, build) -> int:
        """Counts every flagged cell; materialises at most `max_findings` findings for one check."""
        positions = np.flatnonzero(np.asarray(mask, dtype=bool))
        self.counts[issue_type] = self.counts.get(issue_type, 0) + len(positions)
        for position in positions[: self.max_findings]:
            out.append(build(int(position)))
        return len(positions)

    def emit(self, out: list[Finding], finding: Finding) -> None:
        self.counts[finding.issue_type] = self.counts.get(finding.issue_type, 0) + 1
        out.append(finding)
