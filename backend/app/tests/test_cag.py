from datetime import date, timedelta

from app.models import KnowledgeItem
from app.tests.conftest import auth


def create_item(client, user, **overrides):
    payload = {"title": "Opening hours", "content": "Open Monday to Friday 7:00-18:00.", "visibility": "public"}
    payload.update(overrides)
    response = client.post("/api/knowledge", json=payload, headers=auth(user))
    assert response.status_code == 201, response.text
    return response.json()


def test_draft_items_are_not_in_context(client, users, services, db):
    create_item(client, users["staff"])
    lookup = services.cag.get_context(db, "public")
    assert lookup.context.items == []
    assert lookup.context.text == ""


def test_approval_bumps_version_and_builds_context(client, users, services, db):
    item = create_item(client, users["staff"])
    assert client.post(f"/api/knowledge/{item['id']}/approve", headers=auth(users["staff"])).status_code == 403
    assert client.post(f"/api/knowledge/{item['id']}/approve", headers=auth(users["admin"])).status_code == 200

    first = services.cag.get_context(db, "public")
    assert first.reused is False and first.source == "built"
    assert first.context.kb_version == 1
    assert f"[KB{item['id']}]" in first.context.text

    second = services.cag.get_context(db, "public")
    assert second.reused is True and second.source == "memory"
    assert second.context.content_hash == first.context.content_hash


def test_context_survives_restart_via_database(client, users, services, db):
    item = create_item(client, users["admin"])
    client.post(f"/api/knowledge/{item['id']}/approve", headers=auth(users["admin"]))
    services.cag.get_context(db, "public")
    services.cag.invalidate()  # simulate process restart (in-memory cache lost)
    lookup = services.cag.get_context(db, "public")
    assert lookup.reused is True and lookup.source == "database"


def test_edit_invalidates_context(client, users, services, db):
    item = create_item(client, users["admin"])
    client.post(f"/api/knowledge/{item['id']}/approve", headers=auth(users["admin"]))
    old = services.cag.get_context(db, "public").context

    client.patch(f"/api/knowledge/{item['id']}", json={"content": "Open Monday to Saturday."},
                 headers=auth(users["admin"]))
    new = services.cag.get_context(db, "public")
    assert new.reused is False
    assert new.context.kb_version == old.kb_version + 1
    assert "Saturday" in new.context.text


def test_staff_edit_of_approved_item_requires_reapproval(client, users, services, db):
    item = create_item(client, users["admin"])
    client.post(f"/api/knowledge/{item['id']}/approve", headers=auth(users["admin"]))
    edited = client.patch(f"/api/knowledge/{item['id']}", json={"content": "Changed by staff"},
                          headers=auth(users["staff"])).json()
    assert edited["status"] == "draft"
    assert services.cag.get_context(db, "public").context.items == []


def test_audience_separation_and_outdated_flag(client, users, services, db):
    public = create_item(client, users["admin"], title="Prices", content="Lipid panel 25 EUR",
                         review_due=(date.today() - timedelta(days=1)).isoformat())
    staff = create_item(client, users["admin"], title="Centrifuge", content="3000 g for 10 minutes",
                        visibility="staff")
    for item in (public, staff):
        client.post(f"/api/knowledge/{item['id']}/approve", headers=auth(users["admin"]))

    public_ctx = services.cag.get_context(db, "public").context
    staff_ctx = services.cag.get_context(db, "staff").context
    assert [i.id for i in public_ctx.items] == [public["id"]]
    assert {i.id for i in staff_ctx.items} == {public["id"], staff["id"]}
    assert public_ctx.outdated_item_ids == [public["id"]]
    assert "REVIEW OVERDUE" in public_ctx.text


def test_token_budget_excludes_items(services, db, users):
    services.settings.cag_max_context_tokens = 120
    for i in range(5):
        db.add(KnowledgeItem(title=f"Item {i}", content="x " * 100, status="approved", priority=i))
    db.commit()
    services.cag.bump_version(db, "test", users["admin"].id)
    ctx = services.cag.get_context(db, "public").context
    assert ctx.token_estimate <= 120
    assert len(ctx.excluded_item_ids) >= 4


def test_cag_status_endpoint_explains_reuse(client, users):
    body = client.get("/api/knowledge/cag/status", headers=auth(users["staff"])).json()
    assert "KV-cache" in body["reuse_explanation"] or "KV" in body["reuse_explanation"]
    assert body["max_context_tokens"] <= body["model_num_ctx"]
