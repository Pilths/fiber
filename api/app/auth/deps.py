import hashlib
import os
from typing import Annotated

from fastapi import Cookie, Depends, Header, HTTPException
from pydantic import BaseModel
from sqlalchemy import text
from sqlalchemy.orm import Session

from app.db import get_db

COOKIE = "fiber_session"
USER_COLS = "u.id, u.username, u.display_name, u.role, u.must_change_password"


class PasswordChangeRequired(Exception):
    """Handled in main.py as 403 {"detail", "code": "password_change_required"}."""


class CurrentUser(BaseModel):
    id: int
    username: str
    display_name: str
    role: str
    must_change_password: bool = False


def hash_token(token: str) -> str:
    return hashlib.sha256(token.encode()).hexdigest()


def get_session_user(
    db: Annotated[Session, Depends(get_db)],
    x_dev_user: Annotated[str | None, Header()] = None,
    fiber_session: Annotated[str | None, Cookie()] = None,
) -> CurrentUser:
    """Cookie session; the X-Dev-User header works only when APP_ENV=development. No password-change gate."""
    if os.environ.get("APP_ENV") == "development" and x_dev_user:
        row = db.execute(text(f"SELECT {USER_COLS} FROM users u WHERE u.username = :u AND u.active"),
                         {"u": x_dev_user}).mappings().first()
        if row:
            return CurrentUser(**{**row, "must_change_password": False})  # dev header skips the forced change
    if fiber_session:
        row = db.execute(text(f"SELECT {USER_COLS} FROM sessions s JOIN users u ON u.id = s.user_id "
                              "WHERE s.id = :t AND s.expires_at > now() AND u.active"),
                         {"t": hash_token(fiber_session)}).mappings().first()
        if row:
            return CurrentUser(**row)
    raise HTTPException(401, "Not authenticated")


def get_current_user(user: Annotated[CurrentUser, Depends(get_session_user)]) -> CurrentUser:
    if user.must_change_password:
        raise PasswordChangeRequired
    return user


def require_admin(user: Annotated[CurrentUser, Depends(get_current_user)]) -> CurrentUser:
    if user.role != "admin":
        raise HTTPException(403, "Admin only")
    return user
