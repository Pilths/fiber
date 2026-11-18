from datetime import datetime
from typing import Literal

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy import text
from sqlalchemy.orm import Session

from app.auth.deps import DB, Admin, CurrentUser, require_admin
from app.auth.router import ph, temp_password
from app.auth.users import UsernameTaken, create_user_account, log_user_edit

router = APIRouter(prefix="/api/admin/users", dependencies=[Depends(require_admin)])


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
SELECT_USER = f"SELECT {COLS} FROM users WHERE id = :user_id"
SELECT_ALL_USERS = f"SELECT {COLS} FROM users ORDER BY username"
UPDATE_PASSWORD = "UPDATE users SET password_hash = :password_hash, must_change_password = true WHERE id = :user_id"
UPDATE_ACTIVE = "UPDATE users SET active = :active WHERE id = :user_id"
DELETE_SESSIONS = "DELETE FROM sessions WHERE user_id = :user_id"


def _get(db: Session, user_id: int) -> dict:
    row = db.execute(text(SELECT_USER), {"user_id": user_id}).mappings().first()
    if not row:
        raise HTTPException(404, "User not found")
    return dict(row)


def _log(db: Session, admin: CurrentUser, user_id: int, field: str, old: str | None, new: str, reason: str) -> None:
    log_user_edit(db, user_id, admin.id, field, old, new, reason.strip() or "admin action")


@router.get("")
def list_users(db: DB) -> list[UserOut]:
    return [UserOut(**row) for row in db.execute(text(SELECT_ALL_USERS)).mappings()]


@router.post("", status_code=201)
def create_user(db: DB, admin: Admin, body: UserCreate) -> UserWithPassword:
    username = body.username.strip()
    if not username:
        raise HTTPException(422, "Username is required")
    password = temp_password()
    display_name = (body.display_name or username).strip()
    try:
        user_id = create_user_account(db, username, display_name, body.role, password, must_change_password=True)
    except UsernameTaken as error:
        raise HTTPException(409, "Username already exists") from error
    _log(db, admin, user_id, "account", None, f"created as {body.role}", body.reason)
    db.commit()
    return UserWithPassword(**_get(db, user_id), temporary_password=password)


@router.post("/{user_id}/reset-password")
def reset_password(db: DB, admin: Admin, user_id: int, body: ReasonBody | None = None) -> UserWithPassword:
    _get(db, user_id)
    password = temp_password()
    db.execute(text(UPDATE_PASSWORD), {"password_hash": ph.hash(password), "user_id": user_id})
    db.execute(text(DELETE_SESSIONS), {"user_id": user_id})
    _log(db, admin, user_id, "password", None, "reset", (body or ReasonBody()).reason)
    db.commit()
    return UserWithPassword(**_get(db, user_id), temporary_password=password)


def _set_active(db: Session, admin: CurrentUser, user_id: int, active: bool, reason: str) -> UserOut:
    old = _get(db, user_id)
    db.execute(text(UPDATE_ACTIVE), {"active": active, "user_id": user_id})
    if not active:
        db.execute(text(DELETE_SESSIONS), {"user_id": user_id})
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
