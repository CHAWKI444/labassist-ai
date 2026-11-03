import json

import pytest

from app.models import KnowledgeItem, Message
from app.tests.conftest import auth

CAG_HEADER = "APPROVED LABORATORY KNOWLEDGE (knowledge-base version"
RAG_HEADER = "DOCUMENT EXCERPTS (retrieved"
DOC = b"Before a lipid panel blood test the patient must fast for twelve hours. Water is allowed."


@pytest.fixture()
def seeded(client, users, services, db):
    response = client.post("/api/documents", files={"file": ("fasting.txt", DOC)}, data={"visibility": "public"},
                           headers=auth(users["staff"]))
    assert response.status_code == 202
    db.add(KnowledgeItem(title="Opening hours", content="The laboratory opens Monday to Friday 7:00-18:00.",
                         status="approved", visibility="public", priority=1))
    db.commit()
    services.cag.bump_version(db, "seed", users["admin"].id)
    services.mag.create(db, users["patient"], "communication_style", "Prefers short answers", "manual")
    return users


def ask(client, user, message, mode="auto", language="en", conversation_id=None):
    payload = {"message": message, "mode": mode, "language": language}
    if conversation_id:
        payload["conversation_id"] = conversation_id
    return client.post("/api/chat", json=payload, headers=auth(user))


def test_rag_mode_returns_real_document_sources(client, seeded, llm):
    response = ask(client, seeded["patient"], "Do I need to fast before a lipid panel?", mode="rag")
    assert response.status_code == 200, response.text
    message = response.json()["message"]
    assert message["architectures_used"] == ["rag"]
    source = message["sources"][0]
    assert source["type"] == "document" and source["ref"] == "D1"
    assert "twelve hours" in source["excerpt"]
    assert source["cited"] is True  # the scripted model cited [D1]
    prompt = "\n".join(m["content"] for m in llm.calls[-1])
    assert RAG_HEADER in prompt and CAG_HEADER not in prompt


def test_cag_mode_uses_prepared_context_and_reuses_it(client, seeded, llm):
    first = ask(client, seeded["patient"], "When are you open?", mode="cag").json()["message"]
    assert first["architectures_used"] == ["cag"]
    assert first["context_info"]["cag"]["application_context_reused"] is False
    second = ask(client, seeded["patient"], "Are you open on Friday?", mode="cag").json()["message"]
    assert second["context_info"]["cag"]["application_context_reused"] is True
    assert llm.calls[-1][0]["content"] == llm.calls[-2][0]["content"]  # identical system prefix
    assert RAG_HEADER not in llm.calls[-1][-1]["content"]


def test_mag_mode_uses_only_memories(client, seeded, llm):
    message = ask(client, seeded["patient"], "How should you answer me?", mode="mag").json()["message"]
    assert message["architectures_used"] == ["mag"]
    prompt = "\n".join(m["content"] for m in llm.calls[-1])
    assert "Prefers short answers" in prompt
    assert CAG_HEADER not in prompt and RAG_HEADER not in prompt


def test_hybrid_combines_all_sources_in_separate_sections(client, seeded, llm):
    message = ask(client, seeded["patient"], "Do I need to fast before a lipid panel and when are you open?",
                  mode="hybrid").json()["message"]
    assert set(message["architectures_used"]) == {"rag", "cag", "mag"}
    user_turn = llm.calls[-1][-1]["content"]
    assert user_turn.index("DOCUMENT EXCERPTS") < user_turn.index("USER MEMORIES")
    assert "not laboratory evidence" in user_turn
    assert CAG_HEADER in llm.calls[-1][0]["content"]


def test_auto_mode_selects_sources(client, seeded):
    lab = ask(client, seeded["patient"], "Do I need to fast before a lipid panel?").json()["message"]
    assert "rag" in lab["architectures_used"]
    hello = ask(client, seeded["patient2"], "Hello!").json()["message"]
    assert hello["architectures_used"] == ["llm"]


def test_missing_information_instruction(client, users, llm):
    ask(client, users["patient"], "What is the price of a vitamin D test?", mode="hybrid")
    assert "not available in the approved sources" in llm.calls[-1][-1]["content"]


def test_diagnosis_guard(client, seeded, llm):
    ask(client, seeded["patient"], "Do I have diabetes? interpret my glucose result", mode="auto")
    assert "physician" in llm.calls[-1][-1]["content"]


def test_explicit_memory_capture_and_sensitive_refusal(client, seeded, services, db):
    ok = ask(client, seeded["patient"], "Remember that I prefer answers in English").json()["message"]
    assert ok["context_info"]["mag"]["capture"]["stored"] is True
    refused = ask(client, seeded["patient"], "Remember that I have diabetes").json()["message"]
    assert refused["context_info"]["mag"]["capture"]["stored"] is False
    contents = [m.content for m in services.mag.list_for_user(db, seeded["patient"].id)]
    assert "I prefer answers in English" in contents
    assert not any("diabetes" in c for c in contents)


def test_llm_failure_then_retry_does_not_duplicate_question(client, seeded, llm, db):
    llm.fail_next = True
    failed = ask(client, seeded["patient"], "When are you open?")
    assert failed.status_code == 502
    conversation_id = client.get("/api/conversations", headers=auth(seeded["patient"])).json()[0]["id"]
    retry = ask(client, seeded["patient"], "When are you open?", conversation_id=conversation_id)
    assert retry.status_code == 200
    roles = [m.role for m in db.query(Message).filter_by(conversation_id=conversation_id).order_by(Message.id)]
    assert roles == ["user", "assistant"]


def test_conversation_isolation(client, seeded):
    conversation_id = ask(client, seeded["patient"], "Hello").json()["conversation_id"]
    assert client.get(f"/api/conversations/{conversation_id}", headers=auth(seeded["patient2"])).status_code == 404
    assert ask(client, seeded["patient2"], "Hi", conversation_id=conversation_id).status_code == 404


def test_sse_stream_events(client, seeded):
    with client.stream("POST", "/api/chat/stream", json={"message": "When are you open?", "mode": "cag",
                                                         "language": "fr"}, headers=auth(seeded["patient"])) as r:
        assert r.headers["content-type"].startswith("text/event-stream")
        body = "".join(r.iter_text())
    events = [block.split("\n")[0].removeprefix("event: ") for block in body.strip().split("\n\n")]
    assert events[0] == "meta" and events[-1] == "done" and "token" in events
    done = json.loads(body.strip().split("\n\n")[-1].split("data: ", 1)[1])
    assert done["message"]["content"].startswith("Test answer")


def test_metrics_reflect_real_requests(client, seeded):
    ask(client, seeded["patient"], "When are you open?", mode="cag")
    metrics = client.get("/api/admin/metrics", headers=auth(seeded["admin"])).json()
    assert metrics["chat"]["requests"] == 1
    assert metrics["chat"]["by_architecture"] == {"cag": 1}
    assert metrics["chat"]["tokens"]["prompt_total"] == 123
