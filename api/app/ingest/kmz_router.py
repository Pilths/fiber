"""Admin KMZ upload: stage a preview of segment shapes, then apply."""
import io
from typing import Annotated

from fastapi import APIRouter, Depends, Form, HTTPException, UploadFile
from pydantic import BaseModel
from sqlalchemy import text

from app.auth.deps import DB, Admin, require_admin
from app.ingest.upload_file import read_upload
from app.ingest.uploads import ApplyError, finish_upload, insert_upload, lock_staged_upload
from app.load_kmz import (
    SEGMENT_BY_ID_SQL,
    compute_shapes,
    folder_tree,
    lines_in_folder_ids,
    parse_lines,
    save_shape,
)
from app.observability import logged_apply


router = APIRouter(prefix="/api/admin/kmz", dependencies=[Depends(require_admin)])
DEFAULT_FOLDER = "propose route"


class KmzShaped(BaseModel):
    segment_id: int
    name: str
    km: float
    excel_km: float | None
    had_shape: bool


class KmzSkipped(BaseModel):
    segment_id: int | None
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


class KmzFolder(BaseModel):
    id: str
    name: str
    lines: int
    children: list["KmzFolder"]


class KmzFoldersOut(BaseModel):
    folders: list[KmzFolder]
    loose_lines: int


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
    )


@router.post("/folders")
def folders(file: UploadFile) -> KmzFoldersOut:
    _, data = read_upload(file, ".kmz")
    try:
        tree, loose_lines = folder_tree(io.BytesIO(data))
    except ValueError as error:
        raise HTTPException(422, f"Cannot read the KMZ: {error}") from error
    return KmzFoldersOut(folders=tree, loose_lines=loose_lines)


@router.post("/uploads", status_code=201)
def upload(
    db: DB,
    admin: Admin,
    file: UploadFile,
    folder: Annotated[str, Form()] = DEFAULT_FOLDER,
    folder_ids: Annotated[list[str], Form()] = [],
) -> KmzUploadOut:
    name, data = read_upload(file, ".kmz")
    try:
        if folder_ids:
            lines, selected_names = lines_in_folder_ids(io.BytesIO(data), folder_ids)
            folder = ", ".join(selected_names)
            folders_found = selected_names
        else:
            lines, folders_found = parse_lines(io.BytesIO(data), folder)
    except ValueError as error:
        raise HTTPException(422, f"Cannot read the KMZ: {error}") from error
    result = {"shaped": [], "skipped": []}
    block_reason = None
    if lines:
        result = compute_shapes(db, lines)
    else:
        found = ", ".join(folders_found) or "none"
        block_reason = f"No lines in folder '{folder}'. Folders in the file: {found}"
        if folder_ids:
            block_reason = "No lines in the selected folders."
    summary = {
        "filename": name,
        "folder": folder,
        "folders_found": folders_found,
        "lines": len(lines),
        "block_reason": block_reason,
        **result,
    }
    upload_id = insert_upload(db, admin.id, name, "kmz", summary)
    db.commit()
    return preview_from(upload_id, summary)


@router.post("/uploads/{upload_id}/apply")
def apply(db: DB, admin: Admin, upload_id: int) -> KmzApplyOut:
    with logged_apply("kmz", upload_id, admin.id):
        return _apply(db, upload_id)


def _apply(db: DB, upload_id: int) -> KmzApplyOut:
    try:
        upload_row = lock_staged_upload(db, upload_id, "kmz", "Already applied or discarded")
    except ApplyError as error:
        raise HTTPException(error.status, error.message) from error
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
    finish_upload(db, upload_id)
    db.commit()
    return KmzApplyOut(upload_id=upload_id, shaped=saved)
