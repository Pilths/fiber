"""Reservation lifecycle.

Events are insert-only; release frees only core_holds rows; every write names its user.

Each action locks the reservation row (and, for bookings, the segments) so concurrent requests are serialised.
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
from app.reservations.schemas import NO_REASON, NeedsReviewItem, ReservationOut

TZ = "'Asia/Kuala_Lumpur'"

# ---------- SQL ----------

RES_SQL = f"""
SELECT r.id, COALESCE(cc.customer_id, r.customer_id) AS customer_id, cu.name AS customer,
  r.planner_id, pu.display_name AS planner, COALESCE(cd.planned_date, r.planned_date) AS planned_date,
  st.status, st.last_event, st.last_event_at, st.last_reason, st.is_stale AS stale,
  COALESCE((now() AT TIME ZONE {TZ})::date - (st.last_event_at AT TIME ZONE {TZ})::date, 0) AS age_days,
  r.unassigned_cores, COALESCE(un.remaining, 0) AS remaining_unassigned, r.unassigned_segment_id,
  (SELECT a.name || ' - ' || b.name FROM segments s
   JOIN sites a ON a.id = s.site_a_id JOIN sites b ON b.id = s.site_b_id
   WHERE s.id = r.unassigned_segment_id) AS unassigned_segment,
  r.is_new_customer, r.imported
FROM reservations r
JOIN reservation_state_v st ON st.reservation_id = r.id
JOIN users pu ON pu.id = r.planner_id
LEFT JOIN LATERAL (SELECT e.customer_id FROM reservation_events e WHERE e.reservation_id = r.id
  AND e.type = 'corrected' AND e.customer_id IS NOT NULL
  ORDER BY e.created_at DESC, e.id DESC LIMIT 1) cc ON true
LEFT JOIN LATERAL (SELECT e.planned_date FROM reservation_events e WHERE e.reservation_id = r.id
  AND e.type = 'corrected' AND e.planned_date IS NOT NULL
  ORDER BY e.created_at DESC, e.id DESC LIMIT 1) cd ON true
JOIN customers cu ON cu.id = COALESCE(cc.customer_id, r.customer_id)
LEFT JOIN reservation_unassigned_v un ON un.reservation_id = r.id
"""

CORES_SQL = """
SELECT rc.reservation_id, c.id AS core_id, c.number, c.segment_id, a.name || ' - ' || b.name AS segment,
  (h.core_id IS NOT NULL) AS held
FROM reservation_cores rc
JOIN cores c ON c.id = rc.core_id
JOIN segments s ON s.id = c.segment_id
JOIN sites a ON a.id = s.site_a_id JOIN sites b ON b.id = s.site_b_id
LEFT JOIN core_holds h ON h.core_id = rc.core_id AND h.reservation_id = rc.reservation_id
WHERE rc.reservation_id = ANY(CAST(:ids AS bigint[]))
ORDER BY c.segment_id, c.number
"""

REQUESTED_RELEASE_SQL = """
SELECT e.reservation_id, rc.core_id FROM release_cores rc
JOIN reservation_events e ON e.id = rc.event_id AND e.type = 'release_requested'
WHERE e.reservation_id = ANY(CAST(:ids AS bigint[]))
  AND e.id = (SELECT max(x.id) FROM reservation_events x WHERE x.reservation_id = e.reservation_id)
"""

# reservation -> name of each cut segment it holds cores or a count on
CUT_SEGMENTS_SQL = """
SELECT x.reservation_id, a.name || ' - ' || b.name FROM (
  SELECT h.reservation_id, c.segment_id FROM core_holds h JOIN cores c ON c.id = h.core_id
  UNION SELECT u.reservation_id, u.segment_id FROM reservation_unassigned_v u WHERE u.remaining > 0
) x
JOIN segments s ON s.id = x.segment_id AND s.fiber_cut
JOIN sites a ON a.id = s.site_a_id JOIN sites b ON b.id = s.site_b_id
ORDER BY x.reservation_id, s.id
"""

APPROVALS_WHERE = "st.status = 'pending' OR (st.status = 'approved' AND st.last_event = 'release_requested')"
NEEDS_REVIEW_WHERE = (
    "(st.is_stale OR (st.status = 'approved' AND st.last_event = 'release_requested') "
    "OR r.id = ANY(CAST(:cut AS bigint[])))"
)
OLDEST_EVENT_FIRST = "st.last_event_at, r.id"

LOCK_RESERVATION_SQL = "SELECT id FROM reservations WHERE id = :id FOR UPDATE"

# Read in its own statement after the lock. A statement that waits for a row lock keeps the snapshot it took before
# the wait, so lock and read in one statement would show the state from before the winning request committed.
READ_RESERVATION_SQL = """
SELECT r.id, r.planner_id, r.imported, r.planned_date, r.unassigned_segment_id, st.status, st.last_event,
  st.is_stale, COALESCE(un.remaining, 0) AS remaining
FROM reservations r
JOIN reservation_state_v st ON st.reservation_id = r.id
LEFT JOIN reservation_unassigned_v un ON un.reservation_id = r.id
WHERE r.id = :id
"""

INSERT_EVENT_SQL = """
INSERT INTO reservation_events (reservation_id, type, user_id, reason, customer_id, planned_date)
VALUES (:reservation_id, :type, :user_id, :reason, :customer_id, :planned_date) RETURNING id
"""

LOCK_SEGMENTS_SQL = "SELECT id FROM segments WHERE id = ANY(CAST(:ids AS bigint[])) ORDER BY id FOR UPDATE"

CORE_ROWS_SQL = """
SELECT c.id, c.segment_id, v.status, (s.survey_cores IS NOT NULL AND c.number > s.survey_cores) AS hidden
FROM cores c JOIN core_status_v v ON v.core_id = c.id JOIN segments s ON s.id = c.segment_id
WHERE c.id = ANY(CAST(:ids AS bigint[]))
"""

INSERT_RESERVATION_CORE_SQL = (
    "INSERT INTO reservation_cores (reservation_id, core_id) VALUES (:reservation_id, :core_id)"
)
INSERT_HOLD_SQL = "INSERT INTO core_holds (core_id, reservation_id) VALUES (:core_id, :reservation_id)"
HELD_CORE_IDS_SQL = (
    "SELECT core_id FROM core_holds WHERE core_id = ANY(CAST(:ids AS bigint[])) ORDER BY core_id"
)
CUSTOMER_EXISTS_SQL = "SELECT 1 FROM customers WHERE id = :customer_id"

INSERT_RESERVATION_SQL = """
INSERT INTO reservations (customer_id, planner_id, planned_date, is_new_customer, srf_id)
VALUES (:customer_id, :planner_id, :planned_date,
        NOT EXISTS (SELECT 1 FROM reservations WHERE customer_id = :customer_id), :srf_id)
RETURNING id
"""

DELETE_HOLDS_SQL = "DELETE FROM core_holds WHERE reservation_id = :reservation_id"
DELETE_SOME_HOLDS_SQL = (
    "DELETE FROM core_holds WHERE reservation_id = :reservation_id AND core_id = ANY(CAST(:ids AS bigint[]))"
)
HOLDS_OF_SQL = (
    "SELECT core_id FROM core_holds "
    "WHERE reservation_id = :reservation_id AND core_id = ANY(CAST(:ids AS bigint[]))"
)
ANY_HOLD_SQL = "SELECT 1 FROM core_holds WHERE reservation_id = :reservation_id"
INSERT_RELEASE_CORE_SQL = "INSERT INTO release_cores (event_id, core_id) VALUES (:event_id, :core_id)"
INSERT_ASSIGN_CORE_SQL = "INSERT INTO assign_cores (event_id, core_id) VALUES (:event_id, :core_id)"


def conflict(message: str, **extra: Any) -> HTTPException:
    return HTTPException(409, {"message": message, **extra})


def _ids(db: Session, sql: str, **params: Any) -> list[int]:
    return list(db.execute(text(sql), params).scalars())


# ---------- reads ----------

def _awaiting(status: str, last_event: str | None) -> str | None:
    if status == "pending":
        return "approval"
    if status == "approved" and last_event == "release_requested":
        return "release"
    return None


def load(db: Session, where: str = "true", order: str = "r.id DESC", **params: Any) -> list[ReservationOut]:
    """where/order are fixed fragments from this module, never user text."""
    sql = f"{RES_SQL} WHERE {where} ORDER BY {order}"
    rows = [dict(row) for row in db.execute(text(sql), params).mappings()]
    ids = [row["id"] for row in rows]
    cores: dict[int, list[dict]] = {reservation_id: [] for reservation_id in ids}
    for core in db.execute(text(CORES_SQL), {"ids": ids}).mappings():
        cores[core["reservation_id"]].append(dict(core))
    requested: dict[int, list[int]] = {reservation_id: [] for reservation_id in ids}
    for reservation_id, core_id in db.execute(text(REQUESTED_RELEASE_SQL), {"ids": ids}):
        requested[reservation_id].append(core_id)
    out = []
    for row in rows:
        reservation = ReservationOut(
            **row,
            awaiting=_awaiting(row["status"], row["last_event"]),
            cores=cores[row["id"]],
            release_requested_cores=requested[row["id"]],
        )
        out.append(reservation)
    return out


def get(db: Session, reservation_id: int) -> ReservationOut:
    found = load(db, "r.id = :id", id=reservation_id)
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
    return load(db, APPROVALS_WHERE, OLDEST_EVENT_FIRST)


def _cut_segments(db: Session) -> dict[int, list[str]]:
    cut: dict[int, list[str]] = {}
    for reservation_id, segment_name in db.execute(text(CUT_SEGMENTS_SQL)):
        cut.setdefault(reservation_id, []).append(segment_name)
    return cut


def needs_review(db: Session, user: CurrentUser) -> list[NeedsReviewItem]:
    cut = _cut_segments(db)
    where = NEEDS_REVIEW_WHERE
    if user.role != "admin":
        where += " AND r.planner_id = :uid"
    items = []
    for reservation in load(db, where, OLDEST_EVENT_FIRST, cut=list(cut), uid=user.id):
        if reservation.stale:
            detail = f"Stale: {reservation.age_days} days since last event. Keep it or request release."
            items.append(NeedsReviewItem(kind="stale", reservation=reservation, detail=detail))
        if reservation.awaiting == "release":
            detail = "Release requested, waiting for an admin."
            items.append(NeedsReviewItem(kind="release_requested", reservation=reservation, detail=detail))
        if reservation.id in cut:
            detail = "Fiber cut: " + ", ".join(cut[reservation.id])
            items.append(NeedsReviewItem(kind="fiber_cut", reservation=reservation, detail=detail))
    return items


# ---------- helpers for writes ----------

def _lock(db: Session, reservation_id: int) -> dict[str, Any]:
    locked = db.execute(text(LOCK_RESERVATION_SQL), {"id": reservation_id}).first()
    if locked is None:
        raise HTTPException(404, "Reservation not found")
    row = db.execute(text(READ_RESERVATION_SQL), {"id": reservation_id}).mappings().one()
    return dict(row)


def _event(db: Session, reservation_id: int, kind: str, user: CurrentUser, reason: str | None = None,
           customer_id: int | None = None, planned_date: date | None = None) -> int:
    params = {
        "reservation_id": reservation_id,
        "type": kind,
        "user_id": user.id,
        "reason": reason,
        "customer_id": customer_id,
        "planned_date": planned_date,
    }
    return db.execute(text(INSERT_EVENT_SQL), params).scalar_one()


def _require(row: dict[str, Any], *statuses: str) -> None:
    if row["status"] not in statuses:
        raise conflict(f"Reservation is {row['status']}; this needs it to be {' or '.join(statuses)}.")


def _own_or_admin(row: dict[str, Any], user: CurrentUser) -> None:
    if row["planner_id"] != user.id and user.role != "admin":
        raise HTTPException(403, "Only the planner who made the request can do this")


def _customer_exists(db: Session, customer_id: int) -> bool:
    return db.execute(text(CUSTOMER_EXISTS_SQL), {"customer_id": customer_id}).first() is not None


def _lock_segments(db: Session, segment_ids: set[int]) -> None:
    if segment_ids:
        db.execute(text(LOCK_SEGMENTS_SQL), {"ids": sorted(segment_ids)})


def _core_rows(db: Session, core_ids: list[int]) -> list[dict[str, Any]]:
    return [dict(row) for row in db.execute(text(CORE_ROWS_SQL), {"ids": core_ids}).mappings()]


def _not_bookable(cores: list[dict[str, Any]]) -> list[int]:
    """Cores that are not Available, or are beyond the surveyed count."""
    return sorted(core["id"] for core in cores if core["status"] != "Available" or core["hidden"])


def _hold(db: Session, reservation_id: int, core_ids: list[int]) -> None:
    """Insert cores and holds.

    A primary-key clash on core_holds (someone was first) becomes 409 naming the cores.
    """
    try:
        with db.begin_nested():
            for core_id in core_ids:
                params = {"reservation_id": reservation_id, "core_id": core_id}
                db.execute(text(INSERT_RESERVATION_CORE_SQL), params)
                db.execute(text(INSERT_HOLD_SQL), params)
    except IntegrityError:
        taken = _ids(db, HELD_CORE_IDS_SQL, ids=core_ids)
        raise conflict("Some cores were just taken by another request.", taken_core_ids=taken)


def _record_cores(db: Session, sql: str, event_id: int, core_ids: list[int]) -> None:
    for core_id in core_ids:
        db.execute(text(sql), {"event_id": event_id, "core_id": core_id})


def _check_segment(db: Session, segment_id: int, requested: int) -> None:
    segment = inventory.get_segment(db, segment_id)
    if segment is None:
        raise HTTPException(404, "Segment not found")
    label = f"{segment.site_a} - {segment.site_b}"
    if segment.fiber_cut:
        raise conflict(f"{label} has a fiber cut and cannot be booked until an admin restores it.")
    if segment.survey_cores is None:
        raise conflict(f"{label} has no verified core count yet; it cannot be booked.")
    if requested > segment.free_to_reserve:
        raise conflict(f"{label}: {requested} requested but only {segment.free_to_reserve} free to reserve "
                       f"({segment.unassigned_reserved} reserved by count only).")


def _check_book(db: Session, core_ids: list[int]) -> list[dict[str, Any]]:
    """Locks the segments, then checks the booking.

    Cores exist, segments surveyed, cores Available, count within free_to_reserve.
    """
    cores = _core_rows(db, core_ids)
    if len(cores) != len(core_ids):
        raise HTTPException(422, "Unknown core id")
    segment_ids = {core["segment_id"] for core in cores}
    _lock_segments(db, segment_ids)
    cores = _core_rows(db, core_ids)  # statuses as of now, after the lock
    taken = _not_bookable(cores)
    if taken:
        message = "Some cores are not Available (or are beyond the verified core count)."
        raise conflict(message, taken_core_ids=taken)
    for segment_id in sorted(segment_ids):
        requested = sum(core["segment_id"] == segment_id for core in cores)
        _check_segment(db, segment_id, requested)
    return cores


# ---------- planner / any user ----------

def create(db: Session, user: CurrentUser, customer_id: int, planned_date: date | None, core_ids: list[int],
           srf_id: str | None = None) -> ReservationOut:
    core_ids = sorted(set(core_ids))
    if not _customer_exists(db, customer_id):
        raise HTTPException(422, "Unknown customer")
    _check_book(db, core_ids)
    params = {
        "customer_id": customer_id,
        "planner_id": user.id,
        "planned_date": planned_date,
        "srf_id": (srf_id or "").strip() or None,
    }
    reservation_id = db.execute(text(INSERT_RESERVATION_SQL), params).scalar_one()
    _event(db, reservation_id, "requested", user)
    _hold(db, reservation_id, core_ids)
    db.commit()
    return get(db, reservation_id)


def withdraw(db: Session, user: CurrentUser, reservation_id: int) -> ReservationOut:
    row = _lock(db, reservation_id)
    if row["planner_id"] != user.id:
        raise HTTPException(403, "Only the planner who made the request can withdraw it")
    _require(row, "pending")
    _event(db, reservation_id, "withdrawn", user)
    db.execute(text(DELETE_HOLDS_SQL), {"reservation_id": reservation_id})
    db.commit()
    return get(db, reservation_id)


def keep(db: Session, user: CurrentUser, reservation_id: int) -> ReservationOut:
    row = _lock(db, reservation_id)
    _own_or_admin(row, user)
    _require(row, "approved")
    if row["last_event"] == "release_requested":
        raise conflict("A release is already requested; an admin has to decide it first.")
    if not row["is_stale"]:
        raise conflict("Keep is only for a stale reservation (no approval or keep for over 3 months).")
    _event(db, reservation_id, "kept", user)
    db.commit()
    return get(db, reservation_id)


def _held(db: Session, reservation_id: int, core_ids: list[int]) -> list[int]:
    ids = sorted(set(core_ids))
    held = _ids(db, HOLDS_OF_SQL, reservation_id=reservation_id, ids=ids)
    if len(held) != len(ids):
        not_held = sorted(set(ids) - set(held))
        raise HTTPException(422, "Cores must belong to this reservation: " + ", ".join(map(str, not_held)))
    return ids


def _cores_to_free(db: Session, reservation_id: int, core_ids: list[int]) -> list[int]:
    """Cores named must be held by the reservation.

    None may be named only when it holds nothing (count-only).
    """
    if core_ids:
        return _held(db, reservation_id, core_ids)
    if db.execute(text(ANY_HOLD_SQL), {"reservation_id": reservation_id}).first():
        raise HTTPException(422, "Name the cores to release")
    return []


def request_release(
    db: Session, user: CurrentUser, reservation_id: int, core_ids: list[int]
) -> ReservationOut:
    row = _lock(db, reservation_id)
    _own_or_admin(row, user)
    _require(row, "approved")
    if row["last_event"] == "release_requested":
        raise conflict("A release is already requested.")
    ids = _cores_to_free(db, reservation_id, core_ids)
    event_id = _event(db, reservation_id, "release_requested", user)
    _record_cores(db, INSERT_RELEASE_CORE_SQL, event_id, ids)
    db.commit()
    return get(db, reservation_id)


# ---------- admin ----------

def approve(db: Session, user: CurrentUser, reservation_id: int) -> ReservationOut:
    row = _lock(db, reservation_id)
    _require(row, "pending")
    _event(db, reservation_id, "approved", user)
    db.commit()
    return get(db, reservation_id)


def reject(db: Session, user: CurrentUser, reservation_id: int, reason: str) -> ReservationOut:
    row = _lock(db, reservation_id)
    _require(row, "pending")
    _event(db, reservation_id, "rejected", user, reason or None)
    db.execute(text(DELETE_HOLDS_SQL), {"reservation_id": reservation_id})
    db.commit()
    return get(db, reservation_id)


def release(db: Session, user: CurrentUser, reservation_id: int, core_ids: list[int]) -> ReservationOut:
    """Frees only the named cores' holds. The reservation ends (derived) when nothing is held any more."""
    row = _lock(db, reservation_id)
    _require(row, "approved")
    ids = _cores_to_free(db, reservation_id, core_ids)
    event_id = _event(db, reservation_id, "released", user)
    _record_cores(db, INSERT_RELEASE_CORE_SQL, event_id, ids)
    db.execute(text(DELETE_SOME_HOLDS_SQL), {"reservation_id": reservation_id, "ids": ids})
    db.commit()
    return get(db, reservation_id)


def decline_release(db: Session, user: CurrentUser, reservation_id: int, reason: str) -> ReservationOut:
    row = _lock(db, reservation_id)
    _require(row, "approved")
    if row["last_event"] != "release_requested":
        raise conflict("No release request is waiting.")
    _event(db, reservation_id, "release_declined", user, reason or None)
    db.commit()
    return get(db, reservation_id)


def correct(db: Session, user: CurrentUser, reservation_id: int, reason: str, customer_id: int | None,
            planned_date: date | None, cores: list[int] | None) -> ReservationOut:
    if cores is not None:
        raise HTTPException(422, "Cores cannot be corrected. Release them and request again.")
    if customer_id is None and planned_date is None:
        raise HTTPException(422, "Give a customer or a planned date to correct")
    row = _lock(db, reservation_id)
    _require(row, "approved")
    if planned_date is not None and row["imported"] and row["planned_date"] is None:
        raise conflict("The date of an undated imported reservation cannot be corrected.")
    if customer_id is not None and not _customer_exists(db, customer_id):
        raise HTTPException(422, "Unknown customer")
    _event(db, reservation_id, "corrected", user, reason or NO_REASON, customer_id, planned_date)
    db.commit()
    return get(db, reservation_id)


def assign(db: Session, user: CurrentUser, reservation_id: int, core_ids: list[int]) -> ReservationOut:
    """Turn part of a count-only reservation into named cores (on its segment)."""
    core_ids = sorted(set(core_ids))
    row = _lock(db, reservation_id)
    _require(row, "approved")
    if not core_ids:
        raise HTTPException(422, "Name at least one core")
    if len(core_ids) > row["remaining"]:
        raise conflict(f"Only {row['remaining']} unassigned cores remain on this reservation.")
    segment_id = row["unassigned_segment_id"]
    cores = _core_rows(db, core_ids)
    if len(cores) != len(core_ids) or any(core["segment_id"] != segment_id for core in cores):
        raise HTTPException(422, "Cores must belong to the reservation's segment")
    _lock_segments(db, {segment_id})
    taken = _not_bookable(_core_rows(db, core_ids))
    if taken:
        raise conflict("Some cores are not Available.", taken_core_ids=taken)
    _hold(db, reservation_id, core_ids)
    event_id = _event(db, reservation_id, "assigned", user)
    _record_cores(db, INSERT_ASSIGN_CORE_SQL, event_id, core_ids)
    db.commit()
    return get(db, reservation_id)
