from datetime import timedelta

from app.models import RequestMetric
from app.models.base import utcnow
from app.services.metrics import purge_expired_metrics
from app.tests.conftest import auth
from app.tests.test_chat import ask, seeded  # noqa: F401 - fixture


def admin_metrics(client, admin) -> dict:
    response = client.get("/api/admin/metrics", headers=auth(admin))
    assert response.status_code == 200, response.text
    return response.json()


def test_stage_timings_and_generation_speed_are_recorded(client, seeded):
    ask(client, seeded["patient"], "Do I need to fast before a lipid panel?", mode="hybrid")
    stages = admin_metrics(client, seeded["admin"])["stages"]
    assert stages["first_token_ms_avg"] is not None
    assert stages["retrieval_ms_avg"] is not None
    assert stages["cag_ms_avg"] is not None
    assert stages["generation_ms_avg"] is not None
    assert stages["tokens_per_second"] == 100.0  # scripted model: 7 tokens in 70 ms of Ollama eval time


def test_message_details_expose_timings(client, seeded):
    message = ask(client, seeded["patient"], "When are you open?", mode="cag").json()["message"]
    timings = message["context_info"]["timings"]
    assert timings["cag_ms"] is not None and timings["retrieval_ms"] is None  # RAG was not consulted
    assert timings["first_token_ms"] <= message["context_info"]["latency_ms"]


def test_rag_and_cag_quality_signals(client, seeded):
    ask(client, seeded["patient"], "Do I need to fast before a lipid panel?", mode="rag")
    ask(client, seeded["patient"], "When are you open?", mode="cag")
    ask(client, seeded["patient"], "Are you open on Friday?", mode="cag")
    quality = admin_metrics(client, seeded["admin"])["quality"]
    assert quality["rag_requests"] == 1 and quality["rag_hit_rate_pct"] == 100.0
    assert quality["rag_top_score_avg"] > 0
    assert quality["cag_requests"] == 2 and quality["cag_reuse_rate_pct"] == 50.0
    assert quality["no_source"] == 0


def test_no_source_counts_only_laboratory_questions(client, users):
    ask(client, users["patient"], "What is the price of a vitamin D test?", mode="hybrid")
    ask(client, users["patient"], "Hello!", mode="hybrid")
    quality = admin_metrics(client, users["admin"])["quality"]
    assert quality["lab_questions"] == 1
    assert quality["no_source"] == 1 and quality["no_source_rate_pct"] == 100.0


def test_safety_counters(client, seeded):
    ask(client, seeded["patient"], "Do I have diabetes? interpret my glucose result")
    ask(client, seeded["patient"], "Remember that I have diabetes")
    ask(client, seeded["patient"], "Remember that I prefer answers in English")
    safety = admin_metrics(client, seeded["admin"])["safety"]
    assert safety == {"diagnosis_guard": 1, "memory_refused_sensitive": 1}


def test_feedback_is_owner_only_and_aggregated_without_content(client, seeded):
    body = ask(client, seeded["patient"], "When are you open?", mode="cag").json()
    conversation_id, message_id = body["conversation_id"], body["message"]["id"]
    url = f"/api/conversations/{conversation_id}/messages/{message_id}/feedback"

    assert client.put(url, json={"rating": 1}, headers=auth(seeded["patient2"])).status_code == 404
    assert client.put(url, json={"rating": 5}, headers=auth(seeded["patient"])).status_code == 422
    response = client.put(url, json={"rating": 1}, headers=auth(seeded["patient"]))
    assert response.status_code == 200 and response.json()["rating"] == 1

    detail = client.get(f"/api/conversations/{conversation_id}", headers=auth(seeded["patient"])).json()
    question, answer = detail["messages"]
    assert answer["feedback"] == 1
    question_url = f"/api/conversations/{conversation_id}/messages/{question['id']}/feedback"
    assert client.put(question_url, json={"rating": 1}, headers=auth(seeded["patient"])).status_code == 404

    feedback = admin_metrics(client, seeded["admin"])["feedback"]
    assert feedback == {"up": 1, "down": 0, "satisfaction_pct": 100.0, "by_architecture": {"cag": {"up": 1, "down": 0}}}

    client.put(url, json={"rating": None}, headers=auth(seeded["patient"]))
    assert admin_metrics(client, seeded["admin"])["feedback"]["up"] == 0


def test_alerts_require_enough_requests_then_fire(client, seeded, services, llm):
    llm.fail_next = True
    ask(client, seeded["patient"], "When are you open?")
    assert admin_metrics(client, seeded["admin"])["alerts"] == []  # below alert_min_requests

    services.settings.alert_min_requests = 1
    alerts = admin_metrics(client, seeded["admin"])["alerts"]
    assert [a["code"] for a in alerts] == ["error_rate"]


def test_metrics_retention_purges_only_old_rows(db):
    for age in (timedelta(days=91), timedelta(days=1)):
        db.add(RequestMetric(kind="http", path="/api/x", method="GET", status_code=200, latency_ms=1,
                             created_at=utcnow() - age))
    db.commit()
    assert purge_expired_metrics(db, retention_days=90) == 1
    assert db.query(RequestMetric).count() == 1


def test_metrics_are_admin_only(client, users):
    assert client.get("/api/admin/metrics", headers=auth(users["staff"])).status_code == 403
