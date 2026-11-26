"""Segment get and edit."""
from decimal import Decimal
from typing import Any

from fastapi import APIRouter
from pydantic import BaseModel, Field
from sqlalchemy import text
from sqlalchemy.orm import Session

from app.errors import NotFound, Invalid, ServiceError
from app.admin_edits.history import HISTORY_SHOWN, Edited, HistoryRow, bool_text, history, log_edits
from app.auth.deps import DB, Admin
from app.ingest import checks
from app.inventory.capacity import check_count_only_holds_fit
from app.ingest.reservation_import import add_cores
from app.link_type import ROUTE_TYPE_SQL
from app.reservations.schemas import Remarks
from app.reservations.service import conflict
from app.routing.graph import invalidate as invalidate_routes

router = APIRouter()
SITE_FIELDS = ("site_a_id", "site_b_id")

SEGMENT_SQL = f"""
SELECT s.id, s.site_a_id, s.site_b_id, a.name AS site_a, b.name AS site_b,
       {ROUTE_TYPE_SQL} AS route_type, s.region, s.distance_km, s.survey_cores, s.cable_size, s.fiber_cut,
       s.route, s.section
FROM segments s JOIN sites a ON a.id = s.site_a_id JOIN sites b ON b.id = s.site_b_id
WHERE s.id = :segment_id
"""
LOCK_SEGMENT_ROW_SQL = "SELECT * FROM segments WHERE id = :segment_id FOR UPDATE"
HIGHEST_CORE_SQL = "SELECT coalesce(max(number), 0) FROM cores WHERE segment_id = :segment_id"
# Cores above the new count that must stay: taken, ever reserved, edited, or carrying ports
BLOCKING_CORES_SQL = """
SELECT c.id, c.number FROM cores c JOIN core_status_v v ON v.core_id = c.id
WHERE c.segment_id = :segment_id AND c.number > :new_count AND c.number <= :current_count AND (
  v.status <> 'Available'
  OR EXISTS (SELECT 1 FROM reservation_cores rc WHERE rc.core_id = c.id)
  OR EXISTS (SELECT 1 FROM data_edits d WHERE d.entity = 'core' AND d.entity_id = c.id)
  OR c.port_a_id IS NOT NULL OR c.port_b_id IS NOT NULL
)
ORDER BY c.number
"""
COUNT_SITES_SQL = "SELECT count(*) FROM sites WHERE id = ANY(CAST(:ids AS bigint[]))"
OTHER_SEGMENT_SQL = """
SELECT 1 FROM segments WHERE id <> :segment_id
  AND least(site_a_id, site_b_id) = least(CAST(:site_a AS bigint), CAST(:site_b AS bigint))
  AND greatest(site_a_id, site_b_id) = greatest(CAST(:site_a AS bigint), CAST(:site_b AS bigint))
"""
SEGMENT_LIST_SQL = f"""
SELECT s.id, a.name AS site_a, b.name AS site_b, s.site_a_id, s.site_b_id, {ROUTE_TYPE_SQL} AS route_type,
       s.route, s.section, s.distance_km, s.survey_cores, s.cable_size,
       (SELECT count(*) FROM kmz_elements e JOIN kmz_groups g ON g.id = e.group_id
        WHERE g.segment_id = s.id AND g.route AND g.hidden_at IS NULL AND e.kind = 'line') AS kmz_route_count
FROM segments s JOIN sites a ON a.id = s.site_a_id JOIN sites b ON b.id = s.site_b_id
ORDER BY a.name, b.name
"""
CREATE_SEGMENT_SQL = """
INSERT INTO segments (site_a_id, site_b_id, distance_km, route, section)
VALUES (:site_a, :site_b, :distance_km, :route, :section) RETURNING id
"""
ANY_HOLD_SQL = """
SELECT 1 FROM core_holds h JOIN cores c ON c.id = h.core_id WHERE c.segment_id = :segment_id LIMIT 1
"""
ANY_COUNT_HOLD_SQL = "SELECT 1 FROM reservation_unassigned_v WHERE segment_id = :segment_id AND remaining > 0"
# column names come from SegmentBody fields only, never user text
SET_SEGMENT_FIELD_SQL = "UPDATE segments SET {column} = :value WHERE id = :segment_id"
SET_SEGMENT_SITES_SQL = "UPDATE segments SET site_a_id = :site_a, site_b_id = :site_b WHERE id = :segment_id"


class SegmentBody(BaseModel):
    remarks: Remarks = ""
    distance_km: Decimal | None = Field(None, ge=0, max_digits=10, decimal_places=3)
    region: str | None = None
    route: str | None = None
    section: str | None = None
    site_a_id: int | None = None
    site_b_id: int | None = None
    survey_cores: int | None = Field(None, ge=0)
    cable_size: int | None = Field(None, gt=0)
    fiber_cut: bool | None = None


class SegmentListRow(BaseModel):
    id: int
    site_a: str
    site_b: str
    site_a_id: int
    site_b_id: int
    route_type: str
    route: str | None
    section: str | None
    distance_km: Decimal | None
    survey_cores: int | None
    cable_size: int
    kmz_route_count: int


class SegmentCreate(BaseModel):
    site_a_id: int
    site_b_id: int
    distance_km: Decimal = Field(gt=0, max_digits=10, decimal_places=3)
    route: str | None = None
    section: str | None = None
    remarks: Remarks = ""


class Created(BaseModel):
    id: int


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
    route: str | None
    section: str | None
    history: list[HistoryRow]


@router.get("/segments/list")
def list_segments(db: DB, admin: Admin) -> list[SegmentListRow]:
    rows = db.execute(text(SEGMENT_LIST_SQL)).mappings()
    return [SegmentListRow(**row) for row in rows]


def _blank_to_none(value: str | None) -> str | None:
    if value is None:
        return None
    return value.strip() or None


@router.post("/segments")
def create_segment(db: DB, admin: Admin, body: SegmentCreate) -> Created:
    if body.site_a_id == body.site_b_id:
        raise Invalid("Site A and site B must differ")
    found = db.execute(text(COUNT_SITES_SQL), {"ids": [body.site_a_id, body.site_b_id]}).scalar_one()
    if found != 2:
        raise NotFound("Unknown site")
    pair = {"segment_id": 0, "site_a": body.site_a_id, "site_b": body.site_b_id}
    if db.execute(text(OTHER_SEGMENT_SQL), pair).first():
        raise conflict("These two sites already have a segment.")
    params = {
        "site_a": body.site_a_id,
        "site_b": body.site_b_id,
        "distance_km": body.distance_km,
        "route": _blank_to_none(body.route),
        "section": _blank_to_none(body.section),
    }
    new_id = db.execute(text(CREATE_SEGMENT_SQL), params).scalar_one()
    log_edits(db, admin, "segment", new_id, [("created", None, str(body.distance_km))], body.remarks)
    db.commit()
    invalidate_routes()
    return Created(id=new_id)


# The path parameter keeps its name `sid`: the web client's generated types use it.
@router.get("/segments/{sid}")
def get_segment(db: DB, sid: int) -> SegmentEdit:
    row = db.execute(text(SEGMENT_SQL), {"segment_id": sid}).mappings().first()
    if row is None:
        raise NotFound("Segment not found")
    return SegmentEdit(**row, history=history(db, "segment", sid, HISTORY_SHOWN))


def _set_verified_cores(db: Session, segment_id: int, current: int | None, new_count: int) -> None:
    if current is None or new_count >= current:
        highest = db.execute(text(HIGHEST_CORE_SQL), {"segment_id": segment_id}).scalar_one()
        if new_count > highest:
            add_cores(db, segment_id, new_count)
        return
    params = {"segment_id": segment_id, "new_count": new_count, "current_count": current}
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
    check_count_only_holds_fit(db, segment_id, new_count)
    # rows above the new count stay (nothing is deleted); the inventory and booking queries hide them


def _has_active_reservations(db: Session, segment_id: int) -> bool:
    params = {"segment_id": segment_id}
    if db.execute(text(ANY_HOLD_SQL), params).first():
        return True
    return db.execute(text(ANY_COUNT_HOLD_SQL), params).first() is not None


def _check_sites(db: Session, segment_id: int, site_a: int, site_b: int) -> None:
    if site_a == site_b:
        raise Invalid("Site A and site B must differ")
    found = db.execute(text(COUNT_SITES_SQL), {"ids": [site_a, site_b]}).scalar_one()
    if found != 2:
        raise Invalid("Unknown site")
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
        return field_name, bool_text(old), bool_text(new)
    return field_name, old, new


@router.post("/segments/{sid}")
def edit_segment(db: DB, admin: Admin, sid: int, body: SegmentBody) -> Edited:
    old = db.execute(text(LOCK_SEGMENT_ROW_SQL), {"segment_id": sid}).mappings().first()
    if old is None:
        raise NotFound("Segment not found")
    new: dict[str, Any] = body.model_dump(exclude_none=True, exclude={"remarks"})
    if "region" in new:
        region, error = checks.map_region(new["region"])
        if error:
            raise Invalid(error)
        new["region"] = region
    for text_field in ("route", "section"):
        typed = getattr(body, text_field)
        if typed is not None:
            new[text_field] = _blank_to_none(typed)
    changes = {name: value for name, value in new.items() if _differs(name, value, old[name])}
    if not changes:
        raise ServiceError(400, "nothing changed")
    sites_change = "site_a_id" in changes or "site_b_id" in changes
    site_a = changes.get("site_a_id", old["site_a_id"])
    site_b = changes.get("site_b_id", old["site_b_id"])
    if sites_change:
        _check_sites(db, sid, site_a, site_b)
    if "survey_cores" in changes:
        _set_verified_cores(db, sid, old["survey_cores"], changes["survey_cores"])
    for field_name, value in changes.items():
        if field_name in SITE_FIELDS:
            continue
        sql = SET_SEGMENT_FIELD_SQL.format(column=field_name)
        db.execute(text(sql), {"value": value, "segment_id": sid})
    if sites_change:
        # one statement: a swap passes the differ check only as a pair
        db.execute(text(SET_SEGMENT_SITES_SQL), {"site_a": site_a, "site_b": site_b, "segment_id": sid})
    edits = [_logged_change(name, old[name], value) for name, value in changes.items()]
    done = log_edits(db, admin, "segment", sid, edits, body.remarks)
    db.commit()
    invalidate_routes()  # distance, site or fiber cut change alters the routing graph
    return Edited(id=sid, changed=done, history=history(db, "segment", sid, HISTORY_SHOWN))
