"""The steps every upload kind repeats: the staged rows store and the apply skeleton.

Each kind keeps its own parse, evaluate and row writes and passes them in as plain functions.
The SQL text built here (where, order_by) always comes from the calling module, never from a request.
"""
from collections.abc import Callable
from typing import Any

from sqlalchemy import text
from sqlalchemy.orm import Session

from app.ingest.uploads import finish_upload, lock_staged_upload
from app.routing.graph import invalidate as invalidate_routes

INSERT_STAGED_ROWS_SQL = """
INSERT INTO upload_rows (upload_id, row_group, entity, payload, warnings, sheet, row_number, status, reason, raw)
VALUES (:upload_id, :row_group, :entity, CAST(:payload AS jsonb), CAST(:warnings AS jsonb), :sheet, :row_number,
        :status, :reason, CAST(:raw AS jsonb))
"""
STAGED_ROW_COLUMNS = "id, entity, row_number, sheet, status, reason, raw, warnings, payload"


def insert_staged_rows(db: Session, rows: list[dict[str, Any]]) -> None:
    """Each row holds the upload_rows columns; payload, raw and warnings are JSON text. warnings may be left out."""
    if rows:
        db.execute(text(INSERT_STAGED_ROWS_SQL), [{"warnings": None, **row} for row in rows])


def staged_rows_page(
    db: Session,
    upload_id: int,
    where: str,
    params: dict[str, Any],
    order_by: str,
    page: int,
    page_size: int,
) -> tuple[int, list[Any]]:
    """(total rows, one page of rows) of an upload that match `where`."""
    filter_sql = f"upload_id = :upload_id AND {where}"
    all_params = {"upload_id": upload_id, **params}
    total = db.execute(text(f"SELECT count(*) FROM upload_rows WHERE {filter_sql}"), all_params).scalar_one()
    page_sql = (
        f"SELECT {STAGED_ROW_COLUMNS} FROM upload_rows WHERE {filter_sql} "
        f"ORDER BY {order_by} LIMIT :limit OFFSET :offset"
    )
    page_params = {**all_params, "limit": page_size, "offset": (page - 1) * page_size}
    return total, list(db.execute(text(page_sql), page_params).mappings())


def load_staged_rows(db: Session, upload_id: int, where: str = "TRUE", order_by: str = "id") -> list[Any]:
    sql = f"SELECT {STAGED_ROW_COLUMNS} FROM upload_rows WHERE upload_id = :upload_id AND {where} ORDER BY {order_by}"
    return list(db.execute(text(sql), {"upload_id": upload_id}).mappings())


def apply_staged_upload(
    db: Session,
    upload_id: int,
    kind: str,
    already_done_message: str,
    evaluate_staged: Callable[[dict[str, Any]], Any],
    write_all: Callable[[dict[str, Any], Any], tuple[dict[str, Any], dict[str, Any]]],
) -> dict[str, Any]:
    """Lock the staged upload, decide again against the current data, write all or nothing, finish.

    evaluate_staged(upload) loads the staged rows, evaluates them and returns what write_all needs; it may raise
    ApplyError. write_all(upload, evaluated) does the writes and returns (the "applied" record kept in the
    upload summary, the response).
    """
    upload = lock_staged_upload(db, upload_id, kind, already_done_message)
    evaluated = evaluate_staged(upload)
    with db.begin_nested():  # all or nothing
        applied, response = write_all(upload, evaluated)
        finish_upload(db, upload_id, dict(upload["summary"], applied=applied))
    db.commit()
    invalidate_routes()
    return response
