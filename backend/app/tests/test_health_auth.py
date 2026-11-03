from app.tests.conftest import auth


def test_health_reports_components(client):
    response = client.get("/api/health")
    assert response.status_code == 200
    body = response.json()
    assert body["database"]["ok"] is True
    assert body["ollama"]["reachable"] is True
    assert body["vector_index"]["vectors"] == 0


def test_register_always_creates_patient(client):
    response = client.post(
        "/api/auth/register",
        json={"email": "New@Test.local", "full_name": "New", "password": "password123", "role": "admin"},
    )
    assert response.status_code == 201
    user = response.json()["user"]
    assert user["role"] == "patient"
    assert user["email"] == "new@test.local"
    assert "hashed_password" not in user


def test_login_and_me(client, users):
    response = client.post("/api/auth/login", json={"email": "staff@test.local", "password": "password123"})
    assert response.status_code == 200
    token = response.json()["access_token"]
    me = client.get("/api/auth/me", headers={"Authorization": f"Bearer {token}"})
    assert me.json()["role"] == "staff"


def test_login_rejects_bad_password_and_throttles(client, users):
    for _ in range(5):
        assert client.post("/api/auth/login", json={"email": "admin@test.local", "password": "wrong-pass"}).status_code == 401
    blocked = client.post("/api/auth/login", json={"email": "admin@test.local", "password": "password123"})
    assert blocked.status_code == 429


def test_protected_endpoints_require_token(client):
    assert client.get("/api/conversations").status_code == 401
    assert client.get("/api/memories").status_code == 401
    assert client.get("/api/auth/me", headers={"Authorization": "Bearer not-a-token"}).status_code == 401


def test_role_based_access(client, users):
    patient, staff, admin = auth(users["patient"]), auth(users["staff"]), auth(users["admin"])
    assert client.get("/api/documents", headers=patient).status_code == 403
    assert client.get("/api/knowledge", headers=patient).status_code == 403
    assert client.get("/api/admin/users", headers=patient).status_code == 403
    assert client.get("/api/admin/users", headers=staff).status_code == 403
    assert client.get("/api/documents", headers=staff).status_code == 200
    assert client.get("/api/admin/users", headers=admin).status_code == 200


def test_inactive_user_rejected(client, users, db):
    user = db.get(type(users["patient"]), users["patient"].id)
    user.is_active = False
    db.commit()
    assert client.get("/api/auth/me", headers=auth(users["patient"])).status_code == 401


def test_admin_cannot_demote_self(client, users):
    response = client.patch(f"/api/admin/users/{users['admin'].id}", json={"role": "patient"}, headers=auth(users["admin"]))
    assert response.status_code == 400
    ok = client.patch(f"/api/admin/users/{users['patient'].id}", json={"role": "staff"}, headers=auth(users["admin"]))
    assert ok.json()["role"] == "staff"
