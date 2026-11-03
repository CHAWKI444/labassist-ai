from app.tests.conftest import auth


def ask(client, user, message, conversation_id=None):
    payload = {"message": message, "mode": "auto", "language": "en"}
    if conversation_id:
        payload["conversation_id"] = conversation_id
    response = client.post("/api/chat", json=payload, headers=auth(user))
    assert response.status_code == 200, response.text
    return response.json()["conversation_id"]


def test_history_is_per_user_and_persistent(client, users):
    first = ask(client, users["patient"], "Hello about urine samples")
    ask(client, users["patient"], "And the results delay?", conversation_id=first)
    ask(client, users["patient2"], "Hello from another patient")

    mine = client.get("/api/conversations", headers=auth(users["patient"])).json()
    assert [c["id"] for c in mine] == [first]
    assert mine[0]["message_count"] == 4 and mine[0]["last_message_preview"]
    assert {"title", "created_at", "updated_at"} <= mine[0].keys()

    # A fresh login (new token) sees the same stored history.
    token = client.post("/api/auth/login", json={"email": "patient@test.local", "password": "password123"}).json()
    again = client.get("/api/conversations", headers={"Authorization": f"Bearer {token['access_token']}"}).json()
    assert [c["id"] for c in again] == [first]
    detail = client.get(f"/api/conversations/{first}", headers=auth(users["patient"])).json()
    assert [m["role"] for m in detail["messages"]] == ["user", "assistant", "user", "assistant"]


def test_search_titles_and_message_content(client, users):
    a = ask(client, users["patient"], "Question about fasting")
    ask(client, users["patient"], "Question about parking")
    ask(client, users["patient2"], "Another fasting question")
    headers = auth(users["patient"])
    hits = client.get("/api/conversations?q=FASTING", headers=headers).json()
    assert [c["id"] for c in hits] == [a]
    assert "fasting" in hits[0]["match_excerpt"].lower()
    assert client.get("/api/conversations?q=%25", headers=headers).json() == []


def test_other_users_and_admins_cannot_access_private_conversations(client, users):
    conversation_id = ask(client, users["patient"], "My private question")
    for intruder in ("patient2", "staff", "admin"):
        headers = auth(users[intruder])
        assert client.get(f"/api/conversations/{conversation_id}", headers=headers).status_code == 404
        assert client.patch(f"/api/conversations/{conversation_id}", json={"title": "x"}, headers=headers).status_code == 404
        assert client.delete(f"/api/conversations/{conversation_id}", headers=headers).status_code == 404
        assert client.get("/api/conversations?q=private", headers=headers).json() == []


def test_owner_can_rename_and_delete(client, users):
    conversation_id = ask(client, users["patient"], "Rename me")
    headers = auth(users["patient"])
    renamed = client.patch(f"/api/conversations/{conversation_id}", json={"title": "Fasting questions"}, headers=headers)
    assert renamed.json()["title"] == "Fasting questions"
    assert client.delete(f"/api/conversations/{conversation_id}", headers=headers).status_code == 204
    assert client.get("/api/conversations", headers=headers).json() == []
