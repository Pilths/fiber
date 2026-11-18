import logging
import os
import secrets
import threading
import time
from datetime import UTC, datetime, timedelta
from typing import Annotated

from argon2 import PasswordHasher
from argon2.exceptions import InvalidHashError, VerificationError
from fastapi import APIRouter, Cookie, Depends, HTTPException, Request, Response
from pydantic import BaseModel
from sqlalchemy import text

from app.auth.deps import COOKIE, DB, CurrentUser, get_session_user, hash_token
from app.environment import cookie_secure, session_hours

logger = logging.getLogger("app.auth")
router = APIRouter(prefix="/api")
ph = PasswordHasher()
DUMMY_HASH = ph.hash("not-a-real-password")  # verified against for unknown users, so timing does not reveal them
MIN_PASSWORD = 8  # temporary, while the dashboard is in trial use
MAX_FAILED_LOGINS = 5
# Higher for an address than a username: one office can reach the API from one shared address.
MAX_FAILED_LOGINS_PER_CLIENT = 20
FAILED_LOGIN_WINDOW_SECONDS = 15 * 60
# ponytail: kept in this process only, so it resets on restart and is counted per worker;
# move to a DB table if more workers are added.
_failed_logins: dict[str, list[float]] = {}
_failed_logins_lock = threading.Lock()
BAD_LOGIN = HTTPException(401, "Wrong username or password")

SELECT_USER_FOR_LOGIN = """
    SELECT id, username, display_name, role, must_change_password, password_hash, active
    FROM users
    WHERE username = :username
"""
INSERT_SESSION = "INSERT INTO sessions (id, user_id, expires_at) VALUES (:session_id, :user_id, :expires_at)"
DELETE_EXPIRED_SESSIONS = "DELETE FROM sessions WHERE expires_at < now()"
DELETE_SESSION = "DELETE FROM sessions WHERE id = :session_id"
SELECT_PASSWORD_HASH = "SELECT password_hash FROM users WHERE id = :user_id"
UPDATE_PASSWORD = "UPDATE users SET password_hash = :password_hash, must_change_password = false WHERE id = :user_id"


class LoginBody(BaseModel):
    username: str
    password: str


class ChangePasswordBody(BaseModel):
    current_password: str
    new_password: str


def temp_password() -> str:
    return secrets.token_urlsafe(12)


def clear_login_throttle() -> None:
    with _failed_logins_lock:
        _failed_logins.clear()


def _recent_failures(key: str, now: float) -> list[float]:
    recent = [at for at in _failed_logins.get(key, []) if now - at < FAILED_LOGIN_WINDOW_SECONDS]
    if recent:
        _failed_logins[key] = recent
    else:
        _failed_logins.pop(key, None)
    return recent


def _limit_for(key: str) -> int:
    if key.startswith("client:"):
        return MAX_FAILED_LOGINS_PER_CLIENT
    return MAX_FAILED_LOGINS


def _check_throttle(keys: list[str]) -> None:
    now = time.monotonic()
    with _failed_logins_lock:
        for key in keys:
            recent = _recent_failures(key, now)
            if len(recent) >= _limit_for(key):
                minutes = max(1, int((recent[0] + FAILED_LOGIN_WINDOW_SECONDS - now) / 60) + 1)
                raise HTTPException(429, f"Too many failed sign-ins. Try again in {minutes} minutes.")


def _record_failure(keys: list[str]) -> None:
    now = time.monotonic()
    with _failed_logins_lock:
        for key in keys:
            _recent_failures(key, now)
            _failed_logins.setdefault(key, []).append(now)


def _verify(password_hash: str | None, password: str) -> bool:
    try:
        return ph.verify(password_hash or DUMMY_HASH, password) and password_hash is not None
    except (VerificationError, InvalidHashError):
        return False


@router.post("/auth/login")
def login(db: DB, request: Request, response: Response, body: LoginBody) -> CurrentUser:
    client = request.client.host if request.client else "unknown"
    user_key = f"user:{body.username.lower()}"
    throttle_keys = [user_key, f"client:{client}"]
    _check_throttle(throttle_keys)
    row = db.execute(text(SELECT_USER_FOR_LOGIN), {"username": body.username}).mappings().first()
    password_ok = _verify(row["password_hash"] if row else None, body.password)
    if not (row and password_ok and row["active"]):
        _record_failure(throttle_keys)
        logger.warning("login failed username=%r client=%s", body.username, client)
        raise BAD_LOGIN
    with _failed_logins_lock:
        _failed_logins.pop(user_key, None)
    hours = session_hours()
    token = secrets.token_urlsafe(32)
    session = {
        "session_id": hash_token(token),
        "user_id": row["id"],
        "expires_at": datetime.now(UTC) + timedelta(hours=hours),
    }
    db.execute(text(DELETE_EXPIRED_SESSIONS))
    db.execute(text(INSERT_SESSION), session)
    db.commit()
    response.set_cookie(
        COOKIE, token, max_age=int(hours * 3600), httponly=True, samesite="lax", secure=cookie_secure(),
    )
    return CurrentUser(**{name: row[name] for name in CurrentUser.model_fields})


@router.post("/auth/logout", status_code=204)
def logout(db: DB, response: Response, fiber_session: Annotated[str | None, Cookie()] = None) -> None:
    if fiber_session:
        db.execute(text(DELETE_SESSION), {"session_id": hash_token(fiber_session)})
        db.commit()
    response.delete_cookie(COOKIE)


@router.post("/auth/change-password", status_code=204)
def change_password(
    db: DB,
    user: Annotated[CurrentUser, Depends(get_session_user)],
    body: ChangePasswordBody,
) -> None:
    current = db.execute(text(SELECT_PASSWORD_HASH), {"user_id": user.id}).scalar_one()
    if not _verify(current, body.current_password):
        raise HTTPException(400, "Current password is wrong")
    if len(body.new_password) < MIN_PASSWORD:
        raise HTTPException(422, f"New password must be at least {MIN_PASSWORD} characters")
    if body.new_password == body.current_password:
        raise HTTPException(422, "New password must differ from the current one")
    db.execute(text(UPDATE_PASSWORD), {"password_hash": ph.hash(body.new_password), "user_id": user.id})
    db.commit()


@router.get("/me")
def me(user: Annotated[CurrentUser, Depends(get_session_user)]) -> CurrentUser:
    return user
