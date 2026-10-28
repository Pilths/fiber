"""Admin site master upload: stage, preview rows, apply, current file."""
import io
from typing import Annotated, Any, Literal

from fastapi import APIRouter, Depends, Form, HTTPException, Query, UploadFile
from pydantic import BaseModel
from sqlalchemy import text
from sqlalchemy.orm import Session

from app.auth.deps import CurrentUser, require_admin
from app.db import get_db
from app.ingest import site_master as sm

router = APIRouter(prefix="/api/admin/site-master", dependencies=[Depends(require_admin)])
DB = Annotated[Session, Depends(get_db)]
Admin = Annotated[CurrentUser, Depends(require_admin)]
MAX_BYTES = 20 * 1024 * 1024


class Counts(BaseModel):
    rows: int
    added: int
    changed: int
    missing: int
    problem: int
    unchanged: int


class SheetOut(BaseModel):
    kind: Literal["sites", "dcs"]
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
    possible_renames: list[dict[str, Any]]
    add_only: bool = False


class RowsOut(BaseModel):
    total: int
    page: int
    page_size: int
    items: list[dict[str, Any]]


class RenameIn(BaseModel):
    missing_dc_id: int
    new_row_id: int
    decision: Literal["rename", "separate"]


class OverrideIn(BaseModel):
    sites: bool = False
    dcs: bool = False


class ApplyIn(BaseModel):
    sheets: list[Literal["sites", "dcs"]] | None = None  # apply only these sheets; None applies every sheet that can be applied
    override_drop: OverrideIn = OverrideIn()
    reason: str | None = None
    renames: list[RenameIn] = []


class ApplyOut(BaseModel):
    upload_id: int
    sheets: dict[str, dict[str, Any]]
    warnings: list[str]
    complete: bool = True  # False while another sheet of this upload can still be applied


@router.post("/uploads", status_code=201)
def upload(db: DB, admin: Admin, file: UploadFile, add_only: Annotated[bool, Form()] = False) -> UploadOut:
    """add_only: the file is part of the list; sites not in it are kept active and the row-count check is skipped."""
    name = file.filename or ""
    if not name.lower().endswith(".xlsx"):
        raise HTTPException(422, "Only .xlsx files are accepted")
    data = file.file.read(MAX_BYTES + 1)
    if len(data) > MAX_BYTES:
        raise HTTPException(413, "File is larger than 20 MB")
    try:
        parsed = sm.parse_workbook(io.BytesIO(data))
    except Exception as e:
        raise HTTPException(422, f"Cannot read the workbook: {type(e).__name__}") from e
    return UploadOut(**sm.stage(db, admin.id, name, parsed, add_only))


@router.get("/uploads/{upload_id}/rows")
def rows(db: DB, upload_id: int, sheet: Literal["sites", "dcs"], group: Literal["added", "changed", "missing", "problem", "unchanged"],
         page: Annotated[int, Query(ge=1)] = 1, page_size: Annotated[int, Query(ge=1, le=500)] = 100) -> RowsOut:
    if not db.execute(text("SELECT 1 FROM uploads WHERE id = :i AND kind = 'site_master'"), {"i": upload_id}).first():
        raise HTTPException(404, "Upload not found")
    where = {"u": upload_id, "e": sm.SHEETS[sheet][2], "g": sm.GROUP_COL[group]}
    cond = "upload_id = :u AND entity = :e AND row_group = :g"
    total = db.execute(text(f"SELECT count(*) FROM upload_rows WHERE {cond}"), where).scalar_one()
    q = db.execute(text(f"SELECT id, row_number, sheet, status, reason, raw, payload FROM upload_rows WHERE {cond} "
                        "ORDER BY row_number NULLS LAST, payload->>'key', id LIMIT :l OFFSET :o"),
                   {**where, "l": page_size, "o": (page - 1) * page_size}).mappings()
    items = [{"id": r["id"], "row_number": r["row_number"], "sheet_name": r["sheet"], "key": r["payload"]["key"],
              "group": group, "status": r["status"], "reason": r["reason"], "raw": r["raw"],
              "parsed": r["payload"].get("parsed"), "changes": r["payload"].get("changes", []),
              "edited_in_dashboard": r["payload"].get("edited_in_dashboard", False),
              "location_note": r["payload"].get("location_note"), "db_id": r["payload"].get("db_id"),
              "in_use": r["payload"].get("in_use"), "possible_rename": r["payload"].get("possible_rename")} for r in q]
    return RowsOut(total=total, page=page, page_size=page_size, items=items)


@router.post("/uploads/{upload_id}/apply")
def apply(db: DB, admin: Admin, upload_id: int, body: ApplyIn) -> ApplyOut:
    try:
        return ApplyOut(**sm.apply_upload(db, admin.id, upload_id, body.override_drop.model_dump(), body.reason,
                                          [r.model_dump() for r in body.renames], body.sheets))
    except sm.ApplyError as e:
        raise HTTPException(e.status, e.message) from e


@router.get("/current")
def current(db: DB) -> dict[str, Any]:
    rows_ = db.execute(text(
        "SELECT u.id AS upload_id, u.filename, u.status, u.created_at AS uploaded_at, u.confirmed_at AS applied_at, "
        "usr.username AS uploaded_by, u.summary FROM uploads u JOIN users usr ON usr.id = u.user_id "
        "WHERE u.kind = 'site_master' ORDER BY u.id DESC")).mappings().all()
    cur = next((r for r in sorted((r for r in rows_ if r["status"] == "confirmed"), key=lambda r: (r["applied_at"], r["upload_id"]),
                                  reverse=True)), None)

    def info(r: Any) -> dict[str, Any]:
        return {**{k: r[k] for k in ("upload_id", "filename", "status", "uploaded_at", "applied_at", "uploaded_by")},
                "sheets": {s["kind"]: {"sheet_name": s["sheet_name"], "found": s["found"], **s["counts"]}
                           for s in r["summary"]["sheets"]}}

    return {"current": info(cur) if cur else None,
            "previous": [info(r) for r in rows_ if r is not cur]}
