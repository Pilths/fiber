"""allowed_actions: one table over reservation states and viewers."""
import pytest
from app.auth.deps import CurrentUser
from app.reservations.actions import allowed_names

OWN = CurrentUser(id=1, username="p1", display_name="p1", role="planner")
OTHER = CurrentUser(id=2, username="p2", display_name="p2", role="planner")
ADMIN = CurrentUser(id=3, username="a", display_name="a", role="admin")


def row(status, last_event="approved", is_stale=False, remaining=0):
    return {"planner_id": 1, "status": status, "last_event": last_event, "is_stale": is_stale,
            "remaining": remaining}


# state -> (own planner, other planner, admin)
TABLE = {
    "pending": (row("pending", "requested"), ["withdraw"], [], ["approve", "reject"]),
    "approved": (row("approved"), ["request-release"], [],
                 ["release", "correct"]),
    "approved_stale": (row("approved", is_stale=True), ["keep", "request-release"], [],
                       ["keep", "release", "correct"]),
    "release_waiting": (row("approved", "release_requested"), [], [], ["release", "decline-release", "correct"]),
    "approved_count_only": (row("approved", remaining=2), ["request-release"], [], ["release", "correct", "assign"]),
    "ended": (row("ended", "released"), [], [], []),
    "rejected": (row("rejected", "rejected"), [], [], []),
    "withdrawn": (row("withdrawn", "withdrawn"), [], [], []),
}


@pytest.mark.parametrize("name", TABLE)
def test_allowed_actions_table(name):
    reservation, own, other, admin = TABLE[name]
    assert sorted(allowed_names(reservation, OWN)) == sorted(own)
    assert sorted(allowed_names(reservation, OTHER)) == sorted(other)
    assert sorted(allowed_names(reservation, ADMIN)) == sorted(admin)
