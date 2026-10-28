"""Admin span list upload: stage, preview rows, apply."""
import io
from typing import Annotated, Any, Literal

from fastapi import APIRouter, Depends, HTTPException, Query, UploadFile
from pydantic import BaseModel
from sqlalchemy import text
from sqlalchemy.orm import Session

from app.auth.deps import CurrentUser, require_admin
from app.db import get_db
from app.ingest import span_list as sl
from app.ingest.site_master import ApplyError

router = APIRouter(prefix="/api/admin/span-list", dependencies=[Depends(require_admin)])
DB = Annotated[Session, Depends(get_db)]
Admin = Annotated[CurrentUser, Depends(require_admin)]
MAX_BYTES = 20 * 1024 * 1024
Group = Literal["new", "changed", "unchanged", "problem"]


class Counts(BaseModel):
    rows: int
    new: int
    changed: int
    unchanged: int
    problem: int


class UploadOut(BaseModel):
    upload_id: int
    filename: str
    sheet_name: str | None
    found: bool
    block_reason: str | None  # set when no sheet has the Link and Distance headers, or the sheet is empty
    counts: Counts


class Change(BaseModel):
    field: Literal["distance_km", "route_type", "route", "section"]
    old: str | None
    new: str | None
    protected: bool  # edited in the dashboard: shown, not applied
    note: str | None = None


class Parsed(BaseModel):
    link: str | None
    site_a: str | None
    site_b: str | None
    distance_km: str | None
    route: str | None
    section: str | None
    type: str | None


class RowOut(BaseModel):
    id: int
    row_number: int
    sheet_name: str | None
    group: Group
    status: Literal["ready", "needs_review", "rejected"]
    reason: str | None
    raw: dict[str, Any]
    parsed: Parsed
    changes: list[Change]
    edited_in_dashboard: bool
    span_id: int | None


class RowsOut(BaseModel):
    total: int
    page: int
    page_size: int
    items: list[RowOut]


class ApplyOut(BaseModel):
    upload_id: int
    created: int
    changed: int
    protected_kept: int
    skipped: int
    warnings: list[str]


@router.post("/uploads", status_code=201)
def upload(db: DB, admin: Admin, file: UploadFile) -> UploadOut:
    name = file.filename or ""
    if not name.lower().endswith(".xlsx"):
        raise HTTPException(422, "Only .xlsx files are accepted")
    data = file.file.read(MAX_BYTES + 1)
    if len(data) > MAX_BYTES:
        raise HTTPException(413, "File is larger than 20 MB")
    try:
        parsed = sl.parse_workbook(io.BytesIO(data))
    except Exception as e:
        raise HTTPException(422, f"Cannot read the workbook: {type(e).__name__}") from e
    return UploadOut(**sl.stage(db, admin.id, name, parsed))


@router.get("/uploads/{upload_id}/rows")
def rows(db: DB, upload_id: int, group: Group, page: Annotated[int, Query(ge=1)] = 1,
         page_size: Annotated[int, Query(ge=1, le=500)] = 100) -> RowsOut:
    if not db.execute(text("SELECT 1 FROM uploads WHERE id = :i AND kind = 'span_list'"), {"i": upload_id}).first():
        raise HTTPException(404, "Upload not found")
    where = {"u": upload_id, "g": sl.GROUP_COL[group]}
    total = db.execute(text("SELECT count(*) FROM upload_rows WHERE upload_id = :u AND row_group = :g"), where).scalar_one()
    q = db.execute(text("SELECT id, row_number, sheet, status, reason, raw, payload FROM upload_rows "
                        "WHERE upload_id = :u AND row_group = :g ORDER BY row_number, id LIMIT :l OFFSET :o"),
                   {**where, "l": page_size, "o": (page - 1) * page_size}).mappings()
    items = []
    for r in q:
        p, pp = r["payload"], r["payload"]["parsed"]
        items.append(RowOut(
            id=r["id"], row_number=r["row_number"], sheet_name=r["sheet"], group=group, status=r["status"], reason=r["reason"],
            raw=r["raw"] or {}, parsed=Parsed(link=pp["link"], site_a=pp["a"], site_b=pp["b"], distance_km=pp["distance"],
                                              route=pp["route"], section=pp["section"], type=pp["type"]),
            changes=[Change(**c) for c in p.get("changes", [])], edited_in_dashboard=p.get("edited_in_dashboard", False),
            span_id=p.get("db_id")))
    return RowsOut(total=total, page=page, page_size=page_size, items=items)


@router.post("/uploads/{upload_id}/apply")
def apply(db: DB, admin: Admin, upload_id: int) -> ApplyOut:
    try:
        return ApplyOut(**sl.apply_upload(db, admin.id, upload_id))
    except ApplyError as e:
        raise HTTPException(e.status, e.message) from e
