import re

from app.services.text import strip_accents

_PATTERNS: list[tuple[str, re.Pattern]] = [
    ("email address", re.compile(r"[\w.+-]+@[\w-]+\.[\w.-]+")),
    ("phone number", re.compile(r"(?:\+|00)?\d[\d\s.\-]{7,}\d")),
    ("identifier or long number", re.compile(r"\b\d{6,}\b")),
    ("date", re.compile(r"\b\d{1,2}[/.\-]\d{1,2}[/.\-]\d{2,4}\b")),
    ("lab value", re.compile(r"\d+(?:[.,]\d+)?\s*(?:mg/?dl|g/?l|mmol|µmol|umol|ui/?l|iu/?l|%)", re.I)),
    ("credential", re.compile(r"(?i)\b(password|mot de passe|mdp|pin|token|كلمة السر|كلمة المرور)\b")),
]

# Health conditions, treatments and other special-category data (GDPR art. 9) are never memorised.
_HEALTH_TERMS = [
    "diagnos", "maladie", "disease", "illness", "diabet", "cancer", "tumeur", "tumor", "vih", "hiv", "sida",
    "aids", "hepatit", "enceinte", "pregnan", "grossesse", "allergi", "allergy", "traitement", "treatment",
    "medicament", "medication", "medicine", "ordonnance", "prescription", "symptom", "infection", "depress",
    "chimio", "chemo", "insulin", "anemi", "anaemi", "thyroid", "cholesterol", "glycemi", "tension arterielle",
    "blood pressure", "religio", "sexual", "sexuel", "politique", "political",
    "مرض", "سكري", "سرطان", "حامل", "حمل", "دواء", "علاج", "حساسية", "تشخيص", "فيروس", "التهاب",
]


def detect_sensitive(text: str) -> str | None:
    """Return a reason if the text contains information that must not be stored as a memory."""
    for reason, pattern in _PATTERNS:
        if pattern.search(text):
            return reason
    normalised = strip_accents(text.lower())
    for term in _HEALTH_TERMS:
        if term in normalised:
            return "health or special-category information"
    return None
