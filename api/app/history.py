"""Reservation and core history for the core detail. Read-only, built from the existing event tables.

Visibility follows the reservation list: an admin sees every reservation, a planner only their own (403 otherwise).
On a core's history a planner gets only their own reservations' events, plus the core's status edits.
"""
from datetime import date, datetime
from typing import Annotated, Any

from fastapi import APIRouter, Depends
from pydantic import BaseModel
from sqlalchemy import text
from sqlalchemy.orm import Session

from app.errors import NotFound, Forbidden, ServiceError
from app.auth.deps import DB, CurrentUser, get_current_user

router = APIRouter(prefix="/api", dependencies=[Depends(get_current_user)])
User = Annotated[CurrentUser, Depends(get_current_user)]

SELECT_CORE_LINKS = """
    SELECT t.event_id, c.id AS core_id, c.number, c.segment_id
    FROM {table} t
    JOIN cores c ON c.id = t.core_id
    JOIN reservation_events e ON e.id = t.event_id
    WHERE e.reservation_id = :reservation_id
    ORDER BY c.segment_id, c.number
"""
SELECT_EVENTS = """
    SELECT e.id, e.reservation_id, e.type, e.user_id, u.display_name AS "user", e.created_at AS at, e.reason,
           cu.name AS customer, e.planned_date, r.unassigned_cores
    FROM reservation_events e
    JOIN users u ON u.id = e.user_id
    JOIN reservations r ON r.id = e.reservation_id
    LEFT JOIN customers cu ON cu.id = e.customer_id
    WHERE e.reservation_id = :reservation_id
    ORDER BY e.created_at, e.id
"""
SELECT_ORIGINAL_CORES = """
    SELECT c.id AS core_id, c.number, c.segment_id
    FROM reservation_cores rc
    JOIN cores c ON c.id = rc.core_id
    WHERE rc.reservation_id = :reservation_id
    ORDER BY c.segment_id, c.number
"""
SELECT_RESERVATION_OWNER = "SELECT planner_id FROM reservations WHERE id = :reservation_id"
SELECT_CORE_EXISTS = "SELECT 1 FROM cores WHERE id = :core_id"
SELECT_RESERVATIONS_OF_CORE = "SELECT reservation_id FROM reservation_cores WHERE core_id = :core_id"
SELECT_CORE_DATA_EDITS = """
    SELECT d.id, d.created_at AS at, d.field, d.old_value, d.new_value, d.reason, u.display_name AS "user"
    FROM data_edits d
    JOIN users u ON u.id = d.user_id
    WHERE d.entity = 'core' AND d.entity_id = :core_id
"""


class CoreRef(BaseModel):
    core_id: int
    number: int
    segment_id: int


class EventOut(BaseModel):
    id: int
    reservation_id: int
    type: str
    user_id: int
    user: str
    at: datetime
    reason: str | None
    customer: str | None  # corrected events only
    planned_date: date | None  # corrected events only
    cores: list[CoreRef]  # cores this event covers (empty for reservation-wide events)
    unassigned_change: int | None  # count-only reservations: +N at request, -n per assign


class CoreHistoryItem(BaseModel):
    at: datetime
    kind: str  # "reservation_event" | "data_edit"
    type: str  # event type, or the edited field ("status")
    user: str
    reason: str | None
    reservation_id: int | None
    old_value: str | None
    new_value: str | None
    cores: list[CoreRef]


def _links(db: Session, table: str, reservation_id: int) -> dict[int, list[CoreRef]]:
    links: dict[int, list[CoreRef]] = {}
    sql = SELECT_CORE_LINKS.format(table=table)
    for row in db.execute(text(sql), {"reservation_id": reservation_id}).mappings():
        core = CoreRef(core_id=row["core_id"], number=row["number"], segment_id=row["segment_id"])
        links.setdefault(row["event_id"], []).append(core)
    return links


def _event_cores(
    event: Any,
    original: list[CoreRef],
    assigned: dict[int, list[CoreRef]],
    released: dict[int, list[CoreRef]],
) -> list[CoreRef]:
    if event["type"] == "requested":
        return original
    if event["type"] == "assigned":
        return assigned.get(event["id"], [])
    if event["type"] in ("release_requested", "released"):
        return released.get(event["id"], [])
    return []


def _unassigned_change(event: Any, cores: list[CoreRef]) -> int | None:
    if event["type"] == "requested":
        return event["unassigned_cores"] or None
    if event["type"] == "assigned":
        return -len(cores)
    return None


def events(db: Session, reservation_id: int) -> list[EventOut]:
    params = {"reservation_id": reservation_id}
    rows = db.execute(text(SELECT_EVENTS), params).mappings().all()
    released = _links(db, "release_cores", reservation_id)
    assigned = _links(db, "assign_cores", reservation_id)
    assigned_ids = {core.core_id for cores in assigned.values() for core in cores}
    original = [
        CoreRef(**row)
        for row in db.execute(text(SELECT_ORIGINAL_CORES), params).mappings()
        if row["core_id"] not in assigned_ids
    ]
    result = []
    for row in rows:
        cores = _event_cores(row, original, assigned, released)
        change = _unassigned_change(row, cores)
        fields = {key: value for key, value in row.items() if key != "unassigned_cores"}
        result.append(EventOut(**fields, cores=cores, unassigned_change=change))
    return result


def _visible(db: Session, user: CurrentUser, reservation_id: int) -> None:
    owner = db.execute(text(SELECT_RESERVATION_OWNER), {"reservation_id": reservation_id}).scalar()
    if owner is None:
        raise NotFound("Reservation not found")
    if owner != user.id and user.role != "admin":
        raise Forbidden("Only the planner who made the request can see its history")


@router.get("/reservations/{reservation_id}/history")
def reservation_history(db: DB, user: User, reservation_id: int) -> list[EventOut]:
    _visible(db, user, reservation_id)
    return events(db, reservation_id)


def _reservation_event_items(
    db: Session,
    user: CurrentUser,
    core_id: int,
) -> list[tuple[Any, int, CoreHistoryItem]]:
    items: list[tuple[Any, int, CoreHistoryItem]] = []
    for (reservation_id,) in db.execute(text(SELECT_RESERVATIONS_OF_CORE), {"core_id": core_id}):
        try:
            _visible(db, user, reservation_id)
        except ServiceError:
            continue
        for event in events(db, reservation_id):
            if event.cores and core_id not in {core.core_id for core in event.cores}:
                continue  # an event about other cores of the same reservation
            item = CoreHistoryItem(
                at=event.at,
                kind="reservation_event",
                type=event.type,
                user=event.user,
                reason=event.reason,
                reservation_id=reservation_id,
                old_value=None,
                new_value=None,
                cores=event.cores,
            )
            items.append((event.at, event.id, item))
    return items


def _data_edit_items(db: Session, core_id: int) -> list[tuple[Any, int, CoreHistoryItem]]:
    items: list[tuple[Any, int, CoreHistoryItem]] = []
    for row in db.execute(text(SELECT_CORE_DATA_EDITS), {"core_id": core_id}).mappings():
        item = CoreHistoryItem(
            at=row["at"],
            kind="data_edit",
            type=row["field"],
            user=row["user"],
            reason=row["reason"],
            reservation_id=None,
            old_value=row["old_value"],
            new_value=row["new_value"],
            cores=[],
        )
        items.append((row["at"], row["id"], item))
    return items


@router.get("/cores/{core_id}/history")
def core_history(db: DB, user: User, core_id: int) -> list[CoreHistoryItem]:
    if not db.execute(text(SELECT_CORE_EXISTS), {"core_id": core_id}).first():
        raise NotFound("Core not found")
    items = _reservation_event_items(db, user, core_id) + _data_edit_items(db, core_id)
    items.sort(key=lambda entry: (entry[0], entry[2].kind, entry[1]), reverse=True)
    return [item for _, _, item in items]
