"""Which reservation actions a viewer may take. One place decides; writes raise the refusal, reads send the names.

A row needs: planner_id, status, last_event, is_stale, remaining (unassigned cores still to assign).
Checks that need the request body (cores held, customer exists, count within remaining) stay in the service.
"""
from typing import Any, Callable

from app.auth.deps import CurrentUser
from app.errors import Conflict, Forbidden, ServiceError

Row = dict[str, Any]
Refusal = ServiceError | None


def _wrong_status(row: Row, *statuses: str) -> Refusal:
    if row["status"] in statuses:
        return None
    message = f"Reservation is {row['status']}; this needs it to be {' or '.join(statuses)}."
    return Conflict({"message": message})


def _release_waiting(row: Row) -> bool:
    return row["status"] == "approved" and row["last_event"] == "release_requested"


def _admin_only(user: CurrentUser) -> Refusal:
    if user.role != "admin":
        return Forbidden("Admin only")
    return None


def _own_or_admin(row: Row, user: CurrentUser) -> Refusal:
    if row["planner_id"] != user.id and user.role != "admin":
        return Forbidden("Only the planner who made the request can do this")
    return None


def _first(*refusals: Callable[[], Refusal]) -> Refusal:
    for check in refusals:
        refusal = check()
        if refusal is not None:
            return refusal
    return None


def _withdraw(row: Row, user: CurrentUser) -> Refusal:
    def planner_only() -> Refusal:
        if row["planner_id"] != user.id:
            return Forbidden("Only the planner who made the request can withdraw it")
        return None

    return _first(planner_only, lambda: _wrong_status(row, "pending"))


def _keep(row: Row, user: CurrentUser) -> Refusal:
    def no_release_waiting() -> Refusal:
        if row["last_event"] == "release_requested":
            return Conflict({"message": "A release is already requested; an admin has to decide it first."})
        return None

    def stale() -> Refusal:
        if not row["is_stale"]:
            message = "Keep is only for a stale reservation (no approval or keep for over 3 months)."
            return Conflict({"message": message})
        return None

    return _first(lambda: _own_or_admin(row, user), lambda: _wrong_status(row, "approved"), no_release_waiting, stale)


def _request_release(row: Row, user: CurrentUser) -> Refusal:
    def not_admin() -> Refusal:
        if user.role == "admin":
            return Forbidden("Admins release directly")
        return None

    def no_release_waiting() -> Refusal:
        if row["last_event"] == "release_requested":
            return Conflict({"message": "A release is already requested."})
        return None

    return _first(not_admin, lambda: _own_or_admin(row, user), lambda: _wrong_status(row, "approved"),
                  no_release_waiting)


def _pending_admin(row: Row, user: CurrentUser) -> Refusal:
    return _first(lambda: _admin_only(user), lambda: _wrong_status(row, "pending"))


def _approved_admin(row: Row, user: CurrentUser) -> Refusal:
    return _first(lambda: _admin_only(user), lambda: _wrong_status(row, "approved"))


def _decline_release(row: Row, user: CurrentUser) -> Refusal:
    def waiting() -> Refusal:
        if row["last_event"] != "release_requested":
            return Conflict({"message": "No release request is waiting."})
        return None

    return _first(lambda: _admin_only(user), lambda: _wrong_status(row, "approved"), waiting)


def _assign(row: Row, user: CurrentUser) -> Refusal:
    def something_remains() -> Refusal:
        if row["remaining"] <= 0:
            return Conflict({"message": "Only 0 unassigned cores remain on this reservation."})
        return None

    return _first(lambda: _admin_only(user), lambda: _wrong_status(row, "approved"), something_remains)


RULES: dict[str, Callable[[Row, CurrentUser], Refusal]] = {
    "withdraw": _withdraw,
    "keep": _keep,
    "request-release": _request_release,
    "approve": _pending_admin,
    "reject": _pending_admin,
    "release": _approved_admin,
    "decline-release": _decline_release,
    "correct": _approved_admin,
    "assign": _assign,
}


def allowed_actions(row: Row, user: CurrentUser) -> dict[str, Refusal]:
    return {name: rule(row, user) for name, rule in RULES.items()}


def allowed_names(row: Row, user: CurrentUser) -> list[str]:
    return [name for name, refusal in allowed_actions(row, user).items() if refusal is None]
