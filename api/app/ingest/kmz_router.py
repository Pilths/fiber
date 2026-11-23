"""Admin KMZ upload: stage a preview of segment shapes, then apply."""
import io
from typing import Annotated

from fastapi import APIRouter, Depends, Form, HTTPException, UploadFile
from pydantic import BaseModel

from app.auth.deps import DB, Admin, require_admin
from app.ingest.kmz import DEFAULT_FOLDER, apply_upload, folder_tree, stage_preview
from app.ingest.upload_file import read_upload
from app.observability import logged_apply

router = APIRouter(prefix="/api/admin/kmz", dependencies=[Depends(require_admin)])


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
        upload_id, summary = stage_preview(db, admin.id, name, data, folder, folder_ids)
    except ValueError as error:
        raise HTTPException(422, f"Cannot read the KMZ: {error}") from error
    return preview_from(upload_id, summary)


@router.post("/uploads/{upload_id}/apply")
def apply(db: DB, admin: Admin, upload_id: int) -> KmzApplyOut:
    with logged_apply("kmz", upload_id, admin.id):
        return KmzApplyOut(upload_id=upload_id, shaped=apply_upload(db, upload_id))
