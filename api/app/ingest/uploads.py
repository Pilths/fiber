"""SQL and checks every upload kind shares: the uploads row, its lock, and reading the workbook."""
import json
import logging
from collections.abc import Callable
from typing import Any

from fastapi import HTTPException
from sqlalchemy import text
from sqlalchemy.orm import Session

from app.db import set_lock_timeout

logger = logging.getLogger("app.upload")

INSERT_UPLOAD_SQL = """
INSERT INTO uploads (user_id, filename, kind, status, summary)
VALUES (:user_id, :filename, :kind, 'staged', CAST(:summary AS jsonb)) RETURNING id
"""
LOCK_UPLOAD_SQL = """
SELECT id, filename, status, summary FROM uploads WHERE id = :upload_id AND kind = :kind FOR UPDATE
"""
UPLOAD_EXISTS_SQL = "SELECT 1 FROM uploads WHERE id = :upload_id AND kind = :kind"
FINISH_UPLOAD_SQL = """
UPDATE uploads SET status = 'confirmed', confirmed_at = now(), summary = COALESCE(CAST(:summary AS jsonb), summary)
WHERE id = :upload_id
"""


class ApplyError(Exception):
    def __init__(self, status: int, message: str):
        self.status = status
        self.message = message


def insert_upload(db: Session, user_id: int, filename: str, kind: str, summary: dict[str, Any]) -> int:
    parameters = {"user_id": user_id, "filename": filename, "kind": kind, "summary": json.dumps(summary)}
    return db.execute(text(INSERT_UPLOAD_SQL), parameters).scalar_one()


def lock_staged_upload(db: Session, upload_id: int, kind: str, already_done_message: str) -> dict[str, Any]:
    set_lock_timeout(db)
    upload = db.execute(text(LOCK_UPLOAD_SQL), {"upload_id": upload_id, "kind": kind}).mappings().first()
    if not upload:
        raise ApplyError(404, "Upload not found")
    if upload["status"] != "staged":
        raise ApplyError(409, already_done_message)
    return dict(upload)


def finish_upload(db: Session, upload_id: int, summary: dict[str, Any] | None = None) -> None:
    """Mark confirmed; a None summary keeps the stored one."""
    summary_json = None if summary is None else json.dumps(summary)
    db.execute(text(FINISH_UPLOAD_SQL), {"upload_id": upload_id, "summary": summary_json})


def require_upload(db: Session, upload_id: int, kind: str) -> None:
    if not db.execute(text(UPLOAD_EXISTS_SQL), {"upload_id": upload_id, "kind": kind}).first():
        raise HTTPException(404, "Upload not found")


def parse_or_422(parse: Callable[..., Any], data: Any, show_value_error_text: bool = False) -> Any:
    try:
        return parse(data)
    except Exception as error:
        logger.exception("Cannot read the workbook")
        if show_value_error_text and isinstance(error, ValueError):
            raise HTTPException(422, f"Cannot read the workbook: {error}") from error
        raise HTTPException(422, f"Cannot read the workbook: {type(error).__name__}") from error
