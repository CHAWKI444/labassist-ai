from dataclasses import dataclass
from pathlib import Path


class ExtractionError(Exception):
    pass


@dataclass
class PageText:
    page: int | None
    text: str


def extract_pages(path: Path, file_type: str) -> list[PageText]:
    if file_type == "pdf":
        return _extract_pdf(path)
    if file_type == "docx":
        return _extract_docx(path)
    if file_type == "txt":
        return _extract_txt(path)
    raise ExtractionError(f"Unsupported file type: {file_type}")


def _extract_pdf(path: Path) -> list[PageText]:
    from pypdf import PdfReader
    from pypdf.errors import PdfReadError

    try:
        reader = PdfReader(str(path))
        if reader.is_encrypted:
            raise ExtractionError("Encrypted PDFs are not supported.")
        pages = [PageText(page=i + 1, text=(p.extract_text() or "")) for i, p in enumerate(reader.pages)]
    except PdfReadError as exc:
        raise ExtractionError(f"Could not read PDF: {exc}") from exc
    if not any(p.text.strip() for p in pages):
        raise ExtractionError("No extractable text found (scanned PDFs need OCR, which is not enabled).")
    return pages


def _extract_docx(path: Path) -> list[PageText]:
    import docx

    document = docx.Document(str(path))
    parts = [p.text for p in document.paragraphs if p.text.strip()]
    for table in document.tables:
        for row in table.rows:
            cells = [c.text.strip() for c in row.cells if c.text.strip()]
            if cells:
                parts.append(" | ".join(cells))
    text = "\n\n".join(parts)
    if not text.strip():
        raise ExtractionError("The DOCX document contains no text.")
    return [PageText(page=None, text=text)]


def _extract_txt(path: Path) -> list[PageText]:
    raw = path.read_bytes()
    try:
        text = raw.decode("utf-8-sig")
    except UnicodeDecodeError:
        text = raw.decode("cp1252")
    if not text.strip():
        raise ExtractionError("The TXT file contains no text.")
    return [PageText(page=None, text=text)]
