"""Segment capacity: free to reserve, health, booking check, count-only starvation check."""
import pytest
from sqlalchemy import text

from app.errors import Conflict
from app.inventory.capacity import check_booking, check_count_only_holds_fit, free_to_reserve, health
from tests.test_map import one, segment, site


def row(free=5, reserved=0, survey=12, cut=False):
    return {"status_mix": {"Available": free}, "unassigned_reserved": reserved, "survey_cores": survey,
            "fiber_cut": cut, "site_a": "A", "site_b": "B"}


@pytest.mark.parametrize("free, expected", [(0, "full"), (1, "free"), (9, "free"), (10, "free")])
def test_health_has_no_bands(free, expected):
    assert health(row(free=free)) == expected
    assert free_to_reserve(row(free=free)) == free


def test_cut_and_not_verified():
    assert (health(row(cut=True)), free_to_reserve(row(cut=True))) == ("cut", 0)
    assert (health(row(survey=None)), free_to_reserve(row(survey=None))) == ("not_verified", 0)
    assert health(row(cut=True, survey=None)) == "cut"


def test_count_only_holds_reduce_free():
    assert free_to_reserve(row(free=5, reserved=3)) == 2
    assert free_to_reserve(row(free=5, reserved=9)) == 0
    assert health(row(free=5, reserved=5)) == "full"


def with_free(**kw):
    r = row(**kw)
    return {**r, "free_to_reserve": free_to_reserve(r)}


def test_booking_messages():
    with pytest.raises(Conflict) as e:
        check_booking(with_free(cut=True), 1)
    assert e.value.message["message"] == "Fiber cut on A - B."
    with pytest.raises(Conflict) as e:
        check_booking(with_free(survey=None), 1)
    assert "no verified core count" in e.value.message["message"]
    with pytest.raises(Conflict) as e:
        check_booking(with_free(free=5, reserved=3), 3, segment_id=7)
    assert e.value.message == {"message": "A - B: 3 requested but only 2 free to reserve (3 reserved by count only).",
                              "segment_id": 7}
    check_booking(with_free(free=5, reserved=3), 2)


def test_starvation_check(db):
    s = segment(db, site(db, "A"), site(db, "B"), 10)
    check_count_only_holds_fit(db, s, 4)  # nothing reserved by count: any count fits
    user = one(db, "INSERT INTO users (username, display_name, role) VALUES ('p','p','planner') RETURNING id")
    customer = one(db, "INSERT INTO customers (name, created_by) VALUES ('C', :u) RETURNING id", u=user)
    reservation = one(db, "INSERT INTO reservations (customer_id, planner_id, unassigned_cores, unassigned_segment_id) "
                          "VALUES (:c, :u, 6, :s) RETURNING id", c=customer, u=user, s=s)
    db.execute(text("INSERT INTO reservation_events (reservation_id, type, user_id) VALUES (:r, 'requested', :u)"),
               {"r": reservation, "u": user})
    check_count_only_holds_fit(db, s, 6)
    with pytest.raises(Conflict) as e:
        check_count_only_holds_fit(db, s, 5)
    assert e.value.message["message"] == ("Cannot lower to 5: 6 cores are reserved by count only "
                                         "and only 5 would stay Available.")
