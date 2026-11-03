import io
import zipfile
from pathlib import Path

ALLOWED_EXTENSIONS = {".pdf": "pdf", ".txt": "txt", ".docx": "docx"}


class UploadValidationError(ValueError):
    pass


def validate_upload(filename: str, content: bytes, max_bytes: int) -> str:
    """Check extension, size and file signature. Returns the normalised file type."""
    extension = Path(filename or "").suffix.lower()
    file_type = ALLOWED_EXTENSIONS.get(extension)
    if file_type is None:
        raise UploadValidationError("Only PDF, TXT and DOCX files are accepted.")
    if not content:
        raise UploadValidationError("The file is empty.")
    if len(content) > max_bytes:
        raise UploadValidationError(f"The file exceeds the {max_bytes // (1024 * 1024)} MB limit.")

    if file_type == "pdf" and not content.startswith(b"%PDF-"):
        raise UploadValidationError("The file is not a valid PDF.")
    if file_type == "docx":
        if not content.startswith(b"PK"):
            raise UploadValidationError("The file is not a valid DOCX document.")
        try:
            with zipfile.ZipFile(io.BytesIO(content)) as archive:
                if "word/document.xml" not in archive.namelist():
                    raise UploadValidationError("The file is not a valid DOCX document.")
        except zipfile.BadZipFile as exc:
            raise UploadValidationError("The file is not a valid DOCX document.") from exc
    if file_type == "txt":
        if b"\x00" in content[:8192]:
            raise UploadValidationError("The TXT file appears to be binary.")
        try:
            content.decode("utf-8")
        except UnicodeDecodeError:
            try:
                content.decode("cp1252")
            except UnicodeDecodeError as exc:
                raise UploadValidationError("TXT files must be UTF-8 or Windows-1252 encoded.") from exc
    return file_type


def safe_display_name(filename: str) -> str:
    name = Path(filename or "document").name
    return "".join(c for c in name if c.isprintable() and c not in '<>:"/\\|?*')[:255] or "document"
