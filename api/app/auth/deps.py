import os
from typing import Annotated

from fastapi import Depends, Header, HTTPException
from pydantic import BaseModel
from sqlalchemy import text
from sqlalchemy.orm import Session

from app.db import get_db


class CurrentUser(BaseModel):
    id: int
    username: str
    display_name: str
    role: str


def get_current_user(
    db: Annotated[Session, Depends(get_db)],
    x_dev_user: Annotated[str | None, Header()] = None,
) -> CurrentUser:
    """Dev-only sign-in by header; replaced by cookie sessions in TASK-034."""
    if os.environ.get("APP_ENV") == "development" and x_dev_user:
        row = db.execute(
            text("SELECT id, username, display_name, role FROM users WHERE username = :u AND active"),
            {"u": x_dev_user},
        ).mappings().first()
        if row:
            return CurrentUser(**row)
    raise HTTPException(401, "Not authenticated")


def require_admin(user: Annotated[CurrentUser, Depends(get_current_user)]) -> CurrentUser:
    if user.role != "admin":
        raise HTTPException(403, "Admin only")
    return user
