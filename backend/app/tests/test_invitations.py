import logging
from datetime import timedelta

from app.models import Invitation, Notification, User
from app.models.base import utcnow
from app.services.invitations import hash_token
from app.tests.conftest import auth


def invite(client, user, email="new.person@test.local", role="patient"):
    return client.post("/api/invitations", json={"email": email, "role": role}, headers=auth(user))


def accept(client, token, password="a-strong-pass", name="New Person"):
    return client.post(
        "/api/invitations/accept",
        json={"token": token, "full_name": name, "password": password, "accept_terms": True},
    )


def test_admin_invites_and_email_contains_single_use_link(client, users, mailer, db):
    response = invite(client, users["admin"], role="staff")
    assert response.status_code == 201
    body = response.json()
    assert body["status"] == "pending" and body["email_status"] == "sent" and body["send_count"] == 1
    assert "token" not in body and "token_hash" not in body

    token = mailer.last_token()
    assert mailer.sent[-1]["to"] == "new.person@test.local"
    assert "http://localhost:5173/invite#token=" in mailer.sent[-1]["text"]
    stored = db.get(Invitation, body["id"])
    assert stored.token_hash == hash_token(token) and token not in stored.token_hash

    preview = client.post("/api/invitations/verify", json={"token": token}).json()
    assert preview["email"] == "new.person@test.local" and preview["role"] == "staff"

    accepted = accept(client, token)
    assert accepted.status_code == 201
    assert accepted.json()["user"]["role"] == "staff" and accepted.json()["access_token"]
    assert accept(client, token).status_code == 410  # single use
    assert client.post("/api/invitations/verify", json={"token": token}).status_code == 410

    db.expire_all()
    assert db.get(Invitation, body["id"]).status == "accepted"
    inviter_titles = [n.title for n in db.query(Notification).filter_by(user_id=users["admin"].id)]
    assert "Invitation accepted" in inviter_titles


def test_role_restrictions(client, users):
    assert invite(client, users["patient"]).status_code == 403
    assert invite(client, users["staff"], role="staff").status_code == 403
    assert invite(client, users["staff"], role="admin").status_code == 403
    assert invite(client, users["staff"], role="patient").status_code == 201
    options = client.get("/api/invitations/options", headers=auth(users["staff"])).json()
    assert options["allowed_roles"] == ["patient"]


def test_role_comes_from_invitation_not_from_client(client, users, mailer):
    invite(client, users["staff"], role="patient")
    response = client.post(
        "/api/invitations/accept",
        json={"token": mailer.last_token(), "full_name": "X", "password": "a-strong-pass", "role": "admin",
              "accept_terms": True},
    )
    assert response.json()["user"]["role"] == "patient"


def test_terms_must_be_accepted_and_decline_notifies_inviter(client, users, mailer, db):
    invite(client, users["admin"], role="staff")
    token = mailer.last_token()
    refused = client.post("/api/invitations/accept",
                          json={"token": token, "full_name": "X", "password": "a-strong-pass"})
    assert refused.status_code == 422
    preview = client.post("/api/invitations/verify", json={"token": token}).json()
    assert preview["invited_by_name"] == users["admin"].full_name and preview["invited_by_role"] == "admin"
    assert client.post("/api/invitations/decline", json={"token": token}).status_code == 204
    assert client.post("/api/invitations/verify", json={"token": token}).status_code == 410
    titles = [n.title for n in db.query(Notification).filter_by(user_id=users["admin"].id)]
    assert "Invitation declined" in titles


def test_duplicates_rejected(client, users):
    assert invite(client, users["admin"]).status_code == 201
    assert invite(client, users["admin"]).status_code == 409
    assert invite(client, users["admin"], email="NEW.PERSON@test.local").status_code == 409
    assert invite(client, users["admin"], email="patient@test.local").status_code == 409  # existing account


def test_resend_rotates_token_and_cancel(client, users, mailer):
    invitation_id = invite(client, users["admin"]).json()["id"]
    first = mailer.last_token()
    resent = client.post(f"/api/invitations/{invitation_id}/resend", headers=auth(users["admin"])).json()
    assert resent["send_count"] == 2
    second = mailer.last_token()
    assert first != second
    assert client.post("/api/invitations/verify", json={"token": first}).status_code == 410
    assert client.post("/api/invitations/verify", json={"token": second}).status_code == 200

    cancelled = client.post(f"/api/invitations/{invitation_id}/cancel", headers=auth(users["admin"])).json()
    assert cancelled["status"] == "cancelled"
    assert accept(client, second).status_code == 410
    assert client.post(f"/api/invitations/{invitation_id}/resend", headers=auth(users["admin"])).status_code == 409


def test_expired_invitation_rejected_and_can_be_resent(client, users, mailer, db):
    invitation_id = invite(client, users["admin"]).json()["id"]
    token = mailer.last_token()
    invitation = db.get(Invitation, invitation_id)
    invitation.expires_at = utcnow() - timedelta(minutes=1)
    db.commit()

    assert accept(client, token).status_code == 410
    listed = client.get("/api/invitations?status=expired", headers=auth(users["admin"])).json()
    assert [i["id"] for i in listed] == [invitation_id]
    assert invite(client, users["admin"]).status_code == 201  # an expired invite no longer blocks a new one


def test_staff_only_see_their_own_invitations(client, users):
    admin_invite = invite(client, users["admin"], email="a@test.local").json()["id"]
    invite(client, users["staff"], email="b@test.local")
    staff_view = client.get("/api/invitations", headers=auth(users["staff"])).json()
    assert [i["email"] for i in staff_view] == ["b@test.local"]
    assert client.post(f"/api/invitations/{admin_invite}/cancel", headers=auth(users["staff"])).status_code == 404
    assert len(client.get("/api/invitations", headers=auth(users["admin"])).json()) == 2


def test_email_failure_is_reported_not_hidden(client, users, mailer):
    mailer.fail = True
    body = invite(client, users["admin"]).json()
    assert body["email_status"] == "failed" and "SMTP" in body["email_error"]


def test_public_registration_cancels_pending_invitation(client, users, mailer, db):
    invitation_id = invite(client, users["admin"]).json()["id"]
    token = mailer.last_token()
    client.post("/api/auth/register", json={"email": "new.person@test.local", "full_name": "N", "password": "password123"})
    db.expire_all()
    assert db.get(Invitation, invitation_id).status == "cancelled"
    assert accept(client, token).status_code == 410


def test_tokens_never_logged(client, users, mailer, caplog):
    caplog.set_level(logging.DEBUG)
    invite(client, users["admin"])
    token = mailer.last_token()
    client.post("/api/invitations/verify", json={"token": token})
    accept(client, token)
    assert token not in caplog.text
    assert hash_token(token) not in caplog.text
    assert "a-strong-pass" not in caplog.text


def test_bad_tokens_are_throttled(client):
    for _ in range(5):
        assert client.post("/api/invitations/verify", json={"token": "x" * 43}).status_code == 410
    assert client.post("/api/invitations/verify", json={"token": "y" * 43}).status_code == 429


def test_accepted_user_can_sign_in(client, users, mailer, db):
    invite(client, users["admin"], role="patient")
    accept(client, mailer.last_token(), password="another-pass1")
    login = client.post("/api/auth/login", json={"email": "new.person@test.local", "password": "another-pass1"})
    assert login.status_code == 200
    assert db.query(User).filter_by(email="new.person@test.local").one().role == "patient"
