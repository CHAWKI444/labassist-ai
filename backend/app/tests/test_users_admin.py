from app.models import Conversation, Memory, Message, Notification, User
from app.tests.conftest import auth


def test_only_admin_manages_users(client, users):
    for role in ("patient", "staff"):
        headers = auth(users[role])
        assert client.get("/api/admin/users", headers=headers).status_code == 403
        assert client.post(f"/api/admin/users/{users['patient2'].id}/archive", headers=headers).status_code == 403
        assert client.delete(f"/api/admin/users/{users['patient2'].id}", headers=headers).status_code == 403


def test_user_cannot_escalate_own_privileges(client, users):
    headers = auth(users["patient"])
    me = client.patch("/api/auth/me", json={"role": "admin", "memory_enabled": True}, headers=headers)
    assert me.status_code == 200 and me.json()["role"] == "patient"
    assert client.patch(f"/api/admin/users/{users['patient'].id}", json={"role": "admin"}, headers=headers).status_code == 403


def test_list_search_and_filters(client, users):
    admin = auth(users["admin"])
    page = client.get("/api/admin/users", headers=admin).json()
    assert page["total"] == 4
    assert [u["email"] for u in client.get("/api/admin/users?search=STAFF@", headers=admin).json()["items"]] == [
        "staff@test.local"
    ]
    patients = client.get("/api/admin/users?role=patient", headers=admin).json()
    assert {u["role"] for u in patients["items"]} == {"patient"} and patients["total"] == 2
    client.post(f"/api/admin/users/{users['patient2'].id}/archive", headers=admin)
    archived = client.get("/api/admin/users?status=archived", headers=admin).json()["items"]
    assert [u["id"] for u in archived] == [users["patient2"].id]
    assert client.get("/api/admin/users?search=%25", headers=admin).json()["total"] == 0  # LIKE wildcards escaped


def test_detail_shows_counts_not_content(client, users, db):
    conversation = Conversation(user_id=users["patient"].id, title="Private")
    db.add(conversation)
    db.flush()
    db.add(Message(conversation_id=conversation.id, role="user", content="private question"))
    db.commit()
    detail = client.get(f"/api/admin/users/{users['patient'].id}", headers=auth(users["admin"])).json()
    assert detail["conversation_count"] == 1
    assert "private question" not in str(detail) and "Private" not in str(detail)


def test_role_change_notifies_and_protects_self(client, users, db):
    admin = auth(users["admin"])
    assert client.patch(f"/api/admin/users/{users['admin'].id}", json={"role": "staff"}, headers=admin).status_code == 400
    response = client.patch(f"/api/admin/users/{users['patient'].id}", json={"role": "staff"}, headers=admin)
    assert response.json()["role"] == "staff"
    titles = [n.title for n in db.query(Notification).filter_by(user_id=users["patient"].id)]
    assert "Your role was changed" in titles


def test_archive_blocks_login_and_restore_reenables(client, users):
    admin = auth(users["admin"])
    archived = client.post(f"/api/admin/users/{users['patient'].id}/archive", headers=admin).json()
    assert archived["status"] == "archived" and archived["archived_at"]
    login = client.post("/api/auth/login", json={"email": "patient@test.local", "password": "password123"})
    assert login.status_code == 403 and "archived" in login.json()["detail"]
    assert client.get("/api/auth/me", headers=auth(users["patient"])).status_code == 401  # existing token rejected

    restored = client.post(f"/api/admin/users/{users['patient'].id}/restore", headers=admin).json()
    assert restored["status"] == "active"
    assert client.post("/api/auth/login", json={"email": "patient@test.local", "password": "password123"}).status_code == 200


def test_cannot_archive_or_delete_self_or_last_admin(client, users, db):
    admin = auth(users["admin"])
    assert client.post(f"/api/admin/users/{users['admin'].id}/archive", headers=admin).status_code == 400
    assert client.delete(f"/api/admin/users/{users['admin'].id}", headers=admin).status_code == 400
    second = User(email="admin2@test.local", full_name="Admin 2", hashed_password="x", role="admin")
    db.add(second)
    db.commit()
    # With another admin present, the second one can be archived; the original then becomes the last admin.
    assert client.post(f"/api/admin/users/{second.id}/archive", headers=admin).status_code == 200


def test_delete_removes_personal_data(client, users, db):
    patient_id = users["patient2"].id
    conversation = Conversation(user_id=patient_id, title="To delete")
    db.add(conversation)
    db.flush()
    db.add(Message(conversation_id=conversation.id, role="user", content="hello"))
    db.add(Memory(user_id=patient_id, category="general_preference", content="pref", source="manual",
                  expires_at=conversation.created_at))
    db.add(Notification(user_id=patient_id, type="system", title="hi"))
    db.commit()

    assert client.delete(f"/api/admin/users/{patient_id}", headers=auth(users["admin"])).status_code == 204
    db.expire_all()
    assert db.get(User, patient_id) is None
    assert db.query(Conversation).filter_by(user_id=patient_id).count() == 0
    assert db.query(Message).count() == 0
    assert db.query(Memory).filter_by(user_id=patient_id).count() == 0
    assert db.query(Notification).filter_by(user_id=patient_id).count() == 0
