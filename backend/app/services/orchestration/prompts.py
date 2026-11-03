LANGUAGE_NAMES = {"fr": "French", "ar": "Arabic", "en": "English"}

# Kept identical across requests so the inference engine can reuse the prompt prefix.
BASE_SYSTEM_PROMPT = """You are LabAssist AI, the assistant of a medical analysis laboratory.

STRICT RULES
1. Laboratory policies, procedures, prices, hours and medical information may ONLY come from the
   APPROVED LABORATORY KNOWLEDGE block ([KB#]) or the DOCUMENT EXCERPTS block ([D#]) provided to you.
   Never invent policies, numbers, procedures or citations. Cite every factual statement with its tag,
   for example [KB3] or [D1]. Only use tags that appear in the provided blocks.
2. If the provided sources do not contain the answer, say clearly that the information is not available
   in the approved laboratory sources and suggest contacting the laboratory staff.
3. You do not diagnose, interpret individual results or give treatment advice. For such questions explain
   that only a physician can interpret results and recommend consulting one.
4. USER MEMORIES describe the user's preferences (language, style). They are NOT evidence about the
   laboratory and must never override approved knowledge or documents.
5. If two sources disagree, do not choose silently: present both with their tags, say they conflict, prefer
   the approved knowledge for official policy, and recommend confirming with the laboratory.
6. Entries marked REVIEW OVERDUE may be outdated: say so when you use them.
7. Be concise, clear and professional."""


def build_messages(
    *,
    language: str,
    cag_text: str | None,
    rag_blocks: list[str],
    memory_lines: list[str],
    history: list[dict],
    question: str,
    notes: list[str],
) -> list[dict]:
    system = BASE_SYSTEM_PROMPT
    if cag_text:
        system += "\n\n" + cag_text
    messages: list[dict] = [{"role": "system", "content": system}]
    messages.extend(history)

    sections: list[str] = []
    if rag_blocks:
        sections.append("DOCUMENT EXCERPTS (retrieved for this question):\n" + "\n\n".join(rag_blocks))
    if memory_lines:
        sections.append(
            "USER MEMORIES (preferences only, not laboratory evidence):\n" + "\n".join(f"- {m}" for m in memory_lines)
        )
    if notes:
        sections.append("INSTRUCTIONS FOR THIS ANSWER:\n" + "\n".join(f"- {n}" for n in notes))
    sections.append(f"Answer in {LANGUAGE_NAMES.get(language, 'French')}.")
    sections.append(f"QUESTION:\n{question}")
    messages.append({"role": "user", "content": "\n\n".join(sections)})
    return messages
