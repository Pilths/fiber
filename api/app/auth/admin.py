from datetime import datetime
from typing import Annotated, Literal

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy import text
from sqlalchemy.orm import Session

from app.auth.deps import CurrentUser, require_admin
from app.auth.router import ph, temp_password
from app.db import get_db

router = APIRouter(prefix="/api/admin/users", dependencies=[Depends(require_admin)])
DB = Annotated[Session, Depends(get_db)]
Admin = Annotated[CurrentUser, Depends(require_admin)]


class UserOut(BaseModel):
    id: int
    username: str
    display_name: str
    role: str
    active: bool
    must_change_password: bool
    created_at: datetime


class UserCreate(BaseModel):
    username: str
    role: Literal["planner", "admin"]
    display_name: str | None = None
    reason: str = "admin action"


class ReasonBody(BaseModel):
    reason: str = "admin action"


class UserWithPassword(UserOut):
    temporary_password: str  # shown once


COLS = "id, username, display_name, role, active, must_change_password, created_at"


def _get(db: Session, user_id: int) -> dict:
    row = db.execute(text(f"SELECT {COLS} FROM users WHERE id = :i"), {"i": user_id}).mappings().first()
    if not row:
        raise HTTPException(404, "User not found")
    return dict(row)


def _log(db: Session, admin: CurrentUser, user_id: int, field: str, old: str | None, new: str, reason: str) -> None:
    db.execute(text("INSERT INTO data_edits (entity, entity_id, field, old_value, new_value, reason, user_id) "
                    "VALUES ('user', :e, :f, :o, :n, :r, :u)"),
               {"e": user_id, "f": field, "o": old, "n": new, "r": reason.strip() or "admin action", "u": admin.id})


@router.get("")
def list_users(db: DB) -> list[UserOut]:
    return [UserOut(**r) for r in db.execute(text(f"SELECT {COLS} FROM users ORDER BY username")).mappings()]


@router.post("", status_code=201)
def create_user(db: DB, admin: Admin, body: UserCreate) -> UserWithPassword:
    name = body.username.strip()
    if not name:
        raise HTTPException(422, "Username is required")
    if db.execute(text("SELECT 1 FROM users WHERE username = :u"), {"u": name}).first():
        raise HTTPException(409, "Username already exists")
    pw = temp_password()
    uid = db.execute(text("INSERT INTO users (username, display_name, role, password_hash, must_change_password) "
                          "VALUES (:u, :d, :r, :h, true) RETURNING id"),
                     {"u": name, "d": (body.display_name or name).strip(), "r": body.role, "h": ph.hash(pw)}).scalar_one()
    _log(db, admin, uid, "account", None, f"created as {body.role}", body.reason)
    db.commit()
    return UserWithPassword(**_get(db, uid), temporary_password=pw)


@router.post("/{user_id}/reset-password")
def reset_password(db: DB, admin: Admin, user_id: int, body: ReasonBody | None = None) -> UserWithPassword:
    _get(db, user_id)
    pw = temp_password()
    db.execute(text("UPDATE users SET password_hash = :h, must_change_password = true WHERE id = :i"),
               {"h": ph.hash(pw), "i": user_id})
    db.execute(text("DELETE FROM sessions WHERE user_id = :i"), {"i": user_id})
    _log(db, admin, user_id, "password", None, "reset", (body or ReasonBody()).reason)
    db.commit()
    return UserWithPassword(**_get(db, user_id), temporary_password=pw)


def _set_active(db: Session, admin: CurrentUser, user_id: int, active: bool, reason: str) -> UserOut:
    old = _get(db, user_id)
    db.execute(text("UPDATE users SET active = :a WHERE id = :i"), {"a": active, "i": user_id})
    if not active:
        db.execute(text("DELETE FROM sessions WHERE user_id = :i"), {"i": user_id})
    _log(db, admin, user_id, "active", str(old["active"]).lower(), str(active).lower(), reason)
    db.commit()
    return UserOut(**_get(db, user_id))


@router.post("/{user_id}/deactivate")
def deactivate(db: DB, admin: Admin, user_id: int, body: ReasonBody | None = None) -> UserOut:
    if user_id == admin.id:
        raise HTTPException(409, "You cannot deactivate your own account")
    return _set_active(db, admin, user_id, False, (body or ReasonBody()).reason)


@router.post("/{user_id}/activate")
def activate(db: DB, admin: Admin, user_id: int, body: ReasonBody | None = None) -> UserOut:
    return _set_active(db, admin, user_id, True, (body or ReasonBody()).reason)
