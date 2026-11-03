import struct
import zlib

from app.models import Notification, User
from app.services.avatars import sanitise
from app.tests.conftest import auth


def login(client, email="patient@test.local", password="password123"):
    response = client.post("/api/auth/login", json={"email": email, "password": password})
    assert response.status_code == 200, response.text
    return {"Authorization": f"Bearer {response.json()['access_token']}"}


def png_with_text() -> bytes:
    def chunk(kind: bytes, data: bytes) -> bytes:
        return struct.pack(">I", len(data)) + kind + data + struct.pack(">I", zlib.crc32(kind + data) & 0xFFFFFFFF)

    ihdr = struct.pack(">IIBBBBB", 1, 1, 8, 2, 0, 0, 0)
    pixels = zlib.compress(b"\x00\xff\x00\x00")
    return (
        b"\x89PNG\r\n\x1a\n"
        + chunk(b"IHDR", ihdr)
        + chunk(b"tEXt", b"Location\x00GPS 48.85,2.35")
        + chunk(b"IDAT", pixels)
        + chunk(b"IEND", b"")
    )


def jpeg_with_exif() -> bytes:
    app0 = b"\xff\xe0" + struct.pack(">H", 16) + b"JFIF\x00\x01\x01\x00\x00\x01\x00\x01\x00\x00"
    exif_payload = b"Exif\x00\x00GPSLatitude=48.85"
    app1 = b"\xff\xe1" + struct.pack(">H", len(exif_payload) + 2) + exif_payload
    sos = b"\xff\xda" + struct.pack(">H", 8) + b"\x01\x01\x00\x00\x3f\x00" + b"\x12\x34\x56"
    return b"\xff\xd8" + app0 + app1 + sos + b"\xff\xd9"


def test_profile_update_and_phone_validation(client, users):
    headers = auth(users["patient"])
    response = client.patch(
        "/api/account/profile",
        json={"full_name": "Jane Patient", "phone": "+33 6 12 34 56 78", "job_title": "Teacher",
              "department": "Outpatients", "preferred_language": "en"},
        headers=headers,
    )
    assert response.status_code == 200
    body = response.json()
    assert body["full_name"] == "Jane Patient" and body["phone"] == "+33 6 12 34 56 78"
    assert body["preferred_language"] == "en" and body["department"] == "Outpatients"

    assert client.patch("/api/account/profile", json={"phone": "call me"}, headers=headers).status_code == 422
    assert client.patch("/api/account/profile", json={"phone": "123"}, headers=headers).status_code == 422
    cleared = client.patch("/api/account/profile", json={"phone": ""}, headers=headers).json()
    assert cleared["phone"] is None


def test_profile_cannot_change_role_or_email(client, users, db):
    headers = auth(users["patient"])
    client.patch("/api/account/profile", json={"role": "admin", "email": "x@evil.test", "full_name": "P"},
                 headers=headers)
    db.expire_all()
    user = db.get(User, users["patient"].id)
    assert user.role == "patient" and user.email == "patient@test.local"


def test_password_change_requires_current_and_revokes_other_sessions(client, users, db):
    other_device = login(client)
    this_device = login(client)
    wrong = client.post("/api/account/password", json={"current_password": "nope", "new_password": "new-pass-123"},
                        headers=this_device)
    assert wrong.status_code == 400
    same = client.post("/api/account/password",
                       json={"current_password": "password123", "new_password": "password123"}, headers=this_device)
    assert same.status_code == 400

    changed = client.post("/api/account/password",
                          json={"current_password": "password123", "new_password": "new-pass-123"},
                          headers=this_device)
    assert changed.status_code == 200
    fresh = {"Authorization": f"Bearer {changed.json()['access_token']}"}
    assert client.get("/api/account", headers=fresh).status_code == 200
    assert client.get("/api/account", headers=other_device).status_code == 401
    assert client.get("/api/account", headers=this_device).status_code == 401
    assert client.post("/api/auth/login", json={"email": "patient@test.local", "password": "password123"}).status_code == 401
    login(client, password="new-pass-123")
    titles = [n.title for n in db.query(Notification).filter_by(user_id=users["patient"].id)]
    assert "Password changed" in titles


def test_password_change_is_throttled(client, users):
    headers = auth(users["staff"])
    for _ in range(5):
        client.post("/api/account/password", json={"current_password": "bad", "new_password": "new-pass-123"},
                    headers=headers)
    blocked = client.post("/api/account/password",
                          json={"current_password": "password123", "new_password": "new-pass-123"}, headers=headers)
    assert blocked.status_code == 429


def test_sign_out_other_sessions(client, users):
    old = login(client)
    response = client.post("/api/account/sessions/revoke", headers=old)
    assert response.status_code == 200
    assert client.get("/api/account", headers=old).status_code == 401
    assert client.get("/api/account", headers={"Authorization": f"Bearer {response.json()['access_token']}"}).status_code == 200


def test_admin_password_reset_signs_user_out(client, users):
    session = login(client)
    client.patch(f"/api/admin/users/{users['patient'].id}", json={"password": "reset-pass-1"}, headers=auth(users["admin"]))
    assert client.get("/api/account", headers=session).status_code == 401


def test_metadata_is_stripped():
    clean_png, kind = sanitise(png_with_text())
    assert kind == "png" and b"GPS" not in clean_png and b"IDAT" in clean_png
    clean_jpg, kind = sanitise(jpeg_with_exif())
    assert kind == "jpg" and b"Exif" not in clean_jpg and b"JFIF" in clean_jpg and clean_jpg.endswith(b"\xff\xd9")


def test_avatar_upload_serve_replace_delete(client, users, services):
    headers = auth(users["patient"])
    response = client.put("/api/account/avatar", files={"file": ("me.png", png_with_text(), "image/png")}, headers=headers)
    assert response.status_code == 200
    url = response.json()["avatar_url"]
    assert url.startswith("/api/avatars/") and url.endswith(".png")
    served = client.get(url)
    assert served.status_code == 200 and served.headers["content-type"] == "image/png"
    assert b"GPS" not in served.content

    replaced = client.put("/api/account/avatar", files={"file": ("me.jpg", jpeg_with_exif(), "image/jpeg")},
                          headers=headers).json()["avatar_url"]
    assert replaced != url and client.get(url).status_code == 404  # old file removed
    assert client.delete("/api/account/avatar", headers=headers).json()["avatar_url"] is None
    assert client.get(replaced).status_code == 404
    assert not any(services.settings.avatar_dir.glob("*"))


def test_avatar_rejects_bad_files(client, users):
    headers = auth(users["patient"])
    svg = b"<svg xmlns='http://www.w3.org/2000/svg'><script>alert(1)</script></svg>"
    assert client.put("/api/account/avatar", files={"file": ("x.svg", svg, "image/svg+xml")}, headers=headers).status_code == 422
    fake = b"MZ" + b"\x00" * 100
    assert client.put("/api/account/avatar", files={"file": ("x.png", fake, "image/png")}, headers=headers).status_code == 422
    big = b"\x89PNG\r\n\x1a\n" + b"\x00" * (2 * 1024 * 1024 + 10)
    assert client.put("/api/account/avatar", files={"file": ("x.png", big, "image/png")}, headers=headers).status_code == 422
    assert client.get("/api/avatars/..%2F..%2Fsecret.png").status_code == 404
    assert client.put("/api/account/avatar", files={"file": ("x.png", png_with_text(), "image/png")}).status_code == 401
