"""Validation and parsing of uploaded CSV / Excel datasets.

Every cell is read as text so the original values are preserved exactly; type interpretation happens later
in the profiler and never modifies the parsed frame. Spreadsheet formulas are never evaluated: openpyxl
returns the cached value only, and a string that looks like a formula stays a string.
"""

import csv
import io
import re
import zipfile
from dataclasses import dataclass, field
from pathlib import Path

import pandas as pd

ALLOWED_EXTENSIONS = {".csv": "csv", ".xlsx": "xlsx", ".xls": "xls"}
OLE_SIGNATURE = b"\xd0\xcf\x11\xe0\xa1\xb1\x1a\xe1"
CSV_DELIMITERS = [",", ";", "\t", "|"]
MAX_COLUMN_NAME = 120
# An .xlsx is a zip archive: refuse archives that would inflate far beyond the upload limit (zip bombs).
MAX_XLSX_EXPANSION = 25
MAX_XLSX_ENTRIES = 5000


class DatasetError(ValueError):
    """The file is not a dataset LabVision can read. The message is safe to show to the user."""


class DatasetTooLarge(DatasetError):
    pass


@dataclass
class ParsedDataset:
    frame: pd.DataFrame  # every cell is a str; missing cells are ""
    file_type: str
    encoding: str | None = None
    delimiter: str | None = None
    sheet_name: str | None = None
    sheets: list[str] = field(default_factory=list)
    warnings: list[str] = field(default_factory=list)


def detect_file_type(filename: str, content: bytes, max_bytes: int) -> str:
    extension = Path(filename or "").suffix.lower()
    file_type = ALLOWED_EXTENSIONS.get(extension)
    if file_type is None:
        raise DatasetError("Only CSV, XLSX and XLS files are accepted.")
    if not content:
        raise DatasetError("The file is empty.")
    if len(content) > max_bytes:
        raise DatasetTooLarge(f"The file exceeds the {max_bytes // (1024 * 1024)} MB limit.")

    if file_type == "xlsx":
        _check_xlsx_archive(content, max_bytes)
    elif file_type == "xls":
        if not content.startswith(OLE_SIGNATURE):
            raise DatasetError("The file is not a valid XLS workbook.")
    elif content.startswith(b"PK") or content.startswith(OLE_SIGNATURE):
        raise DatasetError("This looks like an Excel workbook saved with a .csv extension. Upload it as .xlsx or .xls.")
    elif b"\x00" in content[:8192] and not content.startswith((b"\xff\xfe", b"\xfe\xff")):
        raise DatasetError("The CSV file appears to be binary.")
    return file_type


def _check_xlsx_archive(content: bytes, max_bytes: int) -> None:
    if not content.startswith(b"PK"):
        raise DatasetError("The file is not a valid XLSX workbook.")
    try:
        with zipfile.ZipFile(io.BytesIO(content)) as archive:
            entries = archive.infolist()
            names = {entry.filename for entry in entries}
    except zipfile.BadZipFile as exc:
        raise DatasetError("The file is not a valid XLSX workbook.") from exc
    if "xl/workbook.xml" not in names:
        raise DatasetError("The file is not a valid XLSX workbook.")
    if any(name.lower().endswith("vbaproject.bin") for name in names):
        raise DatasetError("Macro-enabled workbooks are not accepted.")
    if len(entries) > MAX_XLSX_ENTRIES or sum(e.file_size for e in entries) > MAX_XLSX_EXPANSION * max_bytes:
        raise DatasetTooLarge("The workbook expands to more data than LabVision accepts.")


def decode_text(content: bytes) -> tuple[str, str, list[str]]:
    """Returns (text, encoding, warnings). Never guesses silently: non-UTF-8 decodings are reported."""
    if content.startswith((b"\xff\xfe", b"\xfe\xff")):
        try:
            return content.decode("utf-16"), "utf-16", []
        except UnicodeDecodeError as exc:
            raise DatasetError("The file has a UTF-16 marker but could not be decoded.") from exc
    try:
        return content.decode("utf-8-sig"), "utf-8", []
    except UnicodeDecodeError:
        pass
    for encoding, label in (("cp1252", "Windows-1252"), ("latin-1", "ISO-8859-1")):
        try:
            text = content.decode(encoding)
        except UnicodeDecodeError:
            continue
        return text, encoding, [
            f"The file is not UTF-8; it was decoded as {label}. Check that accented characters display correctly."
        ]
    raise DatasetError("The file encoding is not supported. Save it as UTF-8 CSV.")  # pragma: no cover


def detect_delimiter(text: str) -> str:
    sample = "\n".join(text.splitlines()[:50])
    try:
        return csv.Sniffer().sniff(sample, delimiters="".join(CSV_DELIMITERS)).delimiter
    except csv.Error:
        header = text.splitlines()[0] if text else ""
        counts = {d: header.count(d) for d in CSV_DELIMITERS}
        best = max(counts, key=counts.get)
        return best if counts[best] else ","


def parse_dataset(
    filename: str, content: bytes, *, max_bytes: int, max_rows: int, max_columns: int, sheet: str | None = None
) -> ParsedDataset:
    file_type = detect_file_type(filename, content, max_bytes)
    if file_type == "csv":
        parsed = _parse_csv(content, max_rows)
    else:
        parsed = _parse_excel(content, file_type, max_rows, sheet)
    raw = parsed.frame
    if raw.shape[0] == 0 or raw.shape[1] == 0:
        raise DatasetError("The file contains no header row.")

    header = [_cell_text(v) for v in raw.iloc[0].tolist()]
    body = raw.iloc[1:].reset_index(drop=True)
    columns, renamed = _normalise_header(header)
    if len(columns) > max_columns:
        raise DatasetTooLarge(f"The dataset has {len(columns)} columns; the limit is {max_columns}.")
    body.columns = columns
    # CSV cells are already text; Excel cells carry native types that are rendered back to text here.
    body = body.map(_cell_text) if file_type != "csv" and len(body) else body.astype(str)
    body = _drop_trailing_blank_rows(body)
    if len(body) > max_rows:
        raise DatasetTooLarge(f"The dataset has more than {max_rows:,} data rows; the limit is {max_rows:,}.")
    parsed.frame = body
    parsed.warnings.extend(renamed)
    if len(body) == 0:
        parsed.warnings.append("The file has a header row but no data rows.")
    return parsed


def _parse_csv(content: bytes, max_rows: int) -> ParsedDataset:
    text, encoding, warnings = decode_text(content)
    if not text.strip():
        raise DatasetError("The file is empty.")
    delimiter = detect_delimiter(text)
    try:
        frame = pd.read_csv(
            io.StringIO(text),
            sep=delimiter,
            header=None,
            dtype=str,
            keep_default_na=False,
            na_filter=False,
            skip_blank_lines=True,
            nrows=max_rows + 2,
            on_bad_lines="error",
            engine="c",
        )
    except pd.errors.EmptyDataError as exc:
        raise DatasetError("The file is empty.") from exc
    except pd.errors.ParserError as exc:
        line = re.search(r"line (\d+)", str(exc))
        where = f" at line {line.group(1)}" if line else ""
        raise DatasetError(
            f"Malformed CSV{where}: a row has more fields than the header. Check delimiters and quoting."
        ) from None
    except (ValueError, csv.Error):
        raise DatasetError("Malformed CSV: the file could not be parsed. Check delimiters and quoting.") from None
    return ParsedDataset(frame=frame, file_type="csv", encoding=encoding, delimiter=delimiter, warnings=warnings)


def _parse_excel(content: bytes, file_type: str, max_rows: int, sheet: str | None) -> ParsedDataset:
    engine = "openpyxl" if file_type == "xlsx" else "xlrd"
    try:
        workbook = pd.ExcelFile(io.BytesIO(content), engine=engine)
        sheets = [str(s) for s in workbook.sheet_names]
    except Exception:  # noqa: BLE001 - library errors may echo file content; never surface them
        raise DatasetError("The workbook could not be read. It may be corrupted or password-protected.") from None
    if not sheets:
        raise DatasetError("The workbook contains no sheets.")
    if sheet is not None and sheet not in sheets:
        raise DatasetError("The selected sheet does not exist in this workbook.")
    chosen = sheet or sheets[0]
    try:
        frame = workbook.parse(chosen, header=None, dtype=object, nrows=max_rows + 2)
    except Exception:  # noqa: BLE001
        raise DatasetError("The selected sheet could not be read.") from None
    finally:
        workbook.close()
    warnings = [f"The workbook has {len(sheets)} sheets; analysing \u201c{chosen}\u201d."] if len(sheets) > 1 else []
    return ParsedDataset(frame=frame, file_type=file_type, sheet_name=chosen, sheets=sheets, warnings=warnings)


def _cell_text(value) -> str:
    if value is None:
        return ""
    if isinstance(value, float):
        if value != value:  # NaN
            return ""
        return str(int(value)) if value.is_integer() and abs(value) < 1e15 else repr(value)
    if isinstance(value, pd.Timestamp):
        return value.isoformat(sep=" ") if (value.hour or value.minute or value.second) else value.date().isoformat()
    if hasattr(value, "isoformat"):
        return value.isoformat()
    return str(value)


def _normalise_header(header: list[str]) -> tuple[list[str], list[str]]:
    columns: list[str] = []
    seen: set[str] = set()
    warnings: list[str] = []
    for index, name in enumerate(header):
        clean = "".join(c for c in name.strip() if c.isprintable())[:MAX_COLUMN_NAME]
        if not clean:
            clean = f"Column {index + 1}"
            warnings.append(f"Column {index + 1} has no header; it was named \u201c{clean}\u201d.")
        if clean in seen:
            suffix = 2
            while f"{clean} ({suffix})" in seen:
                suffix += 1
            warnings.append(f"Duplicate header \u201c{clean}\u201d was renamed \u201c{clean} ({suffix})\u201d.")
            clean = f"{clean} ({suffix})"
        seen.add(clean)
        columns.append(clean)
    return columns, warnings


def _drop_trailing_blank_rows(frame: pd.DataFrame) -> pd.DataFrame:
    """Spreadsheets often carry formatted-but-empty rows at the end. Interior blank rows are kept (and
    reported) so that row numbers always match the file."""
    if frame.empty:
        return frame
    filled = (frame != "").any(axis=1).to_numpy()
    last = len(filled) - 1
    while last >= 0 and not filled[last]:
        last -= 1
    return frame.iloc[: last + 1]
