"""create_admin command: makes an admin who can sign in, asks twice, refuses a taken name."""
from sqlalchemy.orm import Session
from test_auth import PW, login, mkuser

from app import create_admin as ca


def run(monkeypatch, db, *answers, args=("boss1", "Boss One")):
    monkeypatch.setattr(ca, "Session", lambda _engine: Session(bind=db))
    it = iter(answers)
    monkeypatch.setattr(ca, "getpass", lambda _prompt: next(it))
    return ca.main(list(args))


def test_creates_admin_who_can_sign_in(client, db, monkeypatch):
    assert run(monkeypatch, db, "a-long-password", "a-long-password") == 0
    r = login(client, "boss1", "a-long-password")
    assert r.status_code == 200 and r.json()["role"] == "admin" and not r.json()["must_change_password"]
    edit = db.exec_driver_sql("SELECT user_id, new_value FROM data_edits WHERE entity = 'user' AND field = 'account'").first()
    assert edit[1] == "created as admin"


def test_refuses_short_mismatched_and_taken(client, db, monkeypatch, capsys):
    assert run(monkeypatch, db, "short", "short") == 1
    assert run(monkeypatch, db, "a-long-password", "other-password") == 1
    mkuser(db, "boss1", "planner")
    assert run(monkeypatch, db, PW, PW) == 1
    assert "already exists" in capsys.readouterr().out
