"""Profile photo validation and metadata stripping (EXIF/XMP can contain GPS location and device data)."""

import struct
import uuid
from pathlib import Path

MAX_AVATAR_BYTES = 2 * 1024 * 1024
MEDIA_TYPES = {"jpg": "image/jpeg", "png": "image/png", "webp": "image/webp"}


class AvatarError(ValueError):
    pass


def detect_type(data: bytes) -> str:
    if data.startswith(b"\xff\xd8\xff"):
        return "jpg"
    if data.startswith(b"\x89PNG\r\n\x1a\n"):
        return "png"
    if data[:4] == b"RIFF" and data[8:12] == b"WEBP":
        return "webp"
    raise AvatarError("Only JPEG, PNG or WebP images are accepted.")


def _strip_jpeg(data: bytes) -> bytes:
    out = bytearray(data[:2])
    i = 2
    while i < len(data):
        if data[i] != 0xFF:
            raise AvatarError("Corrupted JPEG image.")
        marker = data[i + 1]
        if marker == 0xD9:  # end of image
            out += data[i : i + 2]
            break
        if 0xD0 <= marker <= 0xD7 or marker == 0x01:
            out += data[i : i + 2]
            i += 2
            continue
        if i + 4 > len(data):
            raise AvatarError("Corrupted JPEG image.")
        length = struct.unpack(">H", data[i + 2 : i + 4])[0]
        segment = data[i : i + 2 + length]
        if marker == 0xDA:  # start of scan: the rest is compressed image data
            out += data[i:]
            break
        # APP1 = EXIF/XMP, APP13 = Photoshop/IPTC, COM = free-text comment.
        if marker not in (0xE1, 0xED, 0xFE):
            out += segment
        i += 2 + length
    return bytes(out)


def _strip_png(data: bytes) -> bytes:
    out = bytearray(data[:8])
    i = 8
    while i + 8 <= len(data):
        length = struct.unpack(">I", data[i : i + 4])[0]
        kind = data[i + 4 : i + 8]
        end = i + 12 + length
        if end > len(data):
            raise AvatarError("Corrupted PNG image.")
        if kind not in (b"eXIf", b"tEXt", b"zTXt", b"iTXt", b"tIME"):
            out += data[i:end]
        i = end
        if kind == b"IEND":
            break
    return bytes(out)


def _strip_webp(data: bytes) -> bytes:
    chunks = bytearray()
    i = 12
    while i + 8 <= len(data):
        kind = data[i : i + 4]
        size = struct.unpack("<I", data[i + 4 : i + 8])[0]
        end = i + 8 + size + (size & 1)
        if end > len(data) + 1:
            raise AvatarError("Corrupted WebP image.")
        chunk = bytearray(data[i:end])
        if kind == b"VP8X" and len(chunk) > 8:
            chunk[8] &= ~(0x04 | 0x08) & 0xFF  # clear XMP and EXIF presence flags
        if kind not in (b"EXIF", b"XMP "):
            chunks += chunk
        i = end
    return b"RIFF" + struct.pack("<I", len(chunks) + 4) + b"WEBP" + bytes(chunks)


def sanitise(data: bytes) -> tuple[bytes, str]:
    if not data:
        raise AvatarError("The file is empty.")
    if len(data) > MAX_AVATAR_BYTES:
        raise AvatarError("Profile photos are limited to 2 MB.")
    kind = detect_type(data)
    stripper = {"jpg": _strip_jpeg, "png": _strip_png, "webp": _strip_webp}[kind]
    try:
        return stripper(data), kind
    except (struct.error, IndexError) as exc:
        raise AvatarError("The image file is corrupted.") from exc


def store(directory: Path, data: bytes, kind: str) -> str:
    directory.mkdir(parents=True, exist_ok=True)
    key = f"{uuid.uuid4().hex}.{kind}"
    (directory / key).write_bytes(data)
    return key


def remove(directory: Path, key: str | None) -> None:
    if key:
        path = directory / Path(key).name
        if path.exists():
            path.unlink()
