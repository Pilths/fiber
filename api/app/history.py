"""Reservation and core history for the core detail. Read-only, built from the existing event tables.

Visibility follows the reservation list: an admin sees every reservation, a planner only their own (403 otherwise).
On a core's history a planner gets only their own reservations' events, plus the core's status edits.
"""
from datetime import date, datetime
from typing import Annotated, Any

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy import text
from sqlalchemy.orm import Session

from app.auth.deps import CurrentUser, get_current_user
from app.db import get_db

router = APIRouter(prefix="/api", dependencies=[Depends(get_current_user)])
DB = Annotated[Session, Depends(get_db)]
User = Annotated[CurrentUser, Depends(get_current_user)]


class CoreRef(BaseModel):
    core_id: int
    number: int
    span_id: int


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


def _links(db: Session, table: str, rid: int) -> dict[int, list[CoreRef]]:
    out: dict[int, list[CoreRef]] = {}
    for r in db.execute(text(f"SELECT t.event_id, c.id AS core_id, c.number, c.span_id FROM {table} t JOIN cores c ON c.id = t.core_id "
                             "JOIN reservation_events e ON e.id = t.event_id WHERE e.reservation_id = :r ORDER BY c.span_id, c.number"),
                        {"r": rid}).mappings():
        out.setdefault(r["event_id"], []).append(CoreRef(**{k: r[k] for k in ("core_id", "number", "span_id")}))
    return out


def events(db: Session, rid: int) -> list[EventOut]:
    rows = db.execute(text(
        "SELECT e.id, e.reservation_id, e.type, e.user_id, u.display_name AS \"user\", e.created_at AS at, e.reason, "
        "cu.name AS customer, e.planned_date, r.unassigned_cores FROM reservation_events e JOIN users u ON u.id = e.user_id "
        "JOIN reservations r ON r.id = e.reservation_id LEFT JOIN customers cu ON cu.id = e.customer_id "
        "WHERE e.reservation_id = :r ORDER BY e.created_at, e.id"), {"r": rid}).mappings().all()
    released, assigned = _links(db, "release_cores", rid), _links(db, "assign_cores", rid)
    assigned_ids = {c.core_id for cs in assigned.values() for c in cs}
    original = [CoreRef(**r) for r in db.execute(text(
        "SELECT c.id AS core_id, c.number, c.span_id FROM reservation_cores rc JOIN cores c ON c.id = rc.core_id "
        "WHERE rc.reservation_id = :r ORDER BY c.span_id, c.number"), {"r": rid}).mappings() if r["core_id"] not in assigned_ids]
    out = []
    for r in rows:
        t = r["type"]
        cores = (original if t == "requested" else assigned.get(r["id"], []) if t == "assigned"
                 else released.get(r["id"], []) if t in ("release_requested", "released") else [])
        change = (r["unassigned_cores"] or None) if t == "requested" else -len(cores) if t == "assigned" else None
        out.append(EventOut(**{k: v for k, v in r.items() if k != "unassigned_cores"}, cores=cores, unassigned_change=change))
    return out


def _visible(db: Session, user: CurrentUser, rid: int) -> None:
    owner = db.execute(text("SELECT planner_id FROM reservations WHERE id = :r"), {"r": rid}).scalar()
    if owner is None:
        raise HTTPException(404, "Reservation not found")
    if owner != user.id and user.role != "admin":
        raise HTTPException(403, "Only the planner who made the request can see its history")


@router.get("/reservations/{rid}/history")
def reservation_history(db: DB, user: User, rid: int) -> list[EventOut]:
    _visible(db, user, rid)
    return events(db, rid)


@router.get("/cores/{cid}/history")
def core_history(db: DB, user: User, cid: int) -> list[CoreHistoryItem]:
    if not db.execute(text("SELECT 1 FROM cores WHERE id = :c"), {"c": cid}).first():
        raise HTTPException(404, "Core not found")
    items: list[tuple[Any, int, CoreHistoryItem]] = []
    for (rid,) in db.execute(text("SELECT reservation_id FROM reservation_cores WHERE core_id = :c"), {"c": cid}):
        try:
            _visible(db, user, rid)
        except HTTPException:
            continue
        for e in events(db, rid):
            if e.cores and cid not in {c.core_id for c in e.cores}:
                continue  # an event about other cores of the same reservation
            items.append((e.at, e.id, CoreHistoryItem(at=e.at, kind="reservation_event", type=e.type, user=e.user, reason=e.reason,
                                                      reservation_id=rid, old_value=None, new_value=None, cores=e.cores)))
    for r in db.execute(text("SELECT d.id, d.created_at AS at, d.field, d.old_value, d.new_value, d.reason, u.display_name AS \"user\" "
                             "FROM data_edits d JOIN users u ON u.id = d.user_id WHERE d.entity = 'core' AND d.entity_id = :c"),
                        {"c": cid}).mappings():
        items.append((r["at"], r["id"], CoreHistoryItem(at=r["at"], kind="data_edit", type=r["field"], user=r["user"], reason=r["reason"],
                                                        reservation_id=None, old_value=r["old_value"], new_value=r["new_value"], cores=[])))
    items.sort(key=lambda t: (t[0], t[2].kind, t[1]), reverse=True)
    return [i for _, _, i in items]
