"""Admin Reservation workbook upload: stage, preview, rows, confirm; and the one-time reservation import switch."""
import io
from typing import Annotated, Any, Literal

from fastapi import APIRouter, Depends, HTTPException, Query, UploadFile
from pydantic import BaseModel
from sqlalchemy import text
from sqlalchemy.orm import Session

from app.auth.deps import CurrentUser, require_admin
from app.db import get_db
from app.ingest import reservation_upload as ru
from app.ingest.excel import parse_reservation_workbook

router = APIRouter(prefix="/api/admin", dependencies=[Depends(require_admin)])
DB = Annotated[Session, Depends(get_db)]
Admin = Annotated[CurrentUser, Depends(require_admin)]
MAX_BYTES = 20 * 1024 * 1024
Group = Literal["new", "changed", "unchanged", "missing", "reservations", "conflicts", "already_imported", "ignored",
                "needs_review", "rejected"]


class WinIn(BaseModel):
    row_id: int
    field: Literal["region", "distance_km", "survey_cores"]


class ConfirmIn(BaseModel):
    excel_wins: list[WinIn] = []


class CloseIn(BaseModel):
    reason: str


def _fail(e: ru.ApplyError) -> HTTPException:
    return HTTPException(e.status, e.message)


def _get(db: Session, upload_id: int) -> dict[str, Any]:
    row = db.execute(text("SELECT id, filename, status, summary, created_at, confirmed_at FROM uploads "
                          "WHERE id = :i AND kind = 'excel'"), {"i": upload_id}).mappings().first()
    if not row:
        raise HTTPException(404, "Upload not found")
    return dict(row)


@router.post("/uploads", status_code=201)
def upload(db: DB, admin: Admin, file: UploadFile) -> dict[str, Any]:
    name = file.filename or ""
    if not name.lower().endswith(".xlsx"):
        raise HTTPException(422, "Only .xlsx files are accepted")
    data = file.file.read(MAX_BYTES + 1)
    if len(data) > MAX_BYTES:
        raise HTTPException(413, "File is larger than 20 MB")
    try:
        results, ignored = parse_reservation_workbook(io.BytesIO(data))
    except Exception as e:
        raise HTTPException(422, f"Cannot read the workbook: {e}" if isinstance(e, ValueError) else
                            f"Cannot read the workbook: {type(e).__name__}") from e
    return ru.stage(db, admin.id, name, results, ignored)


@router.get("/uploads/{upload_id}")
def preview(db: DB, upload_id: int) -> dict[str, Any]:
    u = _get(db, upload_id)
    return {"upload_id": u["id"], "filename": u["filename"], "status": u["status"], "created_at": u["created_at"],
            "confirmed_at": u["confirmed_at"], **u["summary"]}


@router.get("/uploads/{upload_id}/rows")
def rows(db: DB, upload_id: int, group: Group, page: Annotated[int, Query(ge=1)] = 1,
         page_size: Annotated[int, Query(ge=1, le=500)] = 100) -> dict[str, Any]:
    _get(db, upload_id)
    p = {"u": upload_id, "g": group}
    cond = "upload_id = :u AND payload->>'group' = :g"
    total = db.execute(text(f"SELECT count(*) FROM upload_rows WHERE {cond}"), p).scalar_one()
    q = db.execute(text(f"SELECT id, row_number, sheet, status, reason, raw, warnings, payload FROM upload_rows WHERE {cond} "
                        "ORDER BY row_number NULLS LAST, id LIMIT :l OFFSET :o"), {**p, "l": page_size, "o": (page - 1) * page_size}).mappings()
    items = [{"id": r["id"], "row_number": r["row_number"], "sheet_name": r["sheet"], "group": group, "status": r["status"],
              "reason": r["reason"], "raw": r["raw"], "warnings": r["warnings"], "data": r["payload"]} for r in q]
    return {"total": total, "page": page, "page_size": page_size, "items": items}


@router.post("/uploads/{upload_id}/confirm")
def confirm(db: DB, admin: Admin, upload_id: int, body: ConfirmIn | None = None) -> dict[str, Any]:
    try:
        return ru.confirm(db, admin.id, upload_id, [w.model_dump() for w in (body or ConfirmIn()).excel_wins])
    except ru.ApplyError as e:
        raise _fail(e) from e


@router.get("/reservation-import")
def import_state(db: DB) -> dict[str, Any]:
    return ru.import_state(db)


@router.post("/reservation-import/close")
def close(db: DB, admin: Admin, body: CloseIn) -> dict[str, Any]:
    try:
        return ru.close_import(db, admin.id, body.reason)
    except ru.ApplyError as e:
        raise _fail(e) from e
