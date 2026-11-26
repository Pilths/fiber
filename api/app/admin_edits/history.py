"""Shared admin-edit helpers: the data_edits log, history rows, and the GET /history route.

Every changed field is its own data_edits row (old, new, remarks, user). Field names match what the upload
modules compare for protection.
"""
from typing import Any, Literal

from fastapi import APIRouter
from pydantic import BaseModel
from sqlalchemy import text
from sqlalchemy.orm import Session

from app.auth.deps import DB, CurrentUser

router = APIRouter()
Entity = Literal["core", "segment", "site", "kmz_group", "cluster"]
HISTORY_SHOWN = 10  # history rows returned with an item, newest first

HISTORY_SQL = """
SELECT d.field, d.old_value, d.new_value, d.remarks, d.user_id, u.display_name AS "user", d.created_at AS at
FROM data_edits d JOIN users u ON u.id = d.user_id
WHERE d.entity = :entity AND d.entity_id = :entity_id
ORDER BY d.created_at DESC, d.id DESC LIMIT :limit
"""
INSERT_EDIT_SQL = """
INSERT INTO data_edits (entity, entity_id, field, old_value, new_value, remarks, user_id, upload_id)
VALUES (:entity, :entity_id, :field, :old_value, :new_value, :remarks, :user_id, :upload_id)
"""


class HistoryRow(BaseModel):
    field: str
    old_value: str | None
    new_value: str | None
    remarks: str | None  # blank remarks are stored as NULL
    user_id: int
    user: str
    at: Any


class Edited(BaseModel):
    id: int
    changed: list[str]
    history: list[HistoryRow]  # latest 10 for this item, newest first


def history(db: Session, entity: str, entity_id: int, limit: int | None = None) -> list[HistoryRow]:
    params = {"entity": entity, "entity_id": entity_id, "limit": limit}
    rows = db.execute(text(HISTORY_SQL), params).mappings()
    return [HistoryRow(**row) for row in rows]


def _text_or_none(value: Any) -> str | None:
    if value is None:
        return None
    return str(value)


def log_edits(db: Session, user: CurrentUser, entity: str, entity_id: int, edits: list[tuple[str, Any, Any]],
              remarks: str) -> list[str]:
    return log_edits_for_user(db, user.id, entity, entity_id, edits, remarks)


def log_edits_for_user(db: Session, user_id: int, entity: str, entity_id: int, edits: list[tuple[str, Any, Any]],
                       remarks: str, upload_id: int | None = None) -> list[str]:
    """upload_id is set by uploads and load_data. A dashboard edit leaves it empty, which protects the field."""
    for field_name, old, new in edits:
        params = {
            "entity": entity,
            "entity_id": entity_id,
            "field": field_name,
            "old_value": _text_or_none(old),
            "new_value": _text_or_none(new),
            "remarks": remarks or None,
            "user_id": user_id,
            "upload_id": upload_id,
        }
        db.execute(text(INSERT_EDIT_SQL), params)
    return [field_name for field_name, _, _ in edits]


def bool_text(value: Any) -> str:
    """data_edits stores booleans as 'true' / 'false'."""
    return str(value).lower()


@router.get("/history")
def get_history(db: DB, entity: Entity, id: int) -> list[HistoryRow]:
    return history(db, entity, id)

