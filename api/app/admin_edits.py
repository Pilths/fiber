"""Admin editing (Session 8): core status, span fields, site fields, and data_edits history.

Every changed field is its own data_edits row (old, new, reason, user). Field names match what the upload
modules compare for protection: site name/location ("lat,lon")/region (stored in details.region)/active,
span distance_km/route_type/region/site_a_id/site_b_id/survey_cores/cable_size, core status.
"""
from decimal import Decimal
from typing import Annotated, Any, Literal

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel, Field
from sqlalchemy import text
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.auth.deps import CurrentUser, require_admin
from app.db import get_db
from app.ingest import checks
from app.ingest.reservation_import import add_cores, port
from app.inventory import service as inventory
from app.inventory.schemas import CoreHolderDetail
from app.reservations.schemas import Reason
from app.reservations.service import conflict
from app.routing.graph import invalidate as invalidate_routes

router = APIRouter(prefix="/api/admin", dependencies=[Depends(require_admin)])
DB = Annotated[Session, Depends(get_db)]
Admin = Annotated[CurrentUser, Depends(require_admin)]
Entity = Literal["core", "span", "site"]


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


def history(db: Session, entity: str, eid: int, limit: int | None = None) -> list[HistoryRow]:
    rows = db.execute(text(
        "SELECT d.field, d.old_value, d.new_value, d.reason, d.user_id, u.display_name AS \"user\", d.created_at AS at "
        "FROM data_edits d JOIN users u ON u.id = d.user_id WHERE d.entity = :e AND d.entity_id = :i "
        "ORDER BY d.created_at DESC, d.id DESC LIMIT :n"), {"e": entity, "i": eid, "n": limit}).mappings()
    return [HistoryRow(**r) for r in rows]


def _log(db: Session, user: CurrentUser, entity: str, eid: int, edits: list[tuple[str, Any, Any]], reason: str) -> list[str]:
    for field, old, new in edits:
        db.execute(text("INSERT INTO data_edits (entity, entity_id, field, old_value, new_value, reason, user_id) "
                        "VALUES (:e, :i, :f, :o, :n, :r, :u)"),
                   {"e": entity, "i": eid, "f": field, "o": None if old is None else str(old),
                    "n": None if new is None else str(new), "r": reason, "u": user.id})
    return [f for f, _, _ in edits]


@router.get("/history")
def get_history(db: DB, entity: Entity, id: int) -> list[HistoryRow]:
    return history(db, entity, id)


# ---------- core ports (typed by hand; the reservation upload does not import ports) ----------

class CorePortsBody(BaseModel):
    port_a: str | None = None  # label at the span's first site; null or empty clears it
    port_b: str | None = None  # label at the span's second site
    reason: Reason


@router.post("/cores/{core_id}/ports")
def set_core_ports(db: DB, admin: Admin, core_id: int, body: CorePortsBody) -> CoreHolderDetail:
    found = db.execute(text("SELECT c.span_id, c.port_a_id, c.port_b_id, s.site_a_id, s.site_b_id FROM cores c "
                            "JOIN spans s ON s.id = c.span_id WHERE c.id = :c"), {"c": core_id}).first()
    if found is None:
        raise HTTPException(404, "Core not found")
    span, cur_a, cur_b, site_a, site_b = found
    db.execute(text("SELECT id FROM spans WHERE id = :s FOR UPDATE"), {"s": span})
    edits: list[tuple[str, Any, Any]] = []
    new_ids = {}
    for fld, label, cur, site in (("port_a", body.port_a, cur_a, site_a), ("port_b", body.port_b, cur_b, site_b)):
        label = (label or "").strip() or None
        old = db.execute(text("SELECT port_id FROM ports WHERE id = :i"), {"i": cur}).scalar_one_or_none() if cur else None
        if label == old:
            continue
        if label is not None:
            at = db.execute(text("SELECT site_id FROM ports WHERE port_id = :p"), {"p": label}).scalar_one_or_none()
            if at is not None and at != site:
                raise conflict(f"Port '{label}' already belongs to another site.")
            new_ids[fld] = port(db, {}, label, site)
        else:
            new_ids[fld] = None
        edits.append((fld, old, label))
    if edits:
        for fld, pid in new_ids.items():
            db.execute(text(f"UPDATE cores SET {fld}_id = :p WHERE id = :c"), {"p": pid, "c": core_id})
        _log(db, admin, "core", core_id, edits, body.reason)
        db.commit()
    core = inventory.get_core(db, core_id, admin.id)
    assert core is not None
    return core


# ---------- spans ----------

class SpanBody(BaseModel):
    reason: Reason
    distance_km: Decimal | None = Field(None, ge=0, max_digits=10, decimal_places=3)
    route_type: Literal["Trunk", "Metro"] | None = None
    region: str | None = None
    site_a_id: int | None = None
    site_b_id: int | None = None
    survey_cores: int | None = Field(None, ge=0)
    cable_size: int | None = Field(None, gt=0)
    fiber_cut: bool | None = None


class SpanEdit(BaseModel):
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


SPAN_Q = ("SELECT s.id, s.site_a_id, s.site_b_id, a.name AS site_a, b.name AS site_b, s.route_type, s.region, s.distance_km, "
          "s.survey_cores, s.cable_size, s.fiber_cut FROM spans s JOIN sites a ON a.id = s.site_a_id JOIN sites b ON b.id = s.site_b_id "
          "WHERE s.id = :i")


@router.get("/spans/{sid}")
def get_span(db: DB, sid: int) -> SpanEdit:
    row = db.execute(text(SPAN_Q), {"i": sid}).mappings().first()
    if row is None:
        raise HTTPException(404, "Span not found")
    return SpanEdit(**row, history=history(db, "span", sid, 10))


def _resize(db: Session, sid: int, new: int) -> None:
    have = db.execute(text("SELECT coalesce(max(number), 0) FROM cores WHERE span_id = :s"), {"s": sid}).scalar_one()
    if new > have:
        add_cores(db, sid, new)  # numbers up to `have` already exist and simply become surveyed again
        return
    if new == have:
        return
    blocking = db.execute(text(
        "SELECT c.id, c.number FROM cores c JOIN core_status_v v ON v.core_id = c.id WHERE c.span_id = :s AND c.number > :n AND ("
        "v.status <> 'Available' OR EXISTS (SELECT 1 FROM reservation_cores rc WHERE rc.core_id = c.id) "
        "OR EXISTS (SELECT 1 FROM data_edits d WHERE d.entity = 'core' AND d.entity_id = c.id) "
        "OR c.port_a_id IS NOT NULL OR c.port_b_id IS NOT NULL OR c.circuit_id IS NOT NULL) ORDER BY c.number"),
        {"s": sid, "n": new}).all()
    if blocking:
        nums = [n for _, n in blocking]
        raise conflict(f"Cannot lower to {new}: cores {', '.join(map(str, nums))} are reserved, in use, have ports "
                       "or have reservation history.", blocking_core_numbers=nums, blocking_core_ids=[i for i, _ in blocking])
    free_after = db.execute(text("SELECT count(*) FROM cores c JOIN core_status_v v ON v.core_id = c.id "
                                 "WHERE c.span_id = :s AND c.number <= :n AND v.status = 'Available'"), {"s": sid, "n": new}).scalar_one()
    reserved = db.execute(text("SELECT coalesce(sum(remaining), 0) FROM reservation_unassigned_v WHERE span_id = :s"), {"s": sid}).scalar_one()
    if free_after < reserved:
        raise conflict(f"Cannot lower to {new}: {reserved} cores are reserved by count only and only {free_after} would stay Available.")
    # rows above the new count stay (nothing is deleted); the inventory and booking queries hide them


def _check_sites(db: Session, sid: int, a: int, b: int) -> None:
    if a == b:
        raise HTTPException(422, "Site A and site B must differ")
    found = db.execute(text("SELECT count(*) FROM sites WHERE id = ANY(CAST(:i AS bigint[]))"), {"i": [a, b]}).scalar_one()
    if found != 2:
        raise HTTPException(422, "Unknown site")
    if db.execute(text("SELECT 1 FROM spans WHERE id <> :s AND least(site_a_id, site_b_id) = least(CAST(:a AS bigint), CAST(:b AS bigint)) "
                       "AND greatest(site_a_id, site_b_id) = greatest(CAST(:a AS bigint), CAST(:b AS bigint))"),
                  {"s": sid, "a": a, "b": b}).first():
        raise conflict("These two sites already have a span.")
    if db.execute(text("SELECT 1 FROM core_holds h JOIN cores c ON c.id = h.core_id WHERE c.span_id = :s LIMIT 1"), {"s": sid}).first() \
            or db.execute(text("SELECT 1 FROM reservation_unassigned_v WHERE span_id = :s AND remaining > 0"), {"s": sid}).first():
        raise conflict("This span has active reservations; release them before changing its sites.")


@router.post("/spans/{sid}")
def edit_span(db: DB, admin: Admin, sid: int, body: SpanBody) -> Edited:
    old = db.execute(text("SELECT * FROM spans WHERE id = :i FOR UPDATE"), {"i": sid}).mappings().first()
    if old is None:
        raise HTTPException(404, "Span not found")
    new: dict[str, Any] = body.model_dump(exclude_none=True, exclude={"reason"})
    if "region" in new:
        new["region"], err = checks.map_region(new["region"])
        if err:
            raise HTTPException(422, err)
    changes = {f: v for f, v in new.items() if (v != old[f] if f != "distance_km" else old[f] is None or Decimal(v) != old[f])}
    if not changes:
        raise HTTPException(400, "nothing changed")
    if "site_a_id" in changes or "site_b_id" in changes:
        _check_sites(db, sid, changes.get("site_a_id", old["site_a_id"]), changes.get("site_b_id", old["site_b_id"]))
    if "survey_cores" in changes:
        _resize(db, sid, changes["survey_cores"])
    for f, v in changes.items():
        if f not in ("site_a_id", "site_b_id"):
            db.execute(text(f"UPDATE spans SET {f} = :v WHERE id = :i"), {"v": v, "i": sid})  # f is a SpanBody field name
    if "site_a_id" in changes or "site_b_id" in changes:  # one statement: a swap passes the differ check only as a pair
        db.execute(text("UPDATE spans SET site_a_id = :a, site_b_id = :b WHERE id = :i"),
                   {"a": changes.get("site_a_id", old["site_a_id"]), "b": changes.get("site_b_id", old["site_b_id"]), "i": sid})
    done = _log(db, admin, "span", sid, [(f, old[f], v) if f != "fiber_cut" else (f, str(old[f]).lower(), str(v).lower()) for f, v in changes.items()], body.reason)
    db.commit()
    invalidate_routes()  # distance, site or fiber cut change alters the routing graph
    return Edited(id=sid, changed=done, history=history(db, "span", sid, 10))


# ---------- sites ----------

class SiteBody(BaseModel):
    reason: Reason
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


SITE_Q = ("SELECT id, name, kind, ST_Y(geom) AS lat, ST_X(geom) AS lon, details->>'region' AS region, active "
          "FROM sites WHERE id = :i")


@router.get("/sites")
def find_sites(db: DB, q: Annotated[str, Query(min_length=1)]) -> list[dict[str, Any]]:
    """Site picker for the span form: id and name, 20 best matches."""
    return [dict(r) for r in db.execute(text("SELECT id, name FROM sites WHERE name ILIKE '%' || :q || '%' ORDER BY name LIMIT 20"), {"q": q}).mappings()]


@router.get("/sites/{sid}")
def get_site(db: DB, sid: int) -> SiteEdit:
    row = db.execute(text(SITE_Q), {"i": sid}).mappings().first()
    if row is None:
        raise HTTPException(404, "Site not found")
    return SiteEdit(**row, history=history(db, "site", sid, 10))


@router.post("/sites/{sid}")
def edit_site(db: DB, admin: Admin, sid: int, body: SiteBody) -> Edited:
    old = db.execute(text(SITE_Q + " FOR UPDATE"), {"i": sid}).mappings().first()
    if old is None:
        raise HTTPException(404, "Site not found")
    edits: list[tuple[str, Any, Any]] = []
    name = " ".join(body.name.split()) if body.name is not None else None
    if body.name is not None and not name:
        raise HTTPException(422, "Name cannot be blank")
    if name and name != old["name"]:
        if db.execute(text("SELECT 1 FROM sites WHERE name = :n AND id <> :i"), {"n": name, "i": sid}).first():
            raise conflict("Another site already has this name.")
        db.execute(text("UPDATE sites SET name = :n WHERE id = :i"), {"n": name, "i": sid})
        edits.append(("name", old["name"], name))
    if body.lat is not None or body.lon is not None:
        lat = body.lat if body.lat is not None else old["lat"]
        lon = body.lon if body.lon is not None else old["lon"]
        if err := checks.check_coords(lat, lon):
            raise HTTPException(422, err)
        if (lat, lon) != (old["lat"], old["lon"]):
            db.execute(text("UPDATE sites SET geom = ST_SetSRID(ST_MakePoint(CAST(:lon AS double precision), "
                            "CAST(:lat AS double precision)), 4326) WHERE id = :i"), {"lat": lat, "lon": lon, "i": sid})
            had = old["lat"] is not None
            edits.append(("location", f"{old['lat']},{old['lon']}" if had else None, f"{lat},{lon}"))
    if body.region is not None:
        region, err = checks.map_region(body.region)
        if err:
            raise HTTPException(422, err)
        if region != old["region"]:
            db.execute(text("UPDATE sites SET details = jsonb_set(coalesce(details, '{}'::jsonb), '{region}', to_jsonb(CAST(:v AS text))) "
                            "WHERE id = :i"), {"v": region, "i": sid})
            edits.append(("region", old["region"], region))
    if body.active is not None and body.active != old["active"]:
        if not body.active and db.execute(text("SELECT 1 FROM spans WHERE site_a_id = :i OR site_b_id = :i LIMIT 1"), {"i": sid}).first():
            raise conflict("This site is used by a span and cannot be deactivated.")
        db.execute(text("UPDATE sites SET active = :a WHERE id = :i"), {"a": body.active, "i": sid})
        edits.append(("active", str(old["active"]).lower(), str(body.active).lower()))
    if not edits:
        raise HTTPException(400, "nothing changed")
    try:
        done = _log(db, admin, "site", sid, edits, body.reason)
        db.commit()
    except IntegrityError:
        db.rollback()
        raise conflict("Another site already has this name.") from None
    return Edited(id=sid, changed=done, history=history(db, "site", sid, 10))
