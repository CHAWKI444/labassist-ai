from app.models import Notification
from app.services.notifications import notify
from app.tests.conftest import auth


def seed(db, user_id, n=3):
    return [notify(db, user_id, "system", f"Notice {i}", f"Body {i}") for i in range(n)]


def test_list_unread_count_and_isolation(client, users, db):
    seed(db, users["patient"].id, 3)
    seed(db, users["patient2"].id, 1)
    page = client.get("/api/notifications", headers=auth(users["patient"])).json()
    assert page["total"] == 3 and page["unread"] == 3
    assert [n["title"] for n in page["items"]][0] == "Notice 2"  # newest first
    assert client.get("/api/notifications/unread-count", headers=auth(users["patient2"])).json() == {"unread": 1}


def test_mark_read_unread_and_all(client, users, db):
    first, *_ = seed(db, users["patient"].id, 3)
    headers = auth(users["patient"])
    assert client.post(f"/api/notifications/{first.id}/read", headers=headers).json()["read_at"]
    assert client.get("/api/notifications/unread-count", headers=headers).json()["unread"] == 2
    assert client.get("/api/notifications?filter=read", headers=headers).json()["total"] == 1
    client.post(f"/api/notifications/{first.id}/unread", headers=headers)
    assert client.get("/api/notifications/unread-count", headers=headers).json()["unread"] == 3
    assert client.post("/api/notifications/read-all", headers=headers).json() == {"unread": 0}
    assert client.get("/api/notifications?filter=unread", headers=headers).json()["items"] == []


def test_cannot_touch_other_users_notifications(client, users, db):
    other = notify(db, users["patient2"].id, "system", "Private")
    headers = auth(users["patient"])
    assert client.post(f"/api/notifications/{other.id}/read", headers=headers).status_code == 404
    client.post("/api/notifications/read-all", headers=headers)
    db.refresh(other)
    assert other.read_at is None


def test_pagination_and_type_filter(client, users, db):
    seed(db, users["patient"].id, 5)
    notify(db, users["patient"].id, "account", "Account change")
    headers = auth(users["patient"])
    page = client.get("/api/notifications?limit=2&offset=2", headers=headers).json()
    assert len(page["items"]) == 2 and page["total"] == 6
    account = client.get("/api/notifications?type=account", headers=headers).json()
    assert [n["title"] for n in account["items"]] == ["Account change"]


def test_admin_broadcast_reaches_active_users_only(client, users, db):
    client.post(f"/api/admin/users/{users['patient2'].id}/archive", headers=auth(users["admin"]))
    result = client.post("/api/admin/notifications/broadcast", json={"title": "Maintenance tonight", "roles": ["patient"]},
                         headers=auth(users["admin"])).json()
    assert result["recipients"] == 1
    assert db.query(Notification).filter_by(title="Maintenance tonight").one().user_id == users["patient"].id
    assert client.post("/api/admin/notifications/broadcast", json={"title": "x"},
                       headers=auth(users["staff"])).status_code == 403


def test_document_indexing_notifies_uploader(client, users, db):
    client.post("/api/documents", files={"file": ("doc.txt", b"Some laboratory procedure text for indexing.")},
                data={"visibility": "staff"}, headers=auth(users["staff"]))
    titles = [n.title for n in db.query(Notification).filter_by(user_id=users["staff"].id)]
    assert "Document indexed" in titles


def test_registration_creates_welcome_notification(client):
    token = client.post("/api/auth/register", json={"email": "w@test.local", "full_name": "W",
                                                    "password": "password123"}).json()["access_token"]
    page = client.get("/api/notifications", headers={"Authorization": f"Bearer {token}"}).json()
    assert page["items"][0]["title"] == "Welcome to LabAssist AI"
