"""Admin Reservation workbook upload: stage, preview, rows, confirm; and the one-time reservation import switch."""
import io
from datetime import datetime
from typing import Annotated, Any, Literal

from fastapi import APIRouter, Depends, Query, UploadFile
from pydantic import BaseModel

from app.auth.deps import DB, Admin, require_admin
from app.ingest import reservation_upload as ru
from app.ingest.excel import parse_reservation_workbook
from app.ingest.upload_file import read_upload
from app.ingest.pipeline import staged_rows_page
from app.ingest.uploads import get_upload, parse_or_422
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
    remarks: str = ""


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
    remarks: str | None


@router.post("/uploads", status_code=201)
def upload(db: DB, admin: Admin, file: UploadFile) -> StagedOut:
    name, data = read_upload(file, ".xlsx")
    results, ignored = parse_or_422(parse_reservation_workbook, io.BytesIO(data), show_value_error_text=True)
    return StagedOut(**ru.stage(db, admin.id, name, results, ignored))


@router.get("/uploads/{upload_id}")
def preview(db: DB, upload_id: int) -> PreviewOut:
    u = get_upload(db, upload_id, "excel")
    return PreviewOut(upload_id=u["id"], filename=u["filename"], status=u["status"], created_at=u["created_at"],
                      confirmed_at=u["confirmed_at"], **u["summary"])


@router.get("/uploads/{upload_id}/rows")
def rows(db: DB, upload_id: int, group: Group, page: Annotated[int, Query(ge=1)] = 1,
         page_size: Annotated[int, Query(ge=1, le=500)] = 100) -> RowsOut:
    get_upload(db, upload_id, "excel")
    total, found = staged_rows_page(
        db, upload_id, "payload->>'group' = :group", {"group": group}, "row_number NULLS LAST, id", page, page_size
    )
    items = [RowOut(id=r["id"], row_number=r["row_number"], sheet_name=r["sheet"], group=group, status=r["status"],
                    reason=r["reason"], raw=r["raw"], warnings=r["warnings"], data=r["payload"]) for r in found]
    return RowsOut(total=total, page=page, page_size=page_size, items=items)


@router.post("/uploads/{upload_id}/confirm")
def confirm(db: DB, admin: Admin, upload_id: int, body: ConfirmIn | None = None) -> ConfirmOut:
    with logged_apply("excel", upload_id, admin.id):
        wins = [w.model_dump() for w in (body or ConfirmIn()).excel_wins]
        return ConfirmOut(**ru.confirm(db, admin.id, upload_id, wins))


@router.get("/reservation-import")
def import_state(db: DB) -> ImportStateOut:
    return ImportStateOut(**ru.import_state(db))


@router.post("/reservation-import/close")
def close(db: DB, admin: Admin, body: CloseIn) -> ImportStateOut:
    return ImportStateOut(**ru.close_import(db, admin.id, body.remarks))
