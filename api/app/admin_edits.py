"""Admin editing (Session 8): core ports, segment fields, site fields, and data_edits history.

Every changed field is its own data_edits row (old, new, reason, user). Field names match what the upload
modules compare for protection: site name/location ("lat,lon")/region (stored in details.region)/active,
segment distance_km/region/site_a_id/site_b_id/survey_cores/cable_size, core ports.
"""
from datetime import date
from collections import Counter
from decimal import Decimal
from typing import Annotated, Any, Literal

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel, Field, model_validator
from sqlalchemy import text
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.auth.deps import DB, Admin, CurrentUser, require_admin
from app.ingest import checks
from app.ingest.reservation_import import add_cores, port
from app.inventory import service as inventory
from app.inventory.schemas import CoreHolderDetail
from app.link_type import ROUTE_TYPE_SQL
from app.port_label import LABEL_HELP, normalize_port_label
from app.loss import service as loss_service
from app.loss.schemas import CoreLoss
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
CORE_SURVEY_SQL = """
SELECT c.segment_id, c.number, s.survey_cores, s.distance_km
FROM cores c JOIN segments s ON s.id = c.segment_id
WHERE c.id = :core_id
"""
TODAY_KL_SQL = "SELECT (now() AT TIME ZONE 'Asia/Kuala_Lumpur')::date"
INSERT_MEASUREMENT_SQL = """
INSERT INTO measurements (segment_id, core_id, loss_db, tested_on, test_method, field_team, created_by)
VALUES (:segment_id, :core_id, :loss_db, :tested_on, :test_method, :field_team, :created_by)
"""
LOCK_SEGMENT_SQL = "SELECT id FROM segments WHERE id = :segment_id FOR UPDATE"
PORT_LABEL_SQL = "SELECT port_id FROM ports WHERE id = :port_row_id"
PASTE_SEGMENT_SQL = """
SELECT s.site_a_id, s.site_b_id, s.survey_cores, a.name || ' - ' || b.name AS name
FROM segments s JOIN sites a ON a.id = s.site_a_id JOIN sites b ON b.id = s.site_b_id
WHERE s.id = :segment_id
"""
PASTE_CORES_SQL = """
SELECT c.id, c.number, pa.port_id AS port_a, pb.port_id AS port_b
FROM cores c
LEFT JOIN ports pa ON pa.id = c.port_a_id
LEFT JOIN ports pb ON pb.id = c.port_b_id
WHERE c.segment_id = :segment_id
"""
PORT_OWNERS_SQL = """
SELECT p.port_id AS label, c.id AS core_id, c.number, c.segment_id, a.name || ' - ' || b.name AS segment
FROM ports p
JOIN cores c ON p.id IN (c.port_a_id, c.port_b_id)
JOIN segments s ON s.id = c.segment_id
JOIN sites a ON a.id = s.site_a_id
JOIN sites b ON b.id = s.site_b_id
WHERE p.site_id = :site_id AND p.port_id = ANY(CAST(:labels AS text[]))
"""
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
# Cores above the new count that must stay: taken, ever reserved, edited, or carrying ports
BLOCKING_CORES_SQL = """
SELECT c.id, c.number FROM cores c JOIN core_status_v v ON v.core_id = c.id
WHERE c.segment_id = :segment_id AND c.number > :new_count AND (
  v.status <> 'Available'
  OR EXISTS (SELECT 1 FROM reservation_cores rc WHERE rc.core_id = c.id)
  OR EXISTS (SELECT 1 FROM data_edits d WHERE d.entity = 'core' AND d.entity_id = c.id)
  OR c.port_a_id IS NOT NULL OR c.port_b_id IS NOT NULL
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

PORT_ENDS = ("port_a", "port_b")

class CorePortsBody(BaseModel):
    # Label at the segment's first site; null or empty clears it; not sent = untouched.
    port_a: str | None = None
    # Label at the segment's second site.
    port_b: str | None = None
    reason: Reason = ""


def _port_label(db: Session, port_row_id: int | None) -> str | None:
    if not port_row_id:
        return None
    return db.execute(text(PORT_LABEL_SQL), {"port_row_id": port_row_id}).scalar_one_or_none()


def _port_for_site(db: Session, label: str, site_id: int) -> int:
    """The port row for a label at this site, made if new; the same label may exist at other sites."""
    return port(db, {}, label, site_id)


def _canonical_label(typed: str | None) -> str | None:
    """Empty means clear; anything else must be an FDF or ODF port, saved in canonical form."""
    text_value = (typed or "").strip()
    if not text_value:
        return None
    label = normalize_port_label(text_value)
    if label is None:
        raise HTTPException(422, f"{text_value} is not a port label. {LABEL_HELP}")
    return label


def _refuse_label_on_other_core(db: Session, label: str, site_id: int, core_id: int) -> None:
    """A port label is one physical port per site, so only one core may hold it."""
    owners = _owners_by_label(db, site_id, [label]).get(label, [])
    for owner in owners:
        if owner["core_id"] != core_id:
            raise HTTPException(409, f"{label} is on core {owner['number']} of {owner['segment']}")


def _write_core_ports(
    db: Session, user: CurrentUser, core_id: int, wanted: dict[str, str | None], reason: str,
    check_owners: bool = True,
) -> bool:
    """Set the wanted labels on one core (field name -> label, empty or None clears) and log each change.

    The paste preview has already checked the owners (a label may move between cores in one paste),
    so it passes check_owners=False. Does not commit; returns whether anything changed.
    """
    segment_id, current_a, current_b, site_a, site_b = db.execute(
        text(CORE_PORTS_SQL), {"core_id": core_id}
    ).one()
    current = {"port_a": (current_a, site_a), "port_b": (current_b, site_b)}
    edits: list[tuple[str, Any, Any]] = []
    new_port_ids: dict[str, int | None] = {}
    for field_name, typed in wanted.items():
        current_row_id, site_id = current[field_name]
        label = _canonical_label(typed)
        old = _port_label(db, current_row_id)
        if label == old:
            continue
        if label is None:
            new_port_ids[field_name] = None
        else:
            if check_owners:
                _refuse_label_on_other_core(db, label, site_id, core_id)
            new_port_ids[field_name] = _port_for_site(db, label, site_id)
        edits.append((field_name, old, label))
    for field_name, port_row_id in new_port_ids.items():
        db.execute(text(SET_CORE_PORT_SQL[field_name]), {"port_row_id": port_row_id, "core_id": core_id})
    if edits:
        _log(db, user, "core", core_id, edits, reason)
    return bool(edits)


@router.post("/cores/{core_id}/ports")
def set_core_ports(db: DB, admin: Admin, core_id: int, body: CorePortsBody) -> CoreHolderDetail:
    found = db.execute(text(CORE_PORTS_SQL), {"core_id": core_id}).first()
    if found is None:
        raise HTTPException(404, "Core not found")
    db.execute(text(LOCK_SEGMENT_SQL), {"segment_id": found[0]})
    wanted = {end: getattr(body, end) for end in PORT_ENDS if end in body.model_fields_set}
    if _write_core_ports(db, admin, core_id, wanted, body.reason):
        db.commit()
    core = inventory.get_core(db, core_id, admin.id)
    assert core is not None
    return core


# ---------- paste ports for a whole segment (preview first, then apply) ----------

MAX_PASTED_LINES = 2000
SITE_OF_END = {"port_a": "site_a_id", "port_b": "site_b_id"}


class PastePortsBody(BaseModel):
    start_core: int = Field(1, ge=1)
    port_a: list[str] | None = Field(None, max_length=MAX_PASTED_LINES)  # null leaves end A untouched
    port_b: list[str] | None = Field(None, max_length=MAX_PASTED_LINES)
    apply: bool = False  # false = preview only, nothing is written

    @model_validator(mode="after")
    def need_one_list(self) -> "PastePortsBody":
        if self.port_a is None and self.port_b is None:
            raise ValueError("Paste at least one of port_a and port_b")
        return self


class PastePortRow(BaseModel):
    core_number: int
    port_a_old: str | None
    port_a_new: str | None
    port_b_old: str | None
    port_b_new: str | None
    status: Literal["new", "replaces", "unchanged", "problem"]
    problem: str | None = None


class PastePortCounts(BaseModel):
    new: int = 0
    replaces: int = 0
    unchanged: int = 0
    problem: int = 0


class PastePortsResult(BaseModel):
    rows: list[PastePortRow]
    counts: PastePortCounts
    applied: bool


def _pasted_labels(lines: list[str] | None, start_core: int) -> dict[int, str]:
    """Core number -> label for the non-empty lines; an empty line skips that core."""
    labels: dict[int, str] = {}
    for index, line in enumerate(lines or []):
        label = line.strip()
        if label:
            labels[start_core + index] = normalize_port_label(label) or label
    return labels


def _owners_by_label(db: Session, site_id: int, labels: list[str]) -> dict[str, list[Any]]:
    owners: dict[str, list[Any]] = {}
    if not labels:
        return owners
    rows = db.execute(text(PORT_OWNERS_SQL), {"site_id": site_id, "labels": labels}).mappings()
    for row in rows:
        owners.setdefault(row["label"], []).append(row)
    return owners


def _label_problem(
    label: str, core_id: int, segment_id: int,
    pasted: dict[int, str], repeats: Counter[str], owners: dict[str, list[Any]],
    unapplied: set[int],
) -> str | None:
    if normalize_port_label(label) is None:
        return f"{label} is not a port label. {LABEL_HELP}"
    if repeats[label] > 1:
        return f"{label} is pasted more than once for this end"
    for owner in owners.get(label, []):
        if owner["core_id"] == core_id:
            continue
        pasted_for_owner = pasted.get(owner["number"])
        owner_gets_other_label = owner["segment_id"] == segment_id and pasted_for_owner not in (None, label)
        # A problem row is never applied, so its owner keeps the label.
        moving_away = owner_gets_other_label and owner["number"] not in unapplied
        if not moving_away:
            return f"{label} is on core {owner['number']} of {owner['segment']}"
    return None


def _paste_problems(
    db: Session, segment_id: int, segment: Any, cores: dict[int, Any], numbers: list[int],
    pasted_by_end: dict[str, dict[int, str]],
) -> dict[int, str]:
    """Core number -> first problem found; those rows are never applied."""
    problems: dict[int, str] = {}
    for number in numbers:
        if segment["survey_cores"] is None:
            problems[number] = "Core verification count not set for this segment"
        elif number > segment["survey_cores"]:
            problems[number] = f"Core {number} is above the verified cores ({segment['survey_cores']})"
        elif number not in cores:
            problems[number] = f"Core {number} does not exist"
    repeats_by_end = {end: Counter(pasted_by_end[end].values()) for end in PORT_ENDS}
    owners_by_end = {
        end: _owners_by_label(db, segment[SITE_OF_END[end]], list(repeats_by_end[end]))
        for end in PORT_ENDS
    }
    # A new problem row can stop a label from moving off its owner, which can make another
    # row a problem. Repeat until a pass finds nothing new.
    found_new = True
    while found_new:
        found_new = False
        for end in PORT_ENDS:
            for number, label in pasted_by_end[end].items():
                if number in problems:
                    continue
                found = _label_problem(
                    label, cores[number]["id"], segment_id, pasted_by_end[end],
                    repeats_by_end[end], owners_by_end[end], set(problems),
                )
                if found:
                    problems[number] = found
                    found_new = True
    return problems


def _paste_row(
    number: int, core: Any, pasted_by_end: dict[str, dict[int, str]], problem: str | None
) -> PastePortRow:
    old = {end: (core[end] if core else None) for end in PORT_ENDS}
    new = {end: pasted_by_end[end].get(number, old[end]) for end in PORT_ENDS}
    changed = [end for end in PORT_ENDS if new[end] != old[end]]
    if problem:
        status = "problem"
    elif not changed:
        status = "unchanged"
    elif any(old[end] is not None for end in changed):
        status = "replaces"
    else:
        status = "new"
    return PastePortRow(
        core_number=number,
        port_a_old=old["port_a"], port_a_new=new["port_a"],
        port_b_old=old["port_b"], port_b_new=new["port_b"],
        status=status, problem=problem,
    )


def _paste_preview(
    db: Session, segment_id: int, body: PastePortsBody
) -> tuple[PastePortsResult, dict[int, int]]:
    """Rows and counts for the paste, plus core number -> core id for applying."""
    segment = db.execute(text(PASTE_SEGMENT_SQL), {"segment_id": segment_id}).mappings().first()
    if segment is None:
        raise HTTPException(404, "Segment not found")
    core_rows = db.execute(text(PASTE_CORES_SQL), {"segment_id": segment_id}).mappings()
    cores = {row["number"]: row for row in core_rows}
    pasted_by_end = {
        "port_a": _pasted_labels(body.port_a, body.start_core),
        "port_b": _pasted_labels(body.port_b, body.start_core),
    }
    numbers = sorted(set(pasted_by_end["port_a"]) | set(pasted_by_end["port_b"]))
    problems = _paste_problems(db, segment_id, segment, cores, numbers, pasted_by_end)
    rows = [_paste_row(number, cores.get(number), pasted_by_end, problems.get(number)) for number in numbers]
    counts = PastePortCounts()
    for row in rows:
        setattr(counts, row.status, getattr(counts, row.status) + 1)
    core_ids = {number: core["id"] for number, core in cores.items()}
    return PastePortsResult(rows=rows, counts=counts, applied=False), core_ids


def _apply_paste(db: Session, admin: Admin, result: PastePortsResult, core_ids: dict[int, int]) -> None:
    for row in result.rows:
        if row.status not in ("new", "replaces"):
            continue
        wanted: dict[str, str | None] = {}
        if row.port_a_new != row.port_a_old:
            wanted["port_a"] = row.port_a_new
        if row.port_b_new != row.port_b_old:
            wanted["port_b"] = row.port_b_new
        _write_core_ports(db, admin, core_ids[row.core_number], wanted, "", check_owners=False)


@router.post("/segments/{segment_id}/ports")
def paste_segment_ports(db: DB, admin: Admin, segment_id: int, body: PastePortsBody) -> PastePortsResult:
    if body.apply:
        db.execute(text(LOCK_SEGMENT_SQL), {"segment_id": segment_id})
    result, core_ids = _paste_preview(db, segment_id, body)
    if not body.apply:
        return result
    _apply_paste(db, admin, result, core_ids)
    db.commit()
    result.applied = True
    return result


# ---------- measured loss, typed by hand (each test is its own history row) ----------

def _trimmed_or_none(value: str | None) -> str | None:
    if value is None:
        return None
    return value.strip() or None


class MeasurementBody(BaseModel):
    loss_db: Decimal = Field(gt=0, le=100)
    tested_on: date
    test_method: str | None = None
    field_team: str | None = None


@router.post("/cores/{core_id}/measurements")
def add_core_measurement(db: DB, admin: Admin, core_id: int, body: MeasurementBody) -> CoreLoss:
    found = db.execute(text(CORE_SURVEY_SQL), {"core_id": core_id}).first()
    if found is None:
        raise HTTPException(404, "Core not found")
    segment_id, number, survey_cores, distance_km = found
    # Same rule as inventory: cores above the surveyed count are hidden. A segment with no count yet
    # still shows all its cores in inventory, so it is not refused here.
    if survey_cores is not None and number > survey_cores:
        raise conflict("This core is above the verified cores of the segment")
    if body.tested_on > db.execute(text(TODAY_KL_SQL)).scalar_one():
        raise HTTPException(422, "Test date cannot be in the future")
    db.execute(text(INSERT_MEASUREMENT_SQL), {
        "segment_id": segment_id,
        "core_id": core_id,
        "loss_db": body.loss_db,
        "tested_on": body.tested_on,
        "test_method": _trimmed_or_none(body.test_method),
        "field_team": _trimmed_or_none(body.field_team),
        "created_by": admin.id,
    })
    db.commit()
    calculated = loss_service.calculated_loss_db(distance_km)
    for entry in loss_service.core_losses(db, segment_id, calculated):
        if entry["core_id"] == core_id:
            return CoreLoss(**entry)
    raise HTTPException(500, "Measurement was not saved")


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
