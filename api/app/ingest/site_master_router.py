"""Admin site master upload: stage, preview rows, apply, current file."""
import io
from datetime import datetime
from typing import Annotated, Any, Literal

from fastapi import APIRouter, Depends, Form, HTTPException, Query, UploadFile
from pydantic import BaseModel
from sqlalchemy import text

from app.auth.deps import DB, Admin, require_admin
from app.ingest import site_master as sm
from app.ingest.upload_file import read_upload
from app.ingest.uploads import parse_or_422, require_upload
from app.observability import logged_apply

router = APIRouter(prefix="/api/admin/site-master", dependencies=[Depends(require_admin)])


class Counts(BaseModel):
    rows: int
    added: int
    changed: int
    missing: int
    problem: int
    unchanged: int


class SheetOut(BaseModel):
    kind: Literal["sites"]
    sheet_name: str | None
    found: bool
    blocked: bool
    block_reasons: list[str]
    counts: Counts
    needs_override: bool  # blocked only by the row-count check; apply with override_drop + reason


class UploadOut(BaseModel):
    upload_id: int
    filename: str
    sheets: list[SheetOut]
    add_only: bool = False


class RowItem(BaseModel):
    id: int
    row_number: int | None
    sheet_name: str | None
    key: str
    group: str
    status: str | None
    reason: str | None
    raw: dict[str, Any] | None
    parsed: dict[str, Any] | None
    changes: list[dict[str, Any]]
    edited_in_dashboard: bool
    db_id: int | None
    in_use: bool | None


class RowsOut(BaseModel):
    total: int
    page: int
    page_size: int
    items: list[RowItem]


class SheetInfo(Counts):
    sheet_name: str | None
    found: bool


class UploadInfo(BaseModel):
    upload_id: int
    filename: str
    status: str
    uploaded_at: datetime
    applied_at: datetime | None
    uploaded_by: str
    sheets: dict[str, SheetInfo]


class CurrentOut(BaseModel):
    current: UploadInfo | None
    previous: list[UploadInfo]


class OverrideIn(BaseModel):
    sites: bool = False


class ApplyIn(BaseModel):
    # apply only these sheets; None applies every sheet that can be applied
    sheets: list[Literal["sites"]] | None = None
    override_drop: OverrideIn = OverrideIn()
    reason: str | None = None


class ApplyOut(BaseModel):
    upload_id: int
    sheets: dict[str, dict[str, Any]]
    warnings: list[str]
    complete: bool = True  # False while another sheet of this upload can still be applied


@router.post("/uploads", status_code=201)
def upload(db: DB, admin: Admin, file: UploadFile, add_only: Annotated[bool, Form()] = False) -> UploadOut:
    """add_only: the file is part of the list; sites not in it are kept active and the row-count check is skipped."""
    name, data = read_upload(file, ".xlsx")
    parsed = parse_or_422(sm.parse_workbook, io.BytesIO(data))
    return UploadOut(**sm.stage(db, admin.id, name, parsed, add_only))


@router.get("/uploads/{upload_id}/rows")
def rows(
    db: DB,
    upload_id: int,
    sheet: Literal["sites"],
    group: Literal["added", "changed", "missing", "problem", "unchanged"],
    page: Annotated[int, Query(ge=1)] = 1,
    page_size: Annotated[int, Query(ge=1, le=500)] = 100,
) -> RowsOut:
    require_upload(db, upload_id, "site_master")
    where = {"u": upload_id, "e": sm.SHEETS[sheet][2], "g": sm.GROUP_COL[group]}
    cond = "upload_id = :u AND entity = :e AND row_group = :g"
    total = db.execute(text(f"SELECT count(*) FROM upload_rows WHERE {cond}"), where).scalar_one()
    q = db.execute(text(f"SELECT id, row_number, sheet, status, reason, raw, payload FROM upload_rows WHERE {cond} "
                        "ORDER BY row_number NULLS LAST, payload->>'key', id LIMIT :l OFFSET :o"),
                   {**where, "l": page_size, "o": (page - 1) * page_size}).mappings()
    items = [RowItem(id=r["id"], row_number=r["row_number"], sheet_name=r["sheet"], key=r["payload"]["key"],
                     group=group, status=r["status"], reason=r["reason"], raw=r["raw"],
                     parsed=r["payload"].get("parsed"), changes=r["payload"].get("changes", []),
                     edited_in_dashboard=r["payload"].get("edited_in_dashboard", False),
                     db_id=r["payload"].get("db_id"), in_use=r["payload"].get("in_use")) for r in q]
    return RowsOut(total=total, page=page, page_size=page_size, items=items)


@router.post("/uploads/{upload_id}/apply")
def apply(db: DB, admin: Admin, upload_id: int, body: ApplyIn) -> ApplyOut:
    with logged_apply("site_master", upload_id, admin.id):
        return ApplyOut(**sm.apply_upload(db, admin.id, upload_id, body.override_drop.model_dump(), body.reason,
                                          body.sheets))


@router.get("/current")
def current(db: DB) -> CurrentOut:
    rows_ = db.execute(text(
        "SELECT u.id AS upload_id, u.filename, u.status, u.created_at AS uploaded_at, u.confirmed_at AS applied_at, "
        "usr.username AS uploaded_by, u.summary FROM uploads u JOIN users usr ON usr.id = u.user_id "
        "WHERE u.kind = 'site_master' ORDER BY u.id DESC")).mappings().all()
    confirmed = [row for row in rows_ if row["status"] == "confirmed"]
    newest_first = sorted(confirmed, key=lambda row: (row["applied_at"], row["upload_id"]), reverse=True)
    cur = newest_first[0] if newest_first else None

    def info(r: Any) -> UploadInfo:
        sheets = {s["kind"]: SheetInfo(sheet_name=s["sheet_name"], found=s["found"], **s["counts"])
                  for s in r["summary"]["sheets"]}
        return UploadInfo(upload_id=r["upload_id"], filename=r["filename"], status=r["status"],
                          uploaded_at=r["uploaded_at"], applied_at=r["applied_at"], uploaded_by=r["uploaded_by"],
                          sheets=sheets)

    return CurrentOut(current=info(cur) if cur else None,
                      previous=[info(r) for r in rows_ if r is not cur])
