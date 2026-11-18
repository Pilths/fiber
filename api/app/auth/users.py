"""Creating user accounts and recording account edits. Shared by the admin API and the create_admin command."""
from sqlalchemy import text
from sqlalchemy.orm import Session

from app.auth.router import ph

SELECT_USERNAME = "SELECT 1 FROM users WHERE username = :username"
INSERT_USER = """
    INSERT INTO users (username, display_name, role, password_hash, must_change_password)
    VALUES (:username, :display_name, :role, :password_hash, :must_change_password)
    RETURNING id
"""
INSERT_USER_EDIT = """
    INSERT INTO data_edits (entity, entity_id, field, old_value, new_value, reason, user_id)
    VALUES ('user', :user_id, :field, :old_value, :new_value, :reason, :edited_by)
"""


class UsernameTaken(Exception):
    pass


def create_user_account(
    db: Session,
    username: str,
    display_name: str,
    role: str,
    password: str,
    must_change_password: bool,
) -> int:
    """Insert the user and return the id. Does not commit."""
    if db.execute(text(SELECT_USERNAME), {"username": username}).first():
        raise UsernameTaken(username)
    params = {
        "username": username,
        "display_name": display_name,
        "role": role,
        "password_hash": ph.hash(password),
        "must_change_password": must_change_password,
    }
    return db.execute(text(INSERT_USER), params).scalar_one()


def log_user_edit(
    db: Session,
    user_id: int,
    edited_by: int,
    field: str,
    old_value: str | None,
    new_value: str,
    reason: str,
) -> None:
    params = {
        "user_id": user_id,
        "field": field,
        "old_value": old_value,
        "new_value": new_value,
        "reason": reason,
        "edited_by": edited_by,
    }
    db.execute(text(INSERT_USER_EDIT), params)
