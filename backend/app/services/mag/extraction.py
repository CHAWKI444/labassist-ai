import re
from dataclasses import dataclass

from app.models.memory import MemoryCategory
from app.services.text import strip_accents

# Only explicit user requests are captured; nothing is inferred silently from ordinary questions.
_EXPLICIT = [
    re.compile(r"^\s*(?:please\s+)?remember\s+(?:that\s+)?(?P<c>.+)$", re.I),
    re.compile(r"^\s*(?:please\s+)?(?:note|keep in mind)\s+that\s+(?P<c>.+)$", re.I),
    re.compile(
        r"^\s*(?:s'il (?:te|vous) pla[iî]t,?\s+)?(?:souviens[- ](?:toi|vous)|rappelle[- ]toi|retiens|"
        r"m[ée]morise|note)\s+(?:que\s+|de\s+|bien\s+que\s+)?(?P<c>.+)$",
        re.I,
    ),
    re.compile(r"^\s*(?:من فضلك\s+)?(?:تذكر|تذكّر|احفظ|سجل)\s+(?:أن|ان|أنني|انني)?\s*(?P<c>.+)$"),
]

_LANGUAGE_WORDS = [
    "french", "arabic", "english", "francais", "arabe", "anglais", "العربية", "الفرنسية", "الإنجليزية", "الانجليزية",
]
_STYLE_WORDS = [
    "short", "brief", "concise", "detailed", "simple", "bullet", "court", "courte", "bref", "breve", "concis",
    "detaill", "simple", "liste", "مختصر", "مفصل", "بسيط",
]


@dataclass
class MemoryCandidate:
    category: str
    content: str


def classify(content: str) -> str:
    normalised = strip_accents(content.lower())
    if any(w in normalised for w in _LANGUAGE_WORDS):
        return MemoryCategory.LANGUAGE
    if any(w in normalised for w in _STYLE_WORDS):
        return MemoryCategory.STYLE
    return MemoryCategory.PREFERENCE


def extract_explicit_memory(message: str, max_chars: int) -> MemoryCandidate | None:
    text = message.strip()
    for pattern in _EXPLICIT:
        match = pattern.match(text)
        if match:
            content = match.group("c").strip().rstrip(".!؟?").strip()
            if len(content) < 3:
                return None
            return MemoryCandidate(category=classify(content), content=content[:max_chars])
    return None
