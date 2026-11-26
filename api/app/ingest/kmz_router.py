"""Admin KMZ upload: stage a preview of segment shapes, then apply."""
import io
import math
from typing import Annotated, Literal

from datetime import date, datetime

from fastapi import APIRouter, Depends, Form, HTTPException, Query, Response, UploadFile
from pydantic import BaseModel

from app.auth.deps import DB, Admin, require_admin
from app.ingest import kmz_edit, kmz_route_lines, kmz_segment_routes
from app.ingest.kmz import DEFAULT_FOLDER, apply_upload, folder_tree, stage_preview
from app.ingest.upload_file import read_upload
from app.ingest.uploads import get_upload
from app.map.router import kmz_response
from app.map.service import group_kml
from app.observability import logged_apply
from app.reservations.schemas import Remarks

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


class KmzRouteLineOut(BaseModel):
    key: str  # folder id and element index, stable until apply
    name: str
    folder_path: str
    suggested_segment_id: int | None
    suggested_by: Literal["title"] | None
    coords: list[list[float]] = []  # [lon, lat] thinned to at most PREVIEW_VERTICES, for the map preview


class KmzLocationSuggestion(BaseModel):
    key: str
    segment_id: int
    suggested_by: Literal["location"]


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
    route_lines: list[KmzRouteLineOut] = []


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


class KmzClusterSite(BaseModel):
    id: int
    name: str


class KmzCluster(BaseModel):
    id: int
    name: str
    sites: list[KmzClusterSite]


class KmzTarget(BaseModel):
    kind: Literal["segment", "site", "cluster"]
    id: int


class KmzGroupPatch(BaseModel):
    name: str | None = None
    hidden: bool | None = None
    colour_mode: Literal["theme", "kmz"] | None = None
    target: KmzTarget | None = None
    remarks: Remarks = ""


class KmzGroupUpload(BaseModel):
    id: int
    filename: str
    created_at: datetime


class KmzGroupListed(BaseModel):
    id: int
    name: str
    folder_path: str
    counts: KmzGroupCounts
    colour_mode: Literal["theme", "kmz"]
    hidden: bool
    hidden_at: datetime | None
    target: KmzTarget
    upload: KmzGroupUpload


class SegmentRouteOut(BaseModel):
    id: int  # the route group id
    folder: str
    name: str
    distance_km: float
    file: str
    uploaded: date


class StagedLineStatus(BaseModel):
    key: str
    distance_km: float
    status: Literal["same", "replaces route", "new"]


class SegmentLineStatusOut(BaseModel):
    lines: list[StagedLineStatus]
    stored: list[list[list[float]]]  # each stored route as [lon, lat] points, for the map


class KmzClusterSiteIn(BaseModel):
    site_id: int
    remarks: Remarks = ""


class KmzClusterPatch(BaseModel):
    name: str
    remarks: Remarks = ""


class KmzApplyGroup(BaseModel):
    key: str
    target: Literal["segment", "site", "cluster", "skip"]
    target_id: int | None = None
    new_cluster_name: str | None = None  # cluster target only, instead of target_id
    colour_mode: Literal["theme", "kmz"] = "theme"
    member_site_ids: list[int] = []  # cluster target only


class KmzApplyRouteLine(BaseModel):
    key: str
    segment_id: int


class KmzApplyIn(BaseModel):
    route_segment_ids: list[int] | None = None  # None = every previewed route line
    groups: list[KmzApplyGroup] = []  # groups not listed are skipped
    per_segment: bool = False  # the per-segment box: 'same' lines are skipped, earlier routes hidden only if replaced
    route_lines: list[KmzApplyRouteLine] | None = None  # lines saved as drawn on their segment; replaces the title join


class KmzApplyOut(BaseModel):
    upload_id: int
    shaped: int
    groups_saved: int = 0
    clusters_created: int = 0
    route_lines_saved: int = 0


PREVIEW_VERTICES = 100


def preview_coords(geometry: dict) -> list[list[float]]:
    """The line's vertices (a MultiLineString's parts one after another), every Nth kept, always the last."""
    vertices = geometry["coordinates"]
    if geometry["type"] == "MultiLineString":
        vertices = [vertex for part in vertices for vertex in part]
    step = max(1, math.ceil(len(vertices) / PREVIEW_VERTICES))
    thinned = vertices[::step]
    if thinned[-1] != vertices[-1]:
        thinned.append(vertices[-1])
    return [[vertex[0], vertex[1]] for vertex in thinned]


def route_line_out(line: dict) -> KmzRouteLineOut:
    return KmzRouteLineOut(**line, coords=preview_coords(line["geometry"]))


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
        route_lines=[route_line_out(line) for line in summary.get("route_lines", [])],
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
    line_choices = [line.model_dump() for line in body.route_lines or []]
    with logged_apply("kmz", upload_id, admin.id):
        result = apply_upload(db, admin.id, upload_id, body.route_segment_ids, choices, line_choices, body.per_segment)
        return KmzApplyOut(upload_id=upload_id, **result)


@router.post("/uploads/{upload_id}/suggest-by-location")
def suggest_by_location(db: DB, upload_id: int) -> list[KmzLocationSuggestion]:
    """Segments whose two sites lie near the two ends of each staged line. Saves nothing."""
    upload = get_upload(db, upload_id, "kmz")
    route_lines = upload["summary"].get("route_lines", [])
    return [KmzLocationSuggestion(**item) for item in kmz_route_lines.suggest_by_location(db, route_lines)]


@router.get("/clusters")
def clusters(db: DB) -> list[KmzCluster]:
    """Cluster picker for the KMZ preview, with each cluster's active sites."""
    return [KmzCluster(**cluster) for cluster in kmz_edit.all_clusters(db)]


@router.patch("/clusters/{cluster_id}")
def rename_cluster(db: DB, admin: Admin, cluster_id: int, body: KmzClusterPatch) -> KmzCluster:
    cluster = kmz_edit.rename_cluster(db, admin.id, cluster_id, body.name, body.remarks)
    db.commit()
    return KmzCluster(**cluster)


@router.post("/clusters/{cluster_id}/sites", status_code=201)
def add_cluster_site(db: DB, admin: Admin, cluster_id: int, body: KmzClusterSiteIn) -> KmzCluster:
    cluster = kmz_edit.add_site(db, admin.id, cluster_id, body.site_id, body.remarks)
    db.commit()
    return KmzCluster(**cluster)


@router.delete("/clusters/{cluster_id}/sites/{site_id}", status_code=204)
def remove_cluster_site(
    db: DB, admin: Admin, cluster_id: int, site_id: int, remarks: Annotated[Remarks, Query()] = ""
) -> Response:
    kmz_edit.remove_site(db, admin.id, cluster_id, site_id, remarks)
    db.commit()
    return Response(status_code=204)


@router.get("/groups")
def list_groups(
    db: DB,
    segment_id: Annotated[int | None, Query()] = None,
    site_id: Annotated[int | None, Query()] = None,
    cluster_id: Annotated[int | None, Query()] = None,
) -> list[KmzGroupListed]:
    return [KmzGroupListed(**group) for group in kmz_edit.groups_for(db, segment_id, site_id, cluster_id)]


@router.patch("/groups/{group_id}")
def patch_group(db: DB, admin: Admin, group_id: int, body: KmzGroupPatch) -> KmzGroupListed:
    changes = body.model_dump(exclude={"remarks"}, exclude_none=True)
    group = kmz_edit.edit_group(db, admin.id, group_id, changes, body.remarks)
    db.commit()
    return KmzGroupListed(**group)


@router.get("/segments/{segment_id}/routes")
def segment_routes(db: DB, segment_id: int) -> list[SegmentRouteOut]:
    """The segment's visible route lines. Remove and Undo are PATCH /groups/{id} with hidden true / false."""
    rows = kmz_segment_routes.stored_routes(db, segment_id)
    return [SegmentRouteOut(id=row["id"], folder=row["folder_path"], name=row["name"],
                            distance_km=row["distance_km"], file=row["filename"], uploaded=row["uploaded"])
            for row in rows]


@router.get("/uploads/{upload_id}/segments/{segment_id}/lines")
def segment_line_statuses(db: DB, upload_id: int, segment_id: int) -> SegmentLineStatusOut:
    """Each staged line against this segment's stored routes. Saves nothing."""
    upload = get_upload(db, upload_id, "kmz")
    found = kmz_segment_routes.line_statuses(db, segment_id, upload["summary"].get("route_lines", []))
    stored = [preview_coords(shape) for shape in kmz_segment_routes.stored_shapes(db, segment_id)]
    return SegmentLineStatusOut(lines=found, stored=stored)


@router.get("/groups/{group_id}/kmz", response_class=Response)
def group_kmz(db: DB, group_id: int) -> Response:
    found = group_kml(db, group_id)
    if found is None:
        raise HTTPException(404, "Route not found")
    name, kml = found
    return kmz_response(name, kml)
