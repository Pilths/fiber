import os
import secrets
from datetime import UTC, datetime, timedelta
from typing import Annotated

from argon2 import PasswordHasher
from argon2.exceptions import InvalidHashError, VerificationError
from fastapi import APIRouter, Cookie, Depends, HTTPException, Response
from pydantic import BaseModel
from sqlalchemy import text
from sqlalchemy.orm import Session

from app.auth.deps import COOKIE, CurrentUser, get_session_user, hash_token
from app.db import get_db

router = APIRouter(prefix="/api")
DB = Annotated[Session, Depends(get_db)]
ph = PasswordHasher()
DUMMY_HASH = ph.hash("not-a-real-password")  # verified against for unknown users, so timing does not reveal them
MIN_PASSWORD = 10
BAD_LOGIN = HTTPException(401, "Wrong username or password")


class LoginBody(BaseModel):
    username: str
    password: str


class ChangePasswordBody(BaseModel):
    current_password: str
    new_password: str


def temp_password() -> str:
    return secrets.token_urlsafe(12)


def _verify(hash_: str | None, password: str) -> bool:
    try:
        return ph.verify(hash_ or DUMMY_HASH, password) and hash_ is not None
    except (VerificationError, InvalidHashError):
        return False


@router.post("/auth/login")
def login(db: DB, response: Response, body: LoginBody) -> CurrentUser:
    row = db.execute(text("SELECT id, username, display_name, role, must_change_password, password_hash, active "
                          "FROM users WHERE username = :u"), {"u": body.username}).mappings().first()
    ok = _verify(row["password_hash"] if row else None, body.password)
    if not (row and ok and row["active"]):
        raise BAD_LOGIN
    hours = float(os.environ.get("SESSION_HOURS", "12"))
    token = secrets.token_urlsafe(32)
    db.execute(text("INSERT INTO sessions (id, user_id, expires_at) VALUES (:i, :u, :e)"),
               {"i": hash_token(token), "u": row["id"], "e": datetime.now(UTC) + timedelta(hours=hours)})
    db.commit()
    response.set_cookie(COOKIE, token, max_age=int(hours * 3600), httponly=True, samesite="lax",
                        secure=os.environ.get("APP_ENV") == "production")
    return CurrentUser(**{k: row[k] for k in CurrentUser.model_fields})


@router.post("/auth/logout", status_code=204)
def logout(db: DB, response: Response, fiber_session: Annotated[str | None, Cookie()] = None) -> None:
    if fiber_session:
        db.execute(text("DELETE FROM sessions WHERE id = :i"), {"i": hash_token(fiber_session)})
        db.commit()
    response.delete_cookie(COOKIE)


@router.post("/auth/change-password", status_code=204)
def change_password(db: DB, user: Annotated[CurrentUser, Depends(get_session_user)], body: ChangePasswordBody) -> None:
    current = db.execute(text("SELECT password_hash FROM users WHERE id = :i"), {"i": user.id}).scalar_one()
    if not _verify(current, body.current_password):
        raise HTTPException(400, "Current password is wrong")
    if len(body.new_password) < MIN_PASSWORD:
        raise HTTPException(422, f"New password must be at least {MIN_PASSWORD} characters")
    if body.new_password == body.current_password:
        raise HTTPException(422, "New password must differ from the current one")
    db.execute(text("UPDATE users SET password_hash = :h, must_change_password = false WHERE id = :i"),
               {"h": ph.hash(body.new_password), "i": user.id})
    db.commit()


@router.get("/me")
def me(user: Annotated[CurrentUser, Depends(get_session_user)]) -> CurrentUser:
    return user
