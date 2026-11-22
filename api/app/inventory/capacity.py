"""Segment capacity: the free-to-reserve rule, segment health, the booking check and the starvation check.

Must not import app.reservations (it imports inventory).
"""
from typing import Any, Literal

from sqlalchemy import text
from sqlalchemy.orm import Session

from app.errors import Conflict

Health = Literal["free", "full", "cut", "not_verified"]

FREE_AFTER_SQL = """
SELECT count(*) FROM cores c JOIN core_status_v v ON v.core_id = c.id
WHERE c.segment_id = :segment_id AND c.number <= :new_count AND v.status = 'Available'
"""
RESERVED_BY_COUNT_SQL = """
SELECT coalesce(sum(remaining), 0) FROM reservation_unassigned_v WHERE segment_id = :segment_id
"""


def free_to_reserve(row: dict[str, Any]) -> int:
    """Available cores minus cores reserved by count only; 0 when the segment is cut or not verified."""
    if row["fiber_cut"] or row["survey_cores"] is None:
        return 0
    free = row["status_mix"].get("Available", 0)
    return max(free - row["unassigned_reserved"], 0)


def health(row: dict[str, Any]) -> Health:
    if row["fiber_cut"]:
        return "cut"
    if row["survey_cores"] is None:
        return "not_verified"
    if free_to_reserve(row) == 0:
        return "full"
    return "free"


def check_booking(segment: dict[str, Any], requested: int, **extra: Any) -> None:
    """Raises Conflict when `requested` cores cannot be booked on the segment (segment as from list_segments)."""
    label = f"{segment['site_a']} - {segment['site_b']}"
    message = None
    if segment["fiber_cut"]:
        message = f"Fiber cut on {label}."
    elif segment["survey_cores"] is None:
        message = f"{label} has no verified core count yet; it cannot be booked."
    elif requested > segment["free_to_reserve"]:
        message = (f"{label}: {requested} requested but only {segment['free_to_reserve']} free to reserve "
                   f"({segment['unassigned_reserved']} reserved by count only).")
    if message is not None:
        raise Conflict({"message": message, **extra})


def check_count_only_holds_fit(db: Session, segment_id: int, new_count: int) -> None:
    """Lowering the verified count must leave enough Available cores for the count-only reservations."""
    free_after = db.execute(text(FREE_AFTER_SQL), {"segment_id": segment_id, "new_count": new_count}).scalar_one()
    reserved = db.execute(text(RESERVED_BY_COUNT_SQL), {"segment_id": segment_id}).scalar_one()
    if free_after < reserved:
        raise Conflict({"message": f"Cannot lower to {new_count}: {reserved} cores are reserved by count only "
                                   f"and only {free_after} would stay Available."})
