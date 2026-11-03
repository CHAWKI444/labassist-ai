import re
from dataclasses import dataclass

from app.services.rag.extraction import PageText


@dataclass
class Chunk:
    index: int
    page: int | None
    text: str


_SENTENCE_END = re.compile(r"(?<=[.!?؟。])\s+|\n{2,}")


def _split_units(text: str) -> list[str]:
    text = re.sub(r"[ \t]+", " ", text.replace("\r\n", "\n"))
    units = [u.strip() for u in _SENTENCE_END.split(text) if u and u.strip()]
    return units


def chunk_pages(pages: list[PageText], size: int, overlap: int) -> list[Chunk]:
    """Greedy sentence-aware chunking; chunks never span pages so page citations stay exact."""
    if overlap >= size:
        raise ValueError("overlap must be smaller than chunk size")
    chunks: list[Chunk] = []
    for page in pages:
        current = ""
        for unit in _split_units(page.text):
            while len(unit) > size:
                head, unit = unit[:size], unit[size - overlap :]
                if current:
                    chunks.append(Chunk(len(chunks), page.page, current))
                    current = ""
                chunks.append(Chunk(len(chunks), page.page, head))
            candidate = f"{current} {unit}".strip()
            if len(candidate) <= size:
                current = candidate
                continue
            chunks.append(Chunk(len(chunks), page.page, current))
            tail = current[-overlap:] if overlap else ""
            if tail and " " in tail:
                tail = tail[tail.index(" ") + 1 :]
            current = f"{tail} {unit}".strip()
        if current:
            chunks.append(Chunk(len(chunks), page.page, current))
    return [c for c in chunks if len(c.text.strip()) >= 20 or len(chunks) == 1]
