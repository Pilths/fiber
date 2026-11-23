"""Admin KMZ upload: stage a preview of segment shapes, then apply."""
import io
from typing import Annotated, Literal

from fastapi import APIRouter, Depends, Form, HTTPException, UploadFile
from pydantic import BaseModel
from sqlalchemy import text

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


class KmzElementOut(BaseModel):
    name: str
    kind: str


class KmzGroupCounts(BaseModel):
    lines: int
    areas: int
    points: int


class KmzGroupOut(BaseModel):
    key: str  # the folder id
    name: str
    folder_path: str
    counts: KmzGroupCounts
    elements: list[KmzElementOut]
    default_target: Literal["segment", "site", "cluster", "skip"]
    default_target_id: int | None
    status: Literal["Ready", "Needs review"]
    reason: str | None
    member_site_ids: list[int]  # active sites inside the group's areas, the members of a new cluster


class KmzUploadOut(BaseModel):
    upload_id: int
    filename: str
    folder: str
    folders_found: list[str]
    lines: int
    block_reason: str | None  # set when nothing can be applied
    shaped: list[KmzShaped]
    skipped: list[KmzSkipped]
    groups: list[KmzGroupOut]


class KmzFolder(BaseModel):
    id: str
    name: str
    lines: int
    areas: int
    points: int
    children: list["KmzFolder"]


class KmzFoldersOut(BaseModel):
    folders: list[KmzFolder]
    loose_lines: int


class KmzCluster(BaseModel):
    id: int
    name: str


class KmzApplyGroup(BaseModel):
    key: str
    target: Literal["segment", "site", "cluster", "skip"]
    target_id: int | None = None
    new_cluster_name: str | None = None  # cluster target only, instead of target_id
    colour_mode: Literal["theme", "kmz"] = "theme"
    member_site_ids: list[int] = []  # cluster target only


class KmzApplyIn(BaseModel):
    route_segment_ids: list[int] | None = None  # None = every previewed route line
    groups: list[KmzApplyGroup] = []  # groups not listed are skipped


class KmzApplyOut(BaseModel):
    upload_id: int
    shaped: int
    groups_saved: int = 0
    clusters_created: int = 0


def group_out(group: dict) -> KmzGroupOut:
    elements = [KmzElementOut(name=element["name"], kind=element["kind"]) for element in group["elements"]]
    fields = {key: value for key, value in group.items() if key not in ("elements", "outside_malaysia")}
    return KmzGroupOut(**fields, elements=elements)


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
        groups=[group_out(group) for group in summary.get("groups", [])],
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
def apply(db: DB, admin: Admin, upload_id: int, body: KmzApplyIn | None = None) -> KmzApplyOut:
    body = body or KmzApplyIn()
    choices = [group.model_dump() for group in body.groups]
    with logged_apply("kmz", upload_id, admin.id):
        result = apply_upload(db, admin.id, upload_id, body.route_segment_ids, choices)
        return KmzApplyOut(upload_id=upload_id, **result)


@router.get("/clusters")
def clusters(db: DB) -> list[KmzCluster]:
    """Cluster picker for the KMZ preview."""
    rows = db.execute(text("SELECT id, name FROM clusters ORDER BY name")).mappings()
    return [KmzCluster(**row) for row in rows]
