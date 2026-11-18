from app.auth.router import MAX_FAILED_LOGINS
from tests.test_auth import PW, login, mkuser


def test_locked_after_five_failures_even_with_correct_password(client, db):
    mkuser(db, "Pat")
    for _ in range(MAX_FAILED_LOGINS):
        assert login(client, "pat", "wrong-password-1").status_code == 401
    refused = login(client, "PAT", PW)
    assert refused.status_code == 429
    assert "Too many failed sign-ins. Try again in" in refused.json()["detail"]


def test_success_before_the_limit_resets_the_count(client, db):
    mkuser(db, "pat")
    for _ in range(MAX_FAILED_LOGINS - 1):
        login(client, "pat", "wrong-password-1")
    assert login(client, "pat").status_code == 200
    assert login(client, "pat", "wrong-password-1").status_code == 401
