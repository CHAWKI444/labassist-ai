from datetime import timedelta

import pytest

from app.models import Memory
from app.models.base import utcnow
from app.services.mag.extraction import extract_explicit_memory
from app.services.mag.sensitive import detect_sensitive
from app.tests.conftest import auth


@pytest.mark.parametrize(
    "text",
    [
        "my email is jane@example.com",
        "call me on +33 6 12 34 56 78",
        "I have diabetes",
        "je suis enceinte",
        "my glucose was 1.2 g/l",
        "mon mot de passe est secret",
        "أنا مريض بالسكري",
    ],
)
def test_sensitive_content_detected(text):
    assert detect_sensitive(text) is not None


def test_plain_preferences_allowed():
    assert detect_sensitive("I prefer short answers in English") is None
    assert detect_sensitive("je préfère venir le matin") is None


@pytest.mark.parametrize(
    "message,category",
    [
        ("Remember that I prefer short answers", "communication_style"),
        ("Souviens-toi que je préfère les réponses en arabe", "language_preference"),
        ("تذكر أنني أفضل المواعيد الصباحية", "general_preference"),
    ],
)
def test_explicit_extraction(message, category):
    candidate = extract_explicit_memory(message, 300)
    assert candidate is not None and candidate.category == category


def test_ordinary_question_is_not_memorised():
    assert extract_explicit_memory("What are your opening hours?", 300) is None


def test_memory_crud_and_isolation(client, users):
    owner, other = auth(users["patient"]), auth(users["patient2"])
    created = client.post("/api/memories", json={"content": "Prefers morning appointments"}, headers=owner)
    assert created.status_code == 201
    memory_id = created.json()["id"]

    assert [m["id"] for m in client.get("/api/memories", headers=owner).json()] == [memory_id]
    assert client.get("/api/memories", headers=other).json() == []
    assert client.get(f"/api/memories/{memory_id}", headers=other).status_code == 404
    assert client.patch(f"/api/memories/{memory_id}", json={"content": "hijack"}, headers=other).status_code == 404
    assert client.delete(f"/api/memories/{memory_id}", headers=other).status_code == 404

    updated = client.patch(f"/api/memories/{memory_id}", json={"content": "Prefers afternoon appointments"},
                           headers=owner)
    assert updated.json()["content"] == "Prefers afternoon appointments"
    assert client.delete(f"/api/memories/{memory_id}", headers=owner).status_code == 204
    assert client.get("/api/memories", headers=owner).json() == []


def test_sensitive_memory_rejected_via_api(client, users):
    response = client.post("/api/memories", json={"content": "I take insulin every day"}, headers=auth(users["patient"]))
    assert response.status_code == 422
    assert "Not stored" in response.json()["detail"]


def test_memory_requires_consent(client, users, db):
    user = db.get(type(users["patient"]), users["patient"].id)
    user.memory_enabled = False
    db.commit()
    response = client.post("/api/memories", json={"content": "short answers"}, headers=auth(users["patient"]))
    assert response.status_code == 409
    client.patch("/api/auth/me", json={"memory_enabled": True}, headers=auth(users["patient"]))
    assert client.post("/api/memories", json={"content": "short answers"}, headers=auth(users["patient"])).status_code == 201


def test_retention_purges_expired(services, db, users):
    db.add(Memory(user_id=users["patient"].id, category="general_preference", content="old", source="manual",
                  expires_at=utcnow() - timedelta(days=1)))
    db.add(Memory(user_id=users["patient"].id, category="general_preference", content="fresh", source="manual",
                  expires_at=utcnow() + timedelta(days=1)))
    db.commit()
    assert services.mag.purge_expired(db) == 1
    assert [m.content for m in services.mag.list_for_user(db, users["patient"].id)] == ["fresh"]


def test_memory_limit(services, db, users):
    services.settings.memory_max_per_user = 2
    services.mag.create(db, users["patient"], "general_preference", "pref one", "manual")
    services.mag.create(db, users["patient"], "general_preference", "pref two", "manual")
    with pytest.raises(ValueError, match="limit"):
        services.mag.create(db, users["patient"], "general_preference", "pref three", "manual")
