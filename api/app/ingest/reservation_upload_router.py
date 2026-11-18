"""Admin Reservation workbook upload: stage, preview, rows, confirm; and the one-time reservation import switch."""
import io
from datetime import datetime
from typing import Annotated, Any, Literal

from fastapi import APIRouter, Depends, HTTPException, Query, UploadFile
from pydantic import BaseModel
from sqlalchemy import text
from sqlalchemy.orm import Session

from app.auth.deps import DB, Admin, require_admin
from app.ingest import reservation_upload as ru
from app.ingest.excel import parse_reservation_workbook
from app.ingest.upload_file import read_upload
from app.ingest.uploads import parse_or_422
from app.observability import logged_apply

router = APIRouter(prefix="/api/admin", dependencies=[Depends(require_admin)])
Group = Literal["new", "changed", "unchanged", "missing", "reservations", "conflicts", "already_imported", "ignored",
                "needs_review", "rejected"]


class WinIn(BaseModel):
    row_id: int
    field: Literal["region", "distance_km", "survey_cores"]


class ConfirmIn(BaseModel):
    excel_wins: list[WinIn] = []


class CloseIn(BaseModel):
    reason: str


class WarningOut(BaseModel):
    kind: str
    message: str
    rows: list[int]


class StagedOut(BaseModel):
    upload_id: int
    filename: str
    status: str
    counts: dict[str, int]
    warnings: list[WarningOut]
    switch_closed: bool
    ignored_sheets: list[str]
    applied: dict[str, Any] | None


class PreviewOut(StagedOut):
    created_at: datetime
    confirmed_at: datetime | None


class RowOut(BaseModel):
    id: int
    row_number: int | None
    sheet_name: str | None
    group: Group
    status: str | None
    reason: str | None
    raw: dict[str, Any] | None
    warnings: list[str]
    data: dict[str, Any]  # free-form: differs per group


class RowsOut(BaseModel):
    total: int
    page: int
    page_size: int
    items: list[RowOut]


class SkippedOut(BaseModel):
    row_number: int | None
    reason: str | None


class ConfirmOut(BaseModel):
    upload_id: int
    counts: dict[str, int]
    skipped: list[SkippedOut]
    warnings: list[WarningOut]
    ignored_reservation_rows: int


class ImportStateOut(BaseModel):
    closed: bool
    closed_at: datetime | None
    closed_by: str | None
    reason: str | None


def _fail(e: ru.ApplyError) -> HTTPException:
    return HTTPException(e.status, e.message)


def _get(db: Session, upload_id: int) -> dict[str, Any]:
    row = db.execute(text("SELECT id, filename, status, summary, created_at, confirmed_at FROM uploads "
                          "WHERE id = :i AND kind = 'excel'"), {"i": upload_id}).mappings().first()
    if not row:
        raise HTTPException(404, "Upload not found")
    return dict(row)


@router.post("/uploads", status_code=201)
def upload(db: DB, admin: Admin, file: UploadFile) -> StagedOut:
    name, data = read_upload(file, ".xlsx")
    results, ignored = parse_or_422(parse_reservation_workbook, io.BytesIO(data), show_value_error_text=True)
    return StagedOut(**ru.stage(db, admin.id, name, results, ignored))


@router.get("/uploads/{upload_id}")
def preview(db: DB, upload_id: int) -> PreviewOut:
    u = _get(db, upload_id)
    return PreviewOut(upload_id=u["id"], filename=u["filename"], status=u["status"], created_at=u["created_at"],
                      confirmed_at=u["confirmed_at"], **u["summary"])


@router.get("/uploads/{upload_id}/rows")
def rows(db: DB, upload_id: int, group: Group, page: Annotated[int, Query(ge=1)] = 1,
         page_size: Annotated[int, Query(ge=1, le=500)] = 100) -> RowsOut:
    _get(db, upload_id)
    p = {"u": upload_id, "g": group}
    cond = "upload_id = :u AND payload->>'group' = :g"
    total = db.execute(text(f"SELECT count(*) FROM upload_rows WHERE {cond}"), p).scalar_one()
    q = db.execute(text(f"SELECT id, row_number, sheet, status, reason, raw, warnings, payload FROM upload_rows WHERE {cond} "
                        "ORDER BY row_number NULLS LAST, id LIMIT :l OFFSET :o"), {**p, "l": page_size, "o": (page - 1) * page_size}).mappings()
    items = [RowOut(id=r["id"], row_number=r["row_number"], sheet_name=r["sheet"], group=group, status=r["status"],
                    reason=r["reason"], raw=r["raw"], warnings=r["warnings"], data=r["payload"]) for r in q]
    return RowsOut(total=total, page=page, page_size=page_size, items=items)


@router.post("/uploads/{upload_id}/confirm")
def confirm(db: DB, admin: Admin, upload_id: int, body: ConfirmIn | None = None) -> ConfirmOut:
    try:
        with logged_apply("excel", upload_id, admin.id):
            wins = [w.model_dump() for w in (body or ConfirmIn()).excel_wins]
            return ConfirmOut(**ru.confirm(db, admin.id, upload_id, wins))
    except ru.ApplyError as e:
        raise _fail(e) from e


@router.get("/reservation-import")
def import_state(db: DB) -> ImportStateOut:
    return ImportStateOut(**ru.import_state(db))


@router.post("/reservation-import/close")
def close(db: DB, admin: Admin, body: CloseIn) -> ImportStateOut:
    try:
        return ImportStateOut(**ru.close_import(db, admin.id, body.reason))
    except ru.ApplyError as e:
        raise _fail(e) from e
