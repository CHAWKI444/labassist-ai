from app.tests.conftest import auth


def test_stats_reflect_real_counts(client, users):
    admin = auth(users["admin"])
    client.post("/api/invitations", json={"email": "invitee@test.local", "role": "patient"}, headers=admin)
    client.post(f"/api/admin/users/{users['patient2'].id}/archive", headers=admin)
    stats = client.get("/api/admin/users/stats", headers=admin).json()
    assert stats["total"] == 4 and stats["active"] == 3 and stats["archived"] == 1
    assert stats["pending_invitations"] == 1 and stats["new_last_30_days"] == 4


def test_department_filter_export_and_bulk(client, users):
    admin = auth(users["admin"])
    client.patch(f"/api/admin/users/{users['staff'].id}", json={"department": "Biochemistry", "job_title": "Technician"},
                 headers=admin)
    page = client.get("/api/admin/users?department=Biochemistry", headers=admin).json()
    assert [u["email"] for u in page["items"]] == ["staff@test.local"]
    assert page["items"][0]["job_title"] == "Technician"
    assert client.get("/api/admin/users/stats", headers=admin).json()["departments"] == ["Biochemistry"]

    csv_response = client.get("/api/admin/users/export.csv?role=staff", headers=admin)
    assert csv_response.headers["content-type"].startswith("text/csv")
    body = csv_response.text
    assert "staff@test.local" in body and "patient@test.local" not in body and "hashed_password" not in body
    assert "$2b$" not in body  # no bcrypt hashes

    result = client.post("/api/admin/users/bulk",
                         json={"ids": [users["patient"].id, users["admin"].id], "action": "archive"},
                         headers=admin).json()
    assert result["updated"] == [users["patient"].id]
    assert str(users["admin"].id) in result["skipped"]  # cannot archive yourself
    assert client.get("/api/admin/users/export.csv", headers=auth(users["staff"])).status_code == 403


def test_login_reports_remaining_attempts(client, users):
    for expected in (4, 3):
        response = client.post("/api/auth/login", json={"email": "staff@test.local", "password": "wrong-pass"})
        assert response.status_code == 401
    assert "3 attempt(s) remaining" in response.json()["detail"]
