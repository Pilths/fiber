"""Reservation lifecycle. Events are insert-only; release frees only core_holds rows; every write names its user.

Each action locks the reservation row (and, for bookings, the spans) so concurrent requests are serialised.
Atomic blocks use savepoints (begin_nested) so a refusal never rolls back more than itself.
"""
from datetime import date
from typing import Any

from fastapi import HTTPException
from sqlalchemy import text
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.auth.deps import CurrentUser
from app.inventory import service as inventory
from app.reservations.schemas import NeedsReviewItem, ReservationOut

TZ = "'Asia/Kuala_Lumpur'"


def conflict(message: str, **extra: Any) -> HTTPException:
    return HTTPException(409, {"message": message, **extra})


def _ids(db: Session, sql: str, **p: Any) -> list[int]:
    return list(db.execute(text(sql), p).scalars())


# ---------- reads ----------

RES_SQL = f"""
SELECT r.id, COALESCE(cc.customer_id, r.customer_id) AS customer_id, cu.name AS customer,
  r.planner_id, pu.display_name AS planner, COALESCE(cd.planned_date, r.planned_date) AS planned_date,
  st.status, st.last_event, st.last_event_at, st.last_reason, st.is_stale AS stale,
  COALESCE((now() AT TIME ZONE {TZ})::date - (st.last_event_at AT TIME ZONE {TZ})::date, 0) AS age_days,
  r.unassigned_cores, COALESCE(un.remaining, 0) AS remaining_unassigned, r.unassigned_span_id,
  (SELECT a.name || ' - ' || b.name FROM spans s JOIN sites a ON a.id = s.site_a_id JOIN sites b ON b.id = s.site_b_id
   WHERE s.id = r.unassigned_span_id) AS unassigned_span,
  r.is_new_customer, r.imported
FROM reservations r
JOIN reservation_state_v st ON st.reservation_id = r.id
JOIN users pu ON pu.id = r.planner_id
LEFT JOIN LATERAL (SELECT e.customer_id FROM reservation_events e WHERE e.reservation_id = r.id
  AND e.type = 'corrected' AND e.customer_id IS NOT NULL ORDER BY e.created_at DESC, e.id DESC LIMIT 1) cc ON true
LEFT JOIN LATERAL (SELECT e.planned_date FROM reservation_events e WHERE e.reservation_id = r.id
  AND e.type = 'corrected' AND e.planned_date IS NOT NULL ORDER BY e.created_at DESC, e.id DESC LIMIT 1) cd ON true
JOIN customers cu ON cu.id = COALESCE(cc.customer_id, r.customer_id)
LEFT JOIN reservation_unassigned_v un ON un.reservation_id = r.id
"""

CORES_SQL = """
SELECT rc.reservation_id, c.id AS core_id, c.number, c.span_id, a.name || ' - ' || b.name AS span,
  (h.core_id IS NOT NULL) AS held
FROM reservation_cores rc
JOIN cores c ON c.id = rc.core_id
JOIN spans s ON s.id = c.span_id
JOIN sites a ON a.id = s.site_a_id JOIN sites b ON b.id = s.site_b_id
LEFT JOIN core_holds h ON h.core_id = rc.core_id AND h.reservation_id = rc.reservation_id
WHERE rc.reservation_id = ANY(CAST(:ids AS bigint[]))
ORDER BY c.span_id, c.number
"""

REQUESTED_RELEASE_SQL = """
SELECT e.reservation_id, rc.core_id FROM release_cores rc
JOIN reservation_events e ON e.id = rc.event_id AND e.type = 'release_requested'
WHERE e.reservation_id = ANY(CAST(:ids AS bigint[]))
  AND e.id = (SELECT max(x.id) FROM reservation_events x WHERE x.reservation_id = e.reservation_id)
"""


def load(db: Session, where: str = "true", order: str = "r.id DESC", **p: Any) -> list[ReservationOut]:
    """where/order are fixed fragments from this module, never user text."""
    rows = [dict(r) for r in db.execute(text(f"{RES_SQL} WHERE {where} ORDER BY {order}"), p).mappings()]
    ids = [r["id"] for r in rows]
    cores: dict[int, list[dict]] = {i: [] for i in ids}
    for c in db.execute(text(CORES_SQL), {"ids": ids}).mappings():
        cores[c["reservation_id"]].append(dict(c))
    requested: dict[int, list[int]] = {i: [] for i in ids}
    for rid, core in db.execute(text(REQUESTED_RELEASE_SQL), {"ids": ids}):
        requested[rid].append(core)
    out = []
    for r in rows:
        awaiting = ("approval" if r["status"] == "pending" else
                    "release" if r["status"] == "approved" and r["last_event"] == "release_requested" else None)
        out.append(ReservationOut(**r, awaiting=awaiting, cores=cores[r["id"]], release_requested_cores=requested[r["id"]]))
    return out


def get(db: Session, rid: int) -> ReservationOut:
    found = load(db, "r.id = :id", id=rid)
    if not found:
        raise HTTPException(404, "Reservation not found")
    return found[0]


def list_reservations(db: Session, user: CurrentUser, mine: bool, status: str | None) -> list[ReservationOut]:
    where = ["true"]
    if mine or user.role != "admin":  # planners only ever see their own
        where.append("r.planner_id = :uid")
    if status:
        where.append("st.status = :status")
    return load(db, " AND ".join(where), uid=user.id, status=status)


def approvals(db: Session) -> list[ReservationOut]:
    return load(db, "st.status = 'pending' OR (st.status = 'approved' AND st.last_event = 'release_requested')",
                "st.last_event_at, r.id")


def needs_review(db: Session, user: CurrentUser) -> list[NeedsReviewItem]:
    cut: dict[int, list[str]] = {}  # reservation -> names of cut spans it holds cores or a count on
    for rid, name in db.execute(text(
            "SELECT x.rid, a.name || ' - ' || b.name FROM ("
            " SELECT h.reservation_id AS rid, c.span_id FROM core_holds h JOIN cores c ON c.id = h.core_id"
            " UNION SELECT u.reservation_id, u.span_id FROM reservation_unassigned_v u WHERE u.remaining > 0) x "
            "JOIN spans s ON s.id = x.span_id AND s.fiber_cut JOIN sites a ON a.id = s.site_a_id JOIN sites b ON b.id = s.site_b_id "
            "ORDER BY x.rid, s.id")):
        cut.setdefault(rid, []).append(name)
    where = ("(st.is_stale OR (st.status = 'approved' AND st.last_event = 'release_requested') "
             "OR r.id = ANY(CAST(:cut AS bigint[])))")
    if user.role != "admin":
        where += " AND r.planner_id = :uid"
    items = []
    for r in load(db, where, "st.last_event_at, r.id", cut=list(cut), uid=user.id):
        if r.stale:
            items.append(NeedsReviewItem(kind="stale", reservation=r,
                                         detail=f"Stale: {r.age_days} days since last event. Keep it or request release."))
        if r.awaiting == "release":
            items.append(NeedsReviewItem(kind="release_requested", reservation=r, detail="Release requested, waiting for an admin."))
        if r.id in cut:
            items.append(NeedsReviewItem(kind="fiber_cut", reservation=r, detail="Fiber cut: " + ", ".join(cut[r.id])))
    return items


# ---------- helpers for writes ----------

def _lock(db: Session, rid: int) -> dict[str, Any]:
    row = db.execute(text(
        "SELECT r.id, r.planner_id, r.imported, r.planned_date, r.unassigned_span_id, st.status, st.last_event, "
        "COALESCE(un.remaining, 0) AS remaining FROM reservations r "
        "JOIN reservation_state_v st ON st.reservation_id = r.id "
        "LEFT JOIN reservation_unassigned_v un ON un.reservation_id = r.id "
        "WHERE r.id = :id FOR UPDATE OF r"), {"id": rid}).mappings().first()
    if row is None:
        raise HTTPException(404, "Reservation not found")
    return dict(row)


def _event(db: Session, rid: int, kind: str, user: CurrentUser, reason: str | None = None,
           customer_id: int | None = None, planned_date: date | None = None) -> int:
    return db.execute(text(
        "INSERT INTO reservation_events (reservation_id, type, user_id, reason, customer_id, planned_date) "
        "VALUES (:r, :t, :u, :why, :c, :d) RETURNING id"),
        {"r": rid, "t": kind, "u": user.id, "why": reason, "c": customer_id, "d": planned_date}).scalar_one()


def _require(row: dict[str, Any], *statuses: str) -> None:
    if row["status"] not in statuses:
        raise conflict(f"Reservation is {row['status']}; this needs it to be {' or '.join(statuses)}.")


def _own_or_admin(row: dict[str, Any], user: CurrentUser) -> None:
    if row["planner_id"] != user.id and user.role != "admin":
        raise HTTPException(403, "Only the planner who made the request can do this")


def _lock_spans(db: Session, span_ids: set[int]) -> None:
    if span_ids:
        db.execute(text("SELECT id FROM spans WHERE id = ANY(CAST(:ids AS bigint[])) ORDER BY id FOR UPDATE"),
                   {"ids": sorted(span_ids)})


def _core_rows(db: Session, core_ids: list[int]) -> list[dict[str, Any]]:
    return [dict(r) for r in db.execute(text(
        "SELECT c.id, c.span_id, v.status, (s.survey_cores IS NOT NULL AND c.number > s.survey_cores) AS hidden "
        "FROM cores c JOIN core_status_v v ON v.core_id = c.id JOIN spans s ON s.id = c.span_id "
        "WHERE c.id = ANY(CAST(:ids AS bigint[]))"), {"ids": core_ids}).mappings()]


def _hold(db: Session, rid: int, core_ids: list[int]) -> None:
    """Insert cores and holds; a primary-key clash on core_holds (someone was first) becomes 409 naming the cores."""
    try:
        with db.begin_nested():
            for c in core_ids:
                db.execute(text("INSERT INTO reservation_cores (reservation_id, core_id) VALUES (:r, :c)"), {"r": rid, "c": c})
                db.execute(text("INSERT INTO core_holds (core_id, reservation_id) VALUES (:c, :r)"), {"c": c, "r": rid})
    except IntegrityError:
        taken = _ids(db, "SELECT core_id FROM core_holds WHERE core_id = ANY(CAST(:ids AS bigint[])) ORDER BY core_id", ids=core_ids)
        raise conflict("Some cores were just taken by another request.", taken_core_ids=taken)


def _check_book(db: Session, core_ids: list[int]) -> list[dict[str, Any]]:
    """Locks the spans, then checks: cores exist, spans surveyed, cores Available, count within free_to_reserve."""
    rows = _core_rows(db, core_ids)
    if len(rows) != len(core_ids):
        raise HTTPException(422, "Unknown core id")
    spans = {r["span_id"] for r in rows}
    _lock_spans(db, spans)
    rows = _core_rows(db, core_ids)  # statuses as of now, after the lock
    taken = sorted(r["id"] for r in rows if r["status"] != "Available" or r["hidden"])
    if taken:
        raise conflict("Some cores are not Available (or are beyond the surveyed count).", taken_core_ids=taken)
    for sid in sorted(spans):
        span = inventory.get_span(db, sid)
        assert span is not None
        n = sum(r["span_id"] == sid for r in rows)
        label = f"{span.site_a} - {span.site_b}"
        if span.fiber_cut:
            raise conflict(f"{label} has a fiber cut and cannot be booked until an admin restores it.")
        if span.survey_cores is None:
            raise conflict(f"{label} is not surveyed yet; it cannot be booked.")
        if n > span.free_to_reserve:
            raise conflict(f"{label}: {n} requested but only {span.free_to_reserve} free to reserve "
                           f"({span.unassigned_reserved} reserved by count only).")
    return rows


# ---------- planner / any user ----------

def create(db: Session, user: CurrentUser, customer_id: int, planned_date: date | None, core_ids: list[int]) -> ReservationOut:
    core_ids = sorted(set(core_ids))
    if not db.execute(text("SELECT 1 FROM customers WHERE id = :c"), {"c": customer_id}).first():
        raise HTTPException(422, "Unknown customer")
    _check_book(db, core_ids)
    rid = db.execute(text(
        "INSERT INTO reservations (customer_id, planner_id, planned_date, is_new_customer) VALUES "
        "(:c, :u, :d, NOT EXISTS (SELECT 1 FROM reservations WHERE customer_id = :c)) RETURNING id"),
        {"c": customer_id, "u": user.id, "d": planned_date}).scalar_one()
    _event(db, rid, "requested", user)
    _hold(db, rid, core_ids)
    db.commit()
    return get(db, rid)


def withdraw(db: Session, user: CurrentUser, rid: int) -> ReservationOut:
    row = _lock(db, rid)
    if row["planner_id"] != user.id:
        raise HTTPException(403, "Only the planner who made the request can withdraw it")
    _require(row, "pending")
    _event(db, rid, "withdrawn", user)
    db.execute(text("DELETE FROM core_holds WHERE reservation_id = :r"), {"r": rid})
    db.commit()
    return get(db, rid)


def keep(db: Session, user: CurrentUser, rid: int) -> ReservationOut:
    row = _lock(db, rid)
    _own_or_admin(row, user)
    _require(row, "approved")
    if row["last_event"] == "release_requested":
        raise conflict("A release is already requested; an admin has to decide it first.")
    _event(db, rid, "kept", user)
    db.commit()
    return get(db, rid)


def _held(db: Session, rid: int, core_ids: list[int]) -> list[int]:
    ids = sorted(set(core_ids))
    held = _ids(db, "SELECT core_id FROM core_holds WHERE reservation_id = :r AND core_id = ANY(CAST(:ids AS bigint[]))",
                r=rid, ids=ids)
    if len(held) != len(ids):
        raise HTTPException(422, "Cores must belong to this reservation: " + ", ".join(map(str, sorted(set(ids) - set(held)))))
    return ids


def _cores_to_free(db: Session, rid: int, core_ids: list[int]) -> list[int]:
    """Cores named must be held by the reservation; none may be named only when it holds nothing (count-only)."""
    if not core_ids:
        if db.execute(text("SELECT 1 FROM core_holds WHERE reservation_id = :r"), {"r": rid}).first():
            raise HTTPException(422, "Name the cores to release")
        return []
    return _held(db, rid, core_ids)


def request_release(db: Session, user: CurrentUser, rid: int, core_ids: list[int]) -> ReservationOut:
    row = _lock(db, rid)
    _own_or_admin(row, user)
    _require(row, "approved")
    if row["last_event"] == "release_requested":
        raise conflict("A release is already requested.")
    ids = _cores_to_free(db, rid, core_ids)
    ev = _event(db, rid, "release_requested", user)
    for c in ids:
        db.execute(text("INSERT INTO release_cores (event_id, core_id) VALUES (:e, :c)"), {"e": ev, "c": c})
    db.commit()
    return get(db, rid)


# ---------- admin ----------

def approve(db: Session, user: CurrentUser, rid: int) -> ReservationOut:
    row = _lock(db, rid)
    _require(row, "pending")
    _event(db, rid, "approved", user)
    db.commit()
    return get(db, rid)


def reject(db: Session, user: CurrentUser, rid: int, reason: str) -> ReservationOut:
    row = _lock(db, rid)
    _require(row, "pending")
    _event(db, rid, "rejected", user, reason)
    db.execute(text("DELETE FROM core_holds WHERE reservation_id = :r"), {"r": rid})
    db.commit()
    return get(db, rid)


def release(db: Session, user: CurrentUser, rid: int, core_ids: list[int]) -> ReservationOut:
    """Frees only the named cores' holds. The reservation ends (derived) when nothing is held any more."""
    row = _lock(db, rid)
    _require(row, "approved")
    ids = _cores_to_free(db, rid, core_ids)
    ev = _event(db, rid, "released", user)
    for c in ids:
        db.execute(text("INSERT INTO release_cores (event_id, core_id) VALUES (:e, :c)"), {"e": ev, "c": c})
    db.execute(text("DELETE FROM core_holds WHERE reservation_id = :r AND core_id = ANY(CAST(:ids AS bigint[]))"),
               {"r": rid, "ids": ids})
    db.commit()
    return get(db, rid)


def decline_release(db: Session, user: CurrentUser, rid: int, reason: str) -> ReservationOut:
    row = _lock(db, rid)
    _require(row, "approved")
    if row["last_event"] != "release_requested":
        raise conflict("No release request is waiting.")
    _event(db, rid, "release_declined", user, reason)
    db.commit()
    return get(db, rid)


def correct(db: Session, user: CurrentUser, rid: int, reason: str, customer_id: int | None,
            planned_date: date | None, cores: list[int] | None) -> ReservationOut:
    if cores is not None:
        raise HTTPException(422, "Cores cannot be corrected. Release them and request again.")
    if customer_id is None and planned_date is None:
        raise HTTPException(422, "Give a customer or a planned date to correct")
    row = _lock(db, rid)
    _require(row, "approved")
    if planned_date is not None and row["imported"] and row["planned_date"] is None:
        raise conflict("The date of an undated imported reservation cannot be corrected.")
    if customer_id is not None and not db.execute(text("SELECT 1 FROM customers WHERE id = :c"), {"c": customer_id}).first():
        raise HTTPException(422, "Unknown customer")
    _event(db, rid, "corrected", user, reason, customer_id, planned_date)
    db.commit()
    return get(db, rid)


def assign(db: Session, user: CurrentUser, rid: int, core_ids: list[int]) -> ReservationOut:
    """Turn part of a count-only reservation into named cores (on its span)."""
    core_ids = sorted(set(core_ids))
    row = _lock(db, rid)
    _require(row, "approved")
    if not core_ids:
        raise HTTPException(422, "Name at least one core")
    if len(core_ids) > row["remaining"]:
        raise conflict(f"Only {row['remaining']} unassigned cores remain on this reservation.")
    cores = _core_rows(db, core_ids)
    if len(cores) != len(core_ids) or any(c["span_id"] != row["unassigned_span_id"] for c in cores):
        raise HTTPException(422, "Cores must belong to the reservation's span")
    _lock_spans(db, {row["unassigned_span_id"]})
    taken = sorted(c["id"] for c in _core_rows(db, core_ids) if c["status"] != "Available" or c["hidden"])
    if taken:
        raise conflict("Some cores are not Available.", taken_core_ids=taken)
    _hold(db, rid, core_ids)
    ev = _event(db, rid, "assigned", user)
    for c in core_ids:
        db.execute(text("INSERT INTO assign_cores (event_id, core_id) VALUES (:e, :c)"), {"e": ev, "c": c})
    db.commit()
    return get(db, rid)
