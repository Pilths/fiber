"""Admin segment list upload: stage, preview rows, apply."""
import io
from typing import Annotated, Any, Literal

from fastapi import APIRouter, Depends, HTTPException, Query, UploadFile
from pydantic import BaseModel
from sqlalchemy import text

from app.auth.deps import DB, Admin, require_admin
from app.ingest import segment_list as sl
from app.ingest.upload_file import read_upload
from app.ingest.uploads import ApplyError, parse_or_422, require_upload
from app.observability import logged_apply

router = APIRouter(prefix="/api/admin/segment-list", dependencies=[Depends(require_admin)])
Group = Literal["new", "changed", "unchanged", "problem"]

COUNT_GROUP_ROWS = "SELECT count(*) FROM upload_rows WHERE upload_id = :upload_id AND row_group = :row_group"
SELECT_GROUP_ROWS = """
    SELECT id, row_number, sheet, status, reason, raw, payload
    FROM upload_rows
    WHERE upload_id = :upload_id AND row_group = :row_group
    ORDER BY row_number, id
    LIMIT :limit OFFSET :offset
"""


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


# Rows staged before route type was derived may still hold a route_type change; it is skipped when shown.
CHANGE_FIELDS = ("distance_km", "route", "section")


class Change(BaseModel):
    field: Literal["distance_km", "route", "section"]
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
    segment_id: int | None


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
    name, data = read_upload(file, ".xlsx")
    parsed = parse_or_422(sl.parse_workbook, io.BytesIO(data))
    return UploadOut(**sl.stage(db, admin.id, name, parsed))


def _row_out(row: Any, group: Group) -> RowOut:
    payload = row["payload"]
    parsed = payload["parsed"]
    return RowOut(
        id=row["id"],
        row_number=row["row_number"],
        sheet_name=row["sheet"],
        group=group,
        status=row["status"],
        reason=row["reason"],
        raw=row["raw"] or {},
        parsed=Parsed(
            link=parsed["link"],
            site_a=parsed["a"],
            site_b=parsed["b"],
            distance_km=parsed["distance"],
            route=parsed["route"],
            section=parsed["section"],
        ),
        changes=[Change(**change) for change in payload.get("changes", []) if change["field"] in CHANGE_FIELDS],
        edited_in_dashboard=payload.get("edited_in_dashboard", False),
        segment_id=payload.get("db_id"),
    )


@router.get("/uploads/{upload_id}/rows")
def rows(
    db: DB,
    upload_id: int,
    group: Group,
    page: Annotated[int, Query(ge=1)] = 1,
    page_size: Annotated[int, Query(ge=1, le=500)] = 100,
) -> RowsOut:
    require_upload(db, upload_id, "segment_list")
    where = {"upload_id": upload_id, "row_group": sl.GROUP_COL[group]}
    total = db.execute(text(COUNT_GROUP_ROWS), where).scalar_one()
    page_params = {**where, "limit": page_size, "offset": (page - 1) * page_size}
    found = db.execute(text(SELECT_GROUP_ROWS), page_params).mappings()
    return RowsOut(total=total, page=page, page_size=page_size, items=[_row_out(row, group) for row in found])


@router.post("/uploads/{upload_id}/apply")
def apply(db: DB, admin: Admin, upload_id: int) -> ApplyOut:
    try:
        with logged_apply("segment_list", upload_id, admin.id):
            return ApplyOut(**sl.apply_upload(db, admin.id, upload_id))
    except ApplyError as error:
        raise HTTPException(error.status, error.message) from error
