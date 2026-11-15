"""Site list, get and edit."""
from typing import Annotated, Any

from fastapi import APIRouter, HTTPException, Query
from pydantic import BaseModel
from sqlalchemy import text
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.admin_edits.history import HISTORY_SHOWN, Edited, HistoryRow, bool_text, history, log_edits
from app.auth.deps import DB, Admin
from app.ingest import checks
from app.reservations.schemas import Reason
from app.reservations.service import conflict

router = APIRouter()

SITE_SQL = """
SELECT id, name, kind, ST_Y(geom) AS lat, ST_X(geom) AS lon, details->>'region' AS region, details->>'cluster' AS cluster, active
FROM sites WHERE id = :site_id
"""
FIND_SITES_SQL = "SELECT id, name FROM sites WHERE name ILIKE '%' || :q || '%' ORDER BY name LIMIT 20"
NAME_TAKEN_SQL = "SELECT 1 FROM sites WHERE name = :name AND id <> :site_id"
SET_SITE_NAME_SQL = "UPDATE sites SET name = :name WHERE id = :site_id"
SET_SITE_LOCATION_SQL = """
UPDATE sites
SET geom = ST_SetSRID(ST_MakePoint(CAST(:lon AS double precision), CAST(:lat AS double precision)), 4326)
WHERE id = :site_id
"""
SET_SITE_REGION_SQL = """
UPDATE sites
SET details = jsonb_set(coalesce(details, '{}'::jsonb), '{region}', to_jsonb(CAST(:region AS text)))
WHERE id = :site_id
"""
SET_SITE_CLUSTER_SQL = """
UPDATE sites
SET details = jsonb_set(coalesce(details, '{}'::jsonb), '{cluster}', to_jsonb(CAST(:cluster AS text)))
WHERE id = :site_id
"""
CLEAR_SITE_CLUSTER_SQL = "UPDATE sites SET details = details - 'cluster' WHERE id = :site_id"
SITE_IN_SEGMENT_SQL = "SELECT 1 FROM segments WHERE site_a_id = :site_id OR site_b_id = :site_id LIMIT 1"
SET_SITE_ACTIVE_SQL = "UPDATE sites SET active = :active WHERE id = :site_id"
SITE_FOR_UPDATE_SQL = SITE_SQL + " FOR UPDATE"


class SiteBody(BaseModel):
    reason: Reason = ""
    name: str | None = None
    lat: float | None = None
    lon: float | None = None
    region: str | None = None
    cluster: str | None = None  # blank text clears it
    active: bool | None = None  # no other endpoint deactivates a site


class SiteEdit(BaseModel):
    id: int
    name: str
    kind: str
    lat: float | None
    lon: float | None
    region: str | None
    cluster: str | None
    active: bool
    history: list[HistoryRow]


@router.get("/sites")
def find_sites(db: DB, q: Annotated[str, Query(min_length=1)]) -> list[dict[str, Any]]:
    """Site picker for the segment form: id and name, 20 best matches."""
    rows = db.execute(text(FIND_SITES_SQL), {"q": q}).mappings()
    return [dict(row) for row in rows]


@router.get("/sites/{sid}")
def get_site(db: DB, sid: int) -> SiteEdit:
    row = db.execute(text(SITE_SQL), {"site_id": sid}).mappings().first()
    if row is None:
        raise HTTPException(404, "Site not found")
    return SiteEdit(**row, history=history(db, "site", sid, HISTORY_SHOWN))


def _edit_name(
    db: Session, site_id: int, typed: str | None, old: Any, edits: list[tuple[str, Any, Any]]
) -> None:
    if typed is None:
        return
    name = " ".join(typed.split())
    if not name:
        raise HTTPException(422, "Name cannot be blank")
    if name == old["name"]:
        return
    if db.execute(text(NAME_TAKEN_SQL), {"name": name, "site_id": site_id}).first():
        raise conflict("Another site already has this name.")
    db.execute(text(SET_SITE_NAME_SQL), {"name": name, "site_id": site_id})
    edits.append(("name", old["name"], name))


def _edit_location(
    db: Session, site_id: int, body: SiteBody, old: Any, edits: list[tuple[str, Any, Any]]
) -> None:
    if body.lat is None and body.lon is None:
        return
    lat = old["lat"] if body.lat is None else body.lat
    lon = old["lon"] if body.lon is None else body.lon
    error = checks.check_coords(lat, lon)
    if error:
        raise HTTPException(422, error)
    if (lat, lon) == (old["lat"], old["lon"]):
        return
    db.execute(text(SET_SITE_LOCATION_SQL), {"lat": lat, "lon": lon, "site_id": site_id})
    old_location = None
    if old["lat"] is not None:
        old_location = f"{old['lat']},{old['lon']}"
    edits.append(("location", old_location, f"{lat},{lon}"))


def _edit_region(
    db: Session, site_id: int, typed: str | None, old: Any, edits: list[tuple[str, Any, Any]]
) -> None:
    if typed is None:
        return
    region, error = checks.map_region(typed)
    if error:
        raise HTTPException(422, error)
    if region == old["region"]:
        return
    db.execute(text(SET_SITE_REGION_SQL), {"region": region, "site_id": site_id})
    edits.append(("region", old["region"], region))


def _edit_cluster(
    db: Session, site_id: int, typed: str | None, old: Any, edits: list[tuple[str, Any, Any]]
) -> None:
    if typed is None:
        return
    cluster = " ".join(typed.split()) or None
    if cluster == old["cluster"]:
        return
    if cluster is None:
        db.execute(text(CLEAR_SITE_CLUSTER_SQL), {"site_id": site_id})
    else:
        db.execute(text(SET_SITE_CLUSTER_SQL), {"cluster": cluster, "site_id": site_id})
    edits.append(("cluster", old["cluster"], cluster))


def _edit_active(db: Session, site_id: int, active: bool | None, old: Any,
                 edits: list[tuple[str, Any, Any]]) -> None:
    if active is None or active == old["active"]:
        return
    if not active and db.execute(text(SITE_IN_SEGMENT_SQL), {"site_id": site_id}).first():
        raise conflict("This site is used by a segment and cannot be deactivated.")
    db.execute(text(SET_SITE_ACTIVE_SQL), {"active": active, "site_id": site_id})
    edits.append(("active", bool_text(old["active"]), bool_text(active)))


@router.post("/sites/{sid}")
def edit_site(db: DB, admin: Admin, sid: int, body: SiteBody) -> Edited:
    old = db.execute(text(SITE_FOR_UPDATE_SQL), {"site_id": sid}).mappings().first()
    if old is None:
        raise HTTPException(404, "Site not found")
    edits: list[tuple[str, Any, Any]] = []
    _edit_name(db, sid, body.name, old, edits)
    _edit_location(db, sid, body, old, edits)
    _edit_region(db, sid, body.region, old, edits)
    _edit_cluster(db, sid, body.cluster, old, edits)
    _edit_active(db, sid, body.active, old, edits)
    if not edits:
        raise HTTPException(400, "nothing changed")
    try:
        done = log_edits(db, admin, "site", sid, edits, body.reason)
        db.commit()
    except IntegrityError:
        db.rollback()
        raise conflict("Another site already has this name.") from None
    return Edited(id=sid, changed=done, history=history(db, "site", sid, HISTORY_SHOWN))
