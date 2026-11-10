"""Admin editing (Session 8): core ports, segment fields, site fields, and data_edits history.

Every changed field is its own data_edits row (old, new, reason, user). Field names match what the upload
modules compare for protection: site name/location ("lat,lon")/region (stored in details.region)/active,
segment distance_km/region/site_a_id/site_b_id/survey_cores/cable_size, core ports.
"""
from decimal import Decimal
from typing import Annotated, Any, Literal

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel, Field
from sqlalchemy import text
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.auth.deps import DB, Admin, CurrentUser, require_admin
from app.ingest import checks
from app.ingest.reservation_import import add_cores, port
from app.inventory import service as inventory
from app.inventory.schemas import CoreHolderDetail
from app.link_type import ROUTE_TYPE_SQL
from app.reservations.schemas import NO_REASON, Reason
from app.reservations.service import conflict
from app.routing.graph import invalidate as invalidate_routes

router = APIRouter(prefix="/api/admin", dependencies=[Depends(require_admin)])
Entity = Literal["core", "segment", "site"]
HISTORY_SHOWN = 10  # history rows returned with an item, newest first
SITE_FIELDS = ("site_a_id", "site_b_id")

# ---------- SQL ----------

HISTORY_SQL = """
SELECT d.field, d.old_value, d.new_value, d.reason, d.user_id, u.display_name AS "user", d.created_at AS at
FROM data_edits d JOIN users u ON u.id = d.user_id
WHERE d.entity = :entity AND d.entity_id = :entity_id
ORDER BY d.created_at DESC, d.id DESC LIMIT :limit
"""
INSERT_EDIT_SQL = """
INSERT INTO data_edits (entity, entity_id, field, old_value, new_value, reason, user_id)
VALUES (:entity, :entity_id, :field, :old_value, :new_value, :reason, :user_id)
"""

CORE_PORTS_SQL = """
SELECT c.segment_id, c.port_a_id, c.port_b_id, s.site_a_id, s.site_b_id
FROM cores c JOIN segments s ON s.id = c.segment_id WHERE c.id = :core_id
"""
LOCK_SEGMENT_SQL = "SELECT id FROM segments WHERE id = :segment_id FOR UPDATE"
PORT_LABEL_SQL = "SELECT port_id FROM ports WHERE id = :port_row_id"
PORT_SITE_SQL = "SELECT site_id FROM ports WHERE port_id = :label"
SET_CORE_PORT_SQL = {
    "port_a": "UPDATE cores SET port_a_id = :port_row_id WHERE id = :core_id",
    "port_b": "UPDATE cores SET port_b_id = :port_row_id WHERE id = :core_id",
}

SEGMENT_SQL = f"""
SELECT s.id, s.site_a_id, s.site_b_id, a.name AS site_a, b.name AS site_b,
       {ROUTE_TYPE_SQL} AS route_type, s.region, s.distance_km, s.survey_cores, s.cable_size, s.fiber_cut
FROM segments s JOIN sites a ON a.id = s.site_a_id JOIN sites b ON b.id = s.site_b_id
WHERE s.id = :segment_id
"""
LOCK_SEGMENT_ROW_SQL = "SELECT * FROM segments WHERE id = :segment_id FOR UPDATE"
HIGHEST_CORE_SQL = "SELECT coalesce(max(number), 0) FROM cores WHERE segment_id = :segment_id"
# Cores above the new count that must stay: taken, ever reserved, edited, or carrying ports or a circuit
BLOCKING_CORES_SQL = """
SELECT c.id, c.number FROM cores c JOIN core_status_v v ON v.core_id = c.id
WHERE c.segment_id = :segment_id AND c.number > :new_count AND (
  v.status <> 'Available'
  OR EXISTS (SELECT 1 FROM reservation_cores rc WHERE rc.core_id = c.id)
  OR EXISTS (SELECT 1 FROM data_edits d WHERE d.entity = 'core' AND d.entity_id = c.id)
  OR c.port_a_id IS NOT NULL OR c.port_b_id IS NOT NULL OR c.circuit_id IS NOT NULL
)
ORDER BY c.number
"""
FREE_AFTER_SQL = """
SELECT count(*) FROM cores c JOIN core_status_v v ON v.core_id = c.id
WHERE c.segment_id = :segment_id AND c.number <= :new_count AND v.status = 'Available'
"""
RESERVED_BY_COUNT_SQL = """
SELECT coalesce(sum(remaining), 0) FROM reservation_unassigned_v WHERE segment_id = :segment_id
"""
COUNT_SITES_SQL = "SELECT count(*) FROM sites WHERE id = ANY(CAST(:ids AS bigint[]))"
OTHER_SEGMENT_SQL = """
SELECT 1 FROM segments WHERE id <> :segment_id
  AND least(site_a_id, site_b_id) = least(CAST(:site_a AS bigint), CAST(:site_b AS bigint))
  AND greatest(site_a_id, site_b_id) = greatest(CAST(:site_a AS bigint), CAST(:site_b AS bigint))
"""
ANY_HOLD_SQL = """
SELECT 1 FROM core_holds h JOIN cores c ON c.id = h.core_id WHERE c.segment_id = :segment_id LIMIT 1
"""
ANY_COUNT_HOLD_SQL = "SELECT 1 FROM reservation_unassigned_v WHERE segment_id = :segment_id AND remaining > 0"
# column names come from SegmentBody fields only, never user text
SET_SEGMENT_FIELD_SQL = "UPDATE segments SET {column} = :value WHERE id = :segment_id"
SET_SEGMENT_SITES_SQL = "UPDATE segments SET site_a_id = :site_a, site_b_id = :site_b WHERE id = :segment_id"

SITE_SQL = """
SELECT id, name, kind, ST_Y(geom) AS lat, ST_X(geom) AS lon, details->>'region' AS region, active
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
SITE_IN_SEGMENT_SQL = "SELECT 1 FROM segments WHERE site_a_id = :site_id OR site_b_id = :site_id LIMIT 1"
SET_SITE_ACTIVE_SQL = "UPDATE sites SET active = :active WHERE id = :site_id"


class HistoryRow(BaseModel):
    field: str
    old_value: str | None
    new_value: str | None
    reason: str
    user_id: int
    user: str
    at: Any


class Edited(BaseModel):
    id: int
    changed: list[str]
    history: list[HistoryRow]  # latest 10 for this item, newest first


def history(db: Session, entity: str, entity_id: int, limit: int | None = None) -> list[HistoryRow]:
    params = {"entity": entity, "entity_id": entity_id, "limit": limit}
    rows = db.execute(text(HISTORY_SQL), params).mappings()
    return [HistoryRow(**row) for row in rows]


def _text_or_none(value: Any) -> str | None:
    if value is None:
        return None
    return str(value)


def _log(db: Session, user: CurrentUser, entity: str, entity_id: int, edits: list[tuple[str, Any, Any]],
         reason: str) -> list[str]:
    for field_name, old, new in edits:
        params = {
            "entity": entity,
            "entity_id": entity_id,
            "field": field_name,
            "old_value": _text_or_none(old),
            "new_value": _text_or_none(new),
            "reason": reason or NO_REASON,
            "user_id": user.id,
        }
        db.execute(text(INSERT_EDIT_SQL), params)
    return [field_name for field_name, _, _ in edits]


def _bool_text(value: Any) -> str:
    """data_edits stores booleans as 'true' / 'false'."""
    return str(value).lower()


@router.get("/history")
def get_history(db: DB, entity: Entity, id: int) -> list[HistoryRow]:
    return history(db, entity, id)


# ---------- core ports (typed by hand; the reservation upload does not import ports) ----------

class CorePortsBody(BaseModel):
    port_a: str | None = None  # label at the segment's first site; null or empty clears it
    port_b: str | None = None  # label at the segment's second site
    reason: Reason = ""


def _port_label(db: Session, port_row_id: int | None) -> str | None:
    if not port_row_id:
        return None
    return db.execute(text(PORT_LABEL_SQL), {"port_row_id": port_row_id}).scalar_one_or_none()


def _port_for_site(db: Session, label: str, site_id: int) -> int:
    """The port row for a label at this site, made if new; a label already used at another site is refused."""
    at_site = db.execute(text(PORT_SITE_SQL), {"label": label}).scalar_one_or_none()
    if at_site is not None and at_site != site_id:
        raise conflict(f"Port '{label}' already belongs to another site.")
    return port(db, {}, label, site_id)


@router.post("/cores/{core_id}/ports")
def set_core_ports(db: DB, admin: Admin, core_id: int, body: CorePortsBody) -> CoreHolderDetail:
    found = db.execute(text(CORE_PORTS_SQL), {"core_id": core_id}).first()
    if found is None:
        raise HTTPException(404, "Core not found")
    segment_id, current_a, current_b, site_a, site_b = found
    db.execute(text(LOCK_SEGMENT_SQL), {"segment_id": segment_id})
    edits: list[tuple[str, Any, Any]] = []
    new_port_ids: dict[str, int | None] = {}
    ends = (("port_a", body.port_a, current_a, site_a), ("port_b", body.port_b, current_b, site_b))
    for field_name, typed, current_row_id, site_id in ends:
        label = (typed or "").strip() or None
        old = _port_label(db, current_row_id)
        if label == old:
            continue
        if label is None:
            new_port_ids[field_name] = None
        else:
            new_port_ids[field_name] = _port_for_site(db, label, site_id)
        edits.append((field_name, old, label))
    if edits:
        for field_name, port_row_id in new_port_ids.items():
            db.execute(text(SET_CORE_PORT_SQL[field_name]), {"port_row_id": port_row_id, "core_id": core_id})
        _log(db, admin, "core", core_id, edits, body.reason)
        db.commit()
    core = inventory.get_core(db, core_id, admin.id)
    assert core is not None
    return core


# ---------- segments ----------

class SegmentBody(BaseModel):
    reason: Reason = ""
    distance_km: Decimal | None = Field(None, ge=0, max_digits=10, decimal_places=3)
    region: str | None = None
    site_a_id: int | None = None
    site_b_id: int | None = None
    survey_cores: int | None = Field(None, ge=0)
    cable_size: int | None = Field(None, gt=0)
    fiber_cut: bool | None = None


class SegmentEdit(BaseModel):
    id: int
    site_a_id: int
    site_b_id: int
    site_a: str
    site_b: str
    route_type: str | None
    region: str | None
    distance_km: Decimal | None
    survey_cores: int | None
    cable_size: int
    fiber_cut: bool
    history: list[HistoryRow]


# The path parameter keeps its name `sid`: the web client's generated types use it.
@router.get("/segments/{sid}")
def get_segment(db: DB, sid: int) -> SegmentEdit:
    row = db.execute(text(SEGMENT_SQL), {"segment_id": sid}).mappings().first()
    if row is None:
        raise HTTPException(404, "Segment not found")
    return SegmentEdit(**row, history=history(db, "segment", sid, HISTORY_SHOWN))


def _resize(db: Session, segment_id: int, new_count: int) -> None:
    highest = db.execute(text(HIGHEST_CORE_SQL), {"segment_id": segment_id}).scalar_one()
    if new_count > highest:
        # numbers up to `highest` already exist and simply become surveyed again
        add_cores(db, segment_id, new_count)
        return
    if new_count == highest:
        return
    params = {"segment_id": segment_id, "new_count": new_count}
    blocking = db.execute(text(BLOCKING_CORES_SQL), params).all()
    if blocking:
        numbers = [number for _, number in blocking]
        core_ids = [core_id for core_id, _ in blocking]
        listed = ", ".join(map(str, numbers))
        raise conflict(
            f"Cannot lower to {new_count}: cores {listed} are reserved, in use, have ports "
            "or have reservation history.",
            blocking_core_numbers=numbers,
            blocking_core_ids=core_ids,
        )
    free_after = db.execute(text(FREE_AFTER_SQL), params).scalar_one()
    reserved = db.execute(text(RESERVED_BY_COUNT_SQL), {"segment_id": segment_id}).scalar_one()
    if free_after < reserved:
        raise conflict(
            f"Cannot lower to {new_count}: {reserved} cores are reserved by count only "
            f"and only {free_after} would stay Available."
        )
    # rows above the new count stay (nothing is deleted); the inventory and booking queries hide them


def _has_active_reservations(db: Session, segment_id: int) -> bool:
    params = {"segment_id": segment_id}
    if db.execute(text(ANY_HOLD_SQL), params).first():
        return True
    return db.execute(text(ANY_COUNT_HOLD_SQL), params).first() is not None


def _check_sites(db: Session, segment_id: int, site_a: int, site_b: int) -> None:
    if site_a == site_b:
        raise HTTPException(422, "Site A and site B must differ")
    found = db.execute(text(COUNT_SITES_SQL), {"ids": [site_a, site_b]}).scalar_one()
    if found != 2:
        raise HTTPException(422, "Unknown site")
    params = {"segment_id": segment_id, "site_a": site_a, "site_b": site_b}
    if db.execute(text(OTHER_SEGMENT_SQL), params).first():
        raise conflict("These two sites already have a segment.")
    if _has_active_reservations(db, segment_id):
        raise conflict("This segment has active reservations; release them before changing its sites.")


def _differs(field_name: str, new: Any, old: Any) -> bool:
    if field_name == "distance_km":
        return old is None or Decimal(new) != old
    return new != old


def _logged_change(field_name: str, old: Any, new: Any) -> tuple[str, Any, Any]:
    if field_name == "fiber_cut":
        return field_name, _bool_text(old), _bool_text(new)
    return field_name, old, new


@router.post("/segments/{sid}")
def edit_segment(db: DB, admin: Admin, sid: int, body: SegmentBody) -> Edited:
    old = db.execute(text(LOCK_SEGMENT_ROW_SQL), {"segment_id": sid}).mappings().first()
    if old is None:
        raise HTTPException(404, "Segment not found")
    new: dict[str, Any] = body.model_dump(exclude_none=True, exclude={"reason"})
    if "region" in new:
        region, error = checks.map_region(new["region"])
        if error:
            raise HTTPException(422, error)
        new["region"] = region
    changes = {name: value for name, value in new.items() if _differs(name, value, old[name])}
    if not changes:
        raise HTTPException(400, "nothing changed")
    sites_change = "site_a_id" in changes or "site_b_id" in changes
    site_a = changes.get("site_a_id", old["site_a_id"])
    site_b = changes.get("site_b_id", old["site_b_id"])
    if sites_change:
        _check_sites(db, sid, site_a, site_b)
    if "survey_cores" in changes:
        _resize(db, sid, changes["survey_cores"])
    for field_name, value in changes.items():
        if field_name in SITE_FIELDS:
            continue
        sql = SET_SEGMENT_FIELD_SQL.format(column=field_name)
        db.execute(text(sql), {"value": value, "segment_id": sid})
    if sites_change:
        # one statement: a swap passes the differ check only as a pair
        db.execute(text(SET_SEGMENT_SITES_SQL), {"site_a": site_a, "site_b": site_b, "segment_id": sid})
    edits = [_logged_change(name, old[name], value) for name, value in changes.items()]
    done = _log(db, admin, "segment", sid, edits, body.reason)
    db.commit()
    invalidate_routes()  # distance, site or fiber cut change alters the routing graph
    return Edited(id=sid, changed=done, history=history(db, "segment", sid, HISTORY_SHOWN))


# ---------- sites ----------

class SiteBody(BaseModel):
    reason: Reason = ""
    name: str | None = None
    lat: float | None = None
    lon: float | None = None
    region: str | None = None
    active: bool | None = None  # no other endpoint deactivates a site


class SiteEdit(BaseModel):
    id: int
    name: str
    kind: str
    lat: float | None
    lon: float | None
    region: str | None
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


def _edit_active(db: Session, site_id: int, active: bool | None, old: Any,
                 edits: list[tuple[str, Any, Any]]) -> None:
    if active is None or active == old["active"]:
        return
    if not active and db.execute(text(SITE_IN_SEGMENT_SQL), {"site_id": site_id}).first():
        raise conflict("This site is used by a segment and cannot be deactivated.")
    db.execute(text(SET_SITE_ACTIVE_SQL), {"active": active, "site_id": site_id})
    edits.append(("active", _bool_text(old["active"]), _bool_text(active)))


@router.post("/sites/{sid}")
def edit_site(db: DB, admin: Admin, sid: int, body: SiteBody) -> Edited:
    old = db.execute(text(SITE_SQL + " FOR UPDATE"), {"site_id": sid}).mappings().first()
    if old is None:
        raise HTTPException(404, "Site not found")
    edits: list[tuple[str, Any, Any]] = []
    _edit_name(db, sid, body.name, old, edits)
    _edit_location(db, sid, body, old, edits)
    _edit_region(db, sid, body.region, old, edits)
    _edit_active(db, sid, body.active, old, edits)
    if not edits:
        raise HTTPException(400, "nothing changed")
    try:
        done = _log(db, admin, "site", sid, edits, body.reason)
        db.commit()
    except IntegrityError:
        db.rollback()
        raise conflict("Another site already has this name.") from None
    return Edited(id=sid, changed=done, history=history(db, "site", sid, HISTORY_SHOWN))
