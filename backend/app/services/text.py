import math
import re
import unicodedata

_STOPWORDS = {
    # en
    "the", "a", "an", "and", "or", "of", "to", "in", "on", "for", "is", "are", "be", "do", "does", "i", "my",
    "me", "you", "your", "what", "how", "when", "where", "which", "can", "with", "it", "this", "that", "at",
    "please", "about", "should", "will", "there", "have", "has",
    # fr
    "le", "la", "les", "un", "une", "des", "de", "du", "et", "ou", "en", "au", "aux", "pour", "par", "sur",
    "est", "sont", "je", "j", "mon", "ma", "mes", "vous", "votre", "vos", "quel", "quelle", "quels", "quelles",
    "comment", "quand", "ou", "que", "qui", "quoi", "dans", "avec", "il", "elle", "ce", "cette", "faut", "dois",
    "peux", "puis", "est-ce", "pas", "ne", "se", "sa", "son", "ses", "l", "d", "qu", "s",
    # ar
    "في", "من", "على", "إلى", "الى", "عن", "ما", "ماذا", "هل", "كيف", "متى", "أين", "اين", "هو", "هي", "و", "أو",
    "او", "مع", "هذا", "هذه", "أنا", "انا", "لي",
}


def strip_accents(text: str) -> str:
    decomposed = unicodedata.normalize("NFKD", text)
    return "".join(c for c in decomposed if not unicodedata.combining(c))


def keywords(text: str) -> set[str]:
    """Lower-cased, accent-free content words (works for Latin and Arabic scripts)."""
    tokens = re.findall(r"[\w\u0600-\u06FF]+", strip_accents(text.lower()))
    return {t for t in tokens if len(t) > 2 and t not in _STOPWORDS and not t.isdigit()}


def overlap_score(query: str, text: str) -> float:
    q = keywords(query)
    if not q:
        return 0.0
    return len(q & keywords(text)) / len(q)


def estimate_tokens(text: str) -> int:
    """Conservative estimate (~3 characters per token) used for budgeting only.

    Real token counts come from Ollama's prompt_eval_count/eval_count after generation.
    """
    return math.ceil(len(text) / 3)


def truncate(text: str, limit: int) -> str:
    text = " ".join(text.split())
    return text if len(text) <= limit else text[: limit - 1].rstrip() + "…"
