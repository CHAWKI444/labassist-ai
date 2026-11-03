from datetime import datetime, timedelta, timezone

import pytest

from app.models import RequestMetric
from app.services.analytics import DashboardAnalytics, classify_architecture, percent_change
from app.tests.conftest import auth
from app.tests.test_chat import ask, seeded  # noqa: F401 - reused fixture

ENDPOINTS = ("summary", "activity", "architectures", "recent")


def get(client, user, endpoint, **params):
    return client.get(f"/api/dashboard/{endpoint}", params=params, headers=auth(user))


def test_classify_architecture():
    assert classify_architecture(None) == "llm"
    assert classify_architecture(["llm"]) == "llm"
    assert classify_architecture(["cag"]) == "cag"
    assert classify_architecture(["rag", "mag"]) == "hybrid"
    assert percent_change(15, 10) == 50.0
    assert percent_change(5, 0) is None
    assert percent_change(None, 10) is None


def test_dashboard_requires_authentication(client):
    for endpoint in ENDPOINTS:
        assert client.get(f"/api/dashboard/{endpoint}").status_code == 401


def test_global_scope_is_admin_only(client, users):
    for endpoint in ENDPOINTS:
        assert get(client, users["patient"], endpoint, scope="global").status_code == 403
        assert get(client, users["staff"], endpoint, scope="global").status_code == 403
        assert get(client, users["admin"], endpoint, scope="global").status_code == 200
        assert get(client, users["patient"], endpoint).status_code == 200


def test_invalid_parameters_rejected(client, users):
    assert get(client, users["admin"], "summary", days=0).status_code == 422
    assert get(client, users["admin"], "summary", days=91).status_code == 422
    assert get(client, users["admin"], "summary", scope="everyone").status_code == 422
    assert get(client, users["admin"], "recent", limit=500).status_code == 422


def test_empty_dataset_returns_zeros_not_fabricated_values(client, users):
    summary = get(client, users["admin"], "summary", scope="global", days=7).json()
    assert summary["total_conversations"]["value"] == 0
    assert summary["requests_today"]["value"] == 0
    assert summary["indexed_documents"]["value"] == 0
    assert summary["avg_response_ms"]["value"] is None
    for kpi in ("total_conversations", "new_conversations", "requests_today", "indexed_documents", "avg_response_ms"):
        assert summary[kpi]["change_pct"] is None

    activity = get(client, users["admin"], "activity", scope="global", days=7).json()
    assert len(activity["points"]) == 7
    assert all(p["requests"] == 0 and p["new_conversations"] == 0 for p in activity["points"])

    dist = get(client, users["admin"], "architectures", scope="global").json()
    assert dist["total"] == 0
    assert [i["architecture"] for i in dist["items"]] == ["rag", "cag", "mag", "hybrid", "llm"]
    assert all(i["count"] == 0 and i["percentage"] == 0 for i in dist["items"])

    assert get(client, users["admin"], "recent", scope="global").json()["items"] == []


def test_statistics_reflect_real_requests_and_are_scoped(client, seeded, llm):  # noqa: F811
    patient, other, admin = seeded["patient"], seeded["patient2"], seeded["admin"]
    assert ask(client, patient, "Do I need to fast before a lipid panel?", mode="rag").status_code == 200
    assert ask(client, patient, "When are you open?", mode="cag").status_code == 200
    llm.fail_next = True
    assert ask(client, patient, "Is the lab open on Sunday?", mode="cag").status_code == 502
    assert ask(client, other, "When are you open?", mode="cag").status_code == 200

    mine = get(client, patient, "summary").json()
    assert mine["scope"] == "personal"
    assert mine["total_conversations"]["value"] == 3
    assert mine["requests_today"]["value"] == 3
    assert mine["failed_today"] == 1
    assert mine["response_samples"] == 2
    assert mine["avg_response_ms"]["value"] is not None

    dist = get(client, patient, "architectures").json()
    counts = {i["architecture"]: (i["count"], i["percentage"]) for i in dist["items"]}
    assert dist["total"] == 2
    assert counts["rag"] == (1, 50.0) and counts["cag"] == (1, 50.0) and counts["hybrid"] == (0, 0.0)

    recent = get(client, patient, "recent").json()["items"]
    assert [r["status"] for r in recent] == ["unanswered", "success", "success"]
    assert recent[0]["response_ms"] is None and recent[0]["architecture"] is None
    assert recent[1]["architecture"] == "cag" and recent[1]["response_ms"] >= 0
    assert all(r["role"] is None for r in recent)
    assert not any(key in r for r in recent for key in ("content", "message", "title", "email"))

    theirs = get(client, other, "summary").json()
    assert theirs["requests_today"]["value"] == 1
    assert theirs["total_conversations"]["value"] == 1
    assert len(get(client, other, "recent").json()["items"]) == 1

    overall = get(client, admin, "summary", scope="global").json()
    assert overall["requests_today"]["value"] == 4
    assert overall["failed_today"] == 1
    assert overall["total_conversations"]["value"] == 4
    global_recent = get(client, admin, "recent", scope="global").json()["items"]
    assert global_recent[0]["role"] == "patient"
    assert {r["status"] for r in global_recent} == {"success", "error"}

    today = get(client, admin, "activity", scope="global", days=7).json()["points"][-1]
    assert today["requests"] == 4 and today["new_conversations"] == 4 and today["active_conversations"] == 4


def test_indexed_documents_respect_visibility(client, seeded):  # noqa: F811
    response = client.post(
        "/api/documents",
        files={"file": ("staff.txt", b"Internal centrifuge calibration procedure for laboratory staff only.")},
        data={"visibility": "staff"},
        headers=auth(seeded["staff"]),
    )
    assert response.status_code == 202
    assert get(client, seeded["patient"], "summary").json()["indexed_documents"]["value"] == 1
    assert get(client, seeded["staff"], "summary").json()["indexed_documents"]["value"] == 2
    assert get(client, seeded["admin"], "summary", scope="global").json()["indexed_documents"]["value"] == 2


def _metric(db, created_at, latency=1000, status=200, architectures=("rag",)):
    db.add(RequestMetric(kind="chat", path="/api/chat", method="POST", status_code=status, latency_ms=latency,
                         user_role="patient", mode_requested="auto", architectures_used=list(architectures),
                         created_at=created_at))


NOW = datetime(2026, 10, 20, 15, 0, tzinfo=timezone.utc)


def test_percentage_change_only_when_history_covers_previous_period(db, users):
    _metric(db, NOW - timedelta(hours=5))
    _metric(db, NOW - timedelta(hours=4))
    db.commit()
    summary = DashboardAnalytics(db, users["admin"], "global", now=NOW).summary(days=1)
    assert summary.requests_today.value == 2
    assert summary.requests_today.change_pct is None  # no data before today: nothing to compare with
    assert summary.avg_response_ms.change_pct is None

    _metric(db, NOW - timedelta(days=4))  # history now reaches back past both comparison periods
    _metric(db, NOW - timedelta(days=1, hours=5), latency=500)
    _metric(db, NOW - timedelta(days=1, hours=4), latency=500, architectures=("rag", "cag"))
    _metric(db, NOW - timedelta(hours=3), status=502, architectures=())
    db.commit()
    summary = DashboardAnalytics(db, users["admin"], "global", now=NOW).summary(days=1)
    assert summary.requests_today.value == 3
    assert summary.requests_today.previous == 2
    assert summary.requests_today.change_pct == 50.0
    assert summary.failed_today == 1
    assert summary.avg_response_ms.value == 1000
    assert summary.avg_response_ms.previous == 500
    assert summary.avg_response_ms.change_pct == 100.0


def test_days_are_bucketed_in_the_client_timezone(db, users):
    _metric(db, datetime(2026, 10, 20, 23, 30, tzinfo=timezone.utc))
    db.commit()
    now = datetime(2026, 10, 21, 6, 0, tzinfo=timezone.utc)
    utc = DashboardAnalytics(db, users["admin"], "global", now=now).activity(days=2)
    paris = DashboardAnalytics(db, users["admin"], "global", tz_offset_minutes=60, now=now).activity(days=2)
    assert [(str(p.date), p.requests) for p in utc.points] == [("2026-10-20", 1), ("2026-10-21", 0)]
    assert [(str(p.date), p.requests) for p in paris.points] == [("2026-10-20", 0), ("2026-10-21", 1)]


@pytest.mark.parametrize("days", [7, 30, 90])
def test_activity_series_length_matches_range(client, users, days):
    points = get(client, users["patient"], "activity", days=days).json()["points"]
    assert len(points) == days
    assert points == sorted(points, key=lambda p: p["date"])
