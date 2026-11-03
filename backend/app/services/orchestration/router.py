from dataclasses import dataclass, field

from app.services.text import keywords, strip_accents

# Topics typically covered by approved laboratory information (hours, preparation, sampling, results...).
_LAB_TOPIC_STEMS = [
    "horaire", "hour", "open", "ouvert", "ferme", "closed", "jeun", "fasting", "fast", "prelev", "sample",
    "sampling", "prise de sang", "blood", "urine", "result", "resultat", "rendez", "appointment", "tarif",
    "price", "prix", "cost", "cout", "rembours", "insurance", "mutuelle", "ordonnance", "prescription", "delai",
    "turnaround", "procedure", "protocol", "protocole", "consigne", "instruction", "preparation", "analyse",
    "analysis", "test", "bilan", "laborato", "lab", "adresse", "address", "parking", "contact", "document",
    "carte", "card", "domicile", "home", "enfant", "child", "tube", "centrifug", "stockage", "storage",
    "transport", "qualite", "quality", "securite", "safety", "hygiene", "dechet", "waste", "conserv",
    "ساعات", "مفتوح", "صيام", "تحليل", "تحاليل", "عينة", "نتائج", "نتيجة", "موعد", "سعر", "مختبر", "دم", "بول",
]
_GREETINGS = {
    "hello", "hi", "hey", "bonjour", "salut", "bonsoir", "merci", "thanks", "thank", "مرحبا", "السلام", "شكرا",
    "اهلا", "أهلا",
}


def is_lab_topic(query: str) -> bool:
    normalised = strip_accents(query.lower())
    return any(stem in normalised for stem in _LAB_TOPIC_STEMS)


def is_small_talk(query: str) -> bool:
    words = keywords(query) | {w.strip("!?.,") for w in strip_accents(query.lower()).split()}
    content_words = keywords(query) - _GREETINGS
    return bool(words & _GREETINGS) and len(content_words) <= 1


_DIAGNOSIS_CUES = [
    "do i have", "am i sick", "is it serious", "interpret my", "what does my result", "diagnos",
    "est-ce que j'ai", "ai-je", "suis-je malade", "est-ce grave", "interpreter mon", "interpréter mon",
    "que signifie mon résultat", "mes résultats sont", "هل عندي", "هل أنا مريض", "فسر نتيجتي", "تشخيص",
]


def asks_for_diagnosis(query: str) -> bool:
    lowered = query.lower()
    return any(cue in lowered for cue in _DIAGNOSIS_CUES)


@dataclass
class SourcePlan:
    """What the orchestrator should consult. 'requested' is decided before retrieval, 'used' after."""

    mode: str
    consult_rag: bool
    consult_cag: bool
    consult_mag: bool
    reasons: list[str] = field(default_factory=list)


def plan_sources(mode: str, query: str, has_documents: bool, has_knowledge: bool, memory_enabled: bool) -> SourcePlan:
    if mode == "rag":
        return SourcePlan(mode, True, False, False, ["RAG mode: document retrieval only."])
    if mode == "cag":
        return SourcePlan(mode, False, True, False, ["CAG mode: approved prepared context only."])
    if mode == "mag":
        return SourcePlan(mode, False, False, True, ["MAG mode: your authorised memories only."])
    if mode == "hybrid":
        return SourcePlan(
            mode, True, True, True, ["Hybrid mode: documents, approved context and memories are all consulted."]
        )

    reasons: list[str] = []
    small_talk = is_small_talk(query)
    lab_topic = is_lab_topic(query)
    consult_rag = has_documents and not small_talk
    consult_cag = has_knowledge and not small_talk
    consult_mag = memory_enabled
    if small_talk:
        reasons.append("Auto: greeting/small talk detected, no knowledge source needed.")
    if consult_rag:
        reasons.append("Auto: indexed documents available, retrieval will be kept only above the relevance threshold.")
    if consult_cag:
        reasons.append(
            "Auto: approved knowledge available"
            + (" and the question is about a laboratory topic." if lab_topic else "; kept only if entries match.")
        )
    if consult_mag:
        reasons.append("Auto: memory enabled, only relevant preferences are included.")
    return SourcePlan("auto", consult_rag, consult_cag, consult_mag, reasons)
