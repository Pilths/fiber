"""Admin KMZ upload: stage a preview of segment shapes, then apply."""
import io
import json
from typing import Annotated

from fastapi import APIRouter, Depends, Form, HTTPException, UploadFile
from pydantic import BaseModel
from sqlalchemy import text
from sqlalchemy.orm import Session

from app.auth.deps import CurrentUser, require_admin
from app.db import get_db
from app.load_kmz import SEGMENT_BY_ID_SQL, compute_shapes, parse_lines, save_shape

INSERT_UPLOAD_SQL = """
INSERT INTO uploads (user_id, filename, kind, status, summary)
VALUES (:user_id, :filename, 'kmz', 'staged', CAST(:summary AS jsonb)) RETURNING id
"""
SELECT_UPLOAD_SQL = "SELECT status, summary FROM uploads WHERE id = :upload_id AND kind = 'kmz' FOR UPDATE"
CONFIRM_UPLOAD_SQL = "UPDATE uploads SET status = 'confirmed', confirmed_at = now() WHERE id = :upload_id"

router = APIRouter(prefix="/api/admin/kmz", dependencies=[Depends(require_admin)])
DB = Annotated[Session, Depends(get_db)]
Admin = Annotated[CurrentUser, Depends(require_admin)]
MAX_BYTES = 20 * 1024 * 1024
DEFAULT_FOLDER = "propose route"


class KmzShaped(BaseModel):
    segment_id: int
    name: str
    km: float
    excel_km: float | None
    had_shape: bool


class KmzSkipped(BaseModel):
    segment_id: int
    name: str
    reason: str


class KmzUploadOut(BaseModel):
    upload_id: int
    filename: str
    folder: str
    folders_found: list[str]
    lines: int
    block_reason: str | None  # set when nothing can be applied
    shaped: list[KmzShaped]
    skipped: list[KmzSkipped]
    sites_attached: list[str]


class KmzApplyOut(BaseModel):
    upload_id: int
    shaped: int


def preview_from(upload_id: int, summary: dict) -> KmzUploadOut:
    return KmzUploadOut(
        upload_id=upload_id,
        filename=summary["filename"],
        folder=summary["folder"],
        folders_found=summary["folders_found"],
        lines=summary["lines"],
        block_reason=summary["block_reason"],
        shaped=[KmzShaped(**item) for item in summary["shaped"]],
        skipped=[KmzSkipped(**item) for item in summary["skipped"]],
        sites_attached=summary["sites_attached"],
    )


@router.post("/uploads", status_code=201)
def upload(
    db: DB,
    admin: Admin,
    file: UploadFile,
    folder: Annotated[str, Form()] = DEFAULT_FOLDER,
) -> KmzUploadOut:
    name = file.filename or ""
    if not name.lower().endswith(".kmz"):
        raise HTTPException(422, "Only .kmz files are accepted")
    data = file.file.read(MAX_BYTES + 1)
    if len(data) > MAX_BYTES:
        raise HTTPException(413, "File is larger than 20 MB")
    try:
        lines, folders_found = parse_lines(io.BytesIO(data), folder)
    except ValueError as error:
        raise HTTPException(422, f"Cannot read the KMZ: {error}") from error
    result = {"shaped": [], "skipped": [], "sites_attached": []}
    block_reason = None
    if lines:
        result = compute_shapes(db, lines)
    else:
        found = ", ".join(folders_found) or "none"
        block_reason = f"No lines in folder '{folder}'. Folders in the file: {found}"
    summary = {
        "filename": name,
        "folder": folder,
        "folders_found": folders_found,
        "lines": len(lines),
        "block_reason": block_reason,
        **result,
    }
    parameters = {"user_id": admin.id, "filename": name, "summary": json.dumps(summary)}
    upload_id = db.execute(text(INSERT_UPLOAD_SQL), parameters).scalar_one()
    db.commit()
    return preview_from(upload_id, summary)


@router.post("/uploads/{upload_id}/apply")
def apply(db: DB, upload_id: int) -> KmzApplyOut:
    upload_row = db.execute(text(SELECT_UPLOAD_SQL), {"upload_id": upload_id}).mappings().first()
    if upload_row is None:
        raise HTTPException(404, "Upload not found")
    if upload_row["status"] != "staged":
        raise HTTPException(409, "Already applied or discarded")
    summary = upload_row["summary"]
    if summary["block_reason"] or not summary["shaped"]:
        raise HTTPException(409, summary["block_reason"] or "Nothing to apply")
    saved = 0
    for item in summary["shaped"]:
        segment = db.execute(text(SEGMENT_BY_ID_SQL), {"segment_id": item["segment_id"]}).mappings().first()
        if segment is None:
            continue
        save_shape(db, segment, item["coords"])
        saved += 1
    db.execute(text(CONFIRM_UPLOAD_SQL), {"upload_id": upload_id})
    db.commit()
    return KmzApplyOut(upload_id=upload_id, shaped=saved)
