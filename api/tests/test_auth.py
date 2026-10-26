import pytest
from argon2 import PasswordHasher
from sqlalchemy import text

from app.main import app

PW = "correct-horse-battery"
DEV = {"X-Dev-User": "planner1"}


def mkuser(db, name, role="planner", must_change=False, active=True, pw=PW):
    return db.execute(
        text("INSERT INTO users (username, display_name, role, password_hash, must_change_password, active) "
             "VALUES (:u, :u, :r, :h, :m, :a) RETURNING id"),
        dict(u=name, r=role, h=PasswordHasher().hash(pw), m=must_change, a=active)).scalar_one()


def login(client, name, pw=PW):
    return client.post("/api/auth/login", json={"username": name, "password": pw})


def sessions(db, uid):
    return db.execute(text("SELECT count(*) FROM sessions WHERE user_id = :u"), dict(u=uid)).scalar_one()


def test_login_sets_httponly_cookie_and_me_works(client, db):
    mkuser(db, "pat")
    r = login(client, "pat")
    assert r.status_code == 200 and r.json()["username"] == "pat"
    cookie = r.headers["set-cookie"].lower()
    assert "httponly" in cookie and "samesite=lax" in cookie and "secure" not in cookie
    assert client.get("/api/me").json()["username"] == "pat"


def test_wrong_password_and_unknown_user_look_the_same(client, db):
    mkuser(db, "pat")
    a, b = login(client, "pat", "wrong-password-1"), login(client, "nobody")
    assert a.status_code == b.status_code == 401 and a.json() == b.json()
    assert "set-cookie" not in a.headers


def test_deactivated_user_cannot_log_in(client, db):
    mkuser(db, "gone", active=False)
    r = login(client, "gone")
    assert r.status_code == 401 and r.json() == login(client, "nobody").json()


def test_logout_invalidates_session(client, db):
    uid = mkuser(db, "pat")
    login(client, "pat")
    assert client.post("/api/auth/logout").status_code == 204
    assert sessions(db, uid) == 0
    client.cookies.clear()
    assert client.get("/api/me").status_code == 401


def test_expired_session_is_401(client, db):
    uid = mkuser(db, "pat")
    login(client, "pat")
    db.execute(text("UPDATE sessions SET expires_at = now() - interval '1 minute' WHERE user_id = :u"), dict(u=uid))
    assert client.get("/api/me").status_code == 401


def test_dev_header_only_in_development(client, db, monkeypatch):
    mkuser(db, "planner1")
    assert client.get("/api/me", headers=DEV).status_code == 200
    monkeypatch.setenv("APP_ENV", "production")
    assert client.get("/api/me", headers=DEV).status_code == 401
    assert "secure" in login(client, "planner1").headers["set-cookie"].lower()


def test_new_user_forced_to_change_password(client, db):
    mkuser(db, "newbie", must_change=True)
    assert login(client, "newbie").json()["must_change_password"] is True
    assert client.get("/api/me").json()["must_change_password"] is True
    r = client.get("/api/needs-review")
    assert r.status_code == 403 and r.json() == {"detail": "Password change required", "code": "password_change_required"}
    body = {"current_password": PW, "new_password": PW}
    assert client.post("/api/auth/change-password", json=body).status_code == 422  # same password
    assert client.post("/api/auth/change-password", json={**body, "new_password": "short"}).status_code == 422
    assert client.post("/api/auth/change-password", json={**body, "current_password": "nope-nope-nope"}).status_code == 400
    assert client.post("/api/auth/change-password", json={**body, "new_password": "a-brand-new-pass"}).status_code == 204
    assert client.get("/api/needs-review").status_code == 200  # same session still works
    client.cookies.clear()
    assert login(client, "newbie", "a-brand-new-pass").status_code == 200


def test_planner_gets_403_on_every_admin_route(client, db):
    mkuser(db, "pat")
    login(client, "pat")
    routes = [(m.upper(), p) for p, ops in app.openapi()["paths"].items() if p.startswith("/api/admin") for m in ops]
    assert len(routes) >= 5
    for m, p in routes:
        assert client.request(m, p.replace("{user_id}", "1")).status_code == 403, (m, p)


@pytest.fixture
def admin(client, db):
    aid = mkuser(db, "boss", "admin")
    login(client, "boss")
    return aid


def test_admin_creates_user_with_one_time_password(client, db, admin):
    r = client.post("/api/admin/users", json={"username": "kim", "role": "planner"})
    assert r.status_code == 201
    u = r.json()
    assert u["must_change_password"] is True and u["temporary_password"]
    assert "temporary_password" not in client.get("/api/admin/users").text
    assert client.post("/api/admin/users", json={"username": "kim", "role": "planner"}).status_code == 409
    assert db.execute(text("SELECT user_id FROM data_edits WHERE entity = 'user' AND entity_id = :i"),
                      dict(i=u["id"])).scalar_one() == admin
    client.cookies.clear()
    assert login(client, "kim", u["temporary_password"]).json()["must_change_password"] is True


def test_reset_password_and_deactivate_delete_sessions(client, db, admin):
    uid = mkuser(db, "kim")
    db.execute(text("INSERT INTO sessions (id, user_id, expires_at) VALUES ('x', :u, now() + interval '1 hour')"), dict(u=uid))
    r = client.post(f"/api/admin/users/{uid}/reset-password")
    assert r.status_code == 200 and r.json()["must_change_password"] is True and r.json()["temporary_password"]
    assert sessions(db, uid) == 0
    db.execute(text("INSERT INTO sessions (id, user_id, expires_at) VALUES ('y', :u, now() + interval '1 hour')"), dict(u=uid))
    assert client.post(f"/api/admin/users/{uid}/deactivate").json()["active"] is False
    assert sessions(db, uid) == 0


def test_admin_cannot_deactivate_self_and_activate_restores(client, db, admin):
    assert client.post(f"/api/admin/users/{admin}/deactivate").status_code == 409
    uid = mkuser(db, "kim")
    client.post(f"/api/admin/users/{uid}/deactivate")
    client.cookies.clear()
    assert login(client, "kim").status_code == 401
    login(client, "boss")
    assert client.post(f"/api/admin/users/{uid}/activate").json()["active"] is True
    client.cookies.clear()
    assert login(client, "kim").status_code == 200
