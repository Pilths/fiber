"""Customer usage per segment (header customer search) and the customer id on search results."""
import pytest
from sqlalchemy import text
from test_reservations import H, act, book, build, count_only, one


@pytest.fixture
def w(db):
    return build(db)


def usage(client, customer_id):
    return client.get(f"/api/customers/{customer_id}/usage", headers=H("planner1"))


def test_reserved_in_use_counted_requested_not(client, db, w):
    reserved = book(client, w, [w["c1"][1], w["c1"][2], w["c1"][3]]).json()["id"]
    act(client, reserved, "approve")
    db.execute(text("UPDATE cores SET in_use = true WHERE id = :c"), {"c": w["c1"][1]})
    book(client, w, [w["c1"][4]])  # stays Requested
    body = usage(client, w["cust"]).json()
    body.pop("reservations")
    assert body == {
        "customer_id": w["cust"],
        "name": "Acme",
        "segments": [{"segment_id": w["s1"], "used_cores": 3}],
    }


def test_two_segments_listed_sorted(client, db, w):
    first = book(client, w, [w["c2"][1]]).json()["id"]
    second = book(client, w, [w["c1"][1], w["c1"][2]]).json()["id"]
    act(client, first, "approve")
    act(client, second, "approve")
    segments = usage(client, w["cust"]).json()["segments"]
    assert segments == [
        {"segment_id": w["s1"], "used_cores": 2},
        {"segment_id": w["s2"], "used_cores": 1},
    ]


def test_only_requested_is_listed_with_zero_used(client, db, w):
    book(client, w, [w["c1"][1]])
    segments = usage(client, w["cust"]).json()["segments"]
    assert segments == [{"segment_id": w["s1"], "used_cores": 0}]


def test_count_only_reservation_adds_remaining(client, db, w):
    count_only(db, w, 3)  # cust2 on s2
    assert usage(client, w["cust2"]).json()["segments"] == [{"segment_id": w["s2"], "used_cores": 3}]


def test_corrected_customer_is_respected(client, db, w):
    rid = book(client, w, [w["c1"][1], w["c1"][2]]).json()["id"]
    act(client, rid, "approve")
    assert act(client, rid, "correct", customer_id=w["cust2"]).status_code == 200
    assert usage(client, w["cust"]).json()["segments"] == []
    assert usage(client, w["cust2"]).json()["segments"] == [{"segment_id": w["s1"], "used_cores": 2}]


def test_unknown_customer_404(client, db, w):
    assert usage(client, 999999).status_code == 404


def test_customer_without_reservations(client, db, w):
    assert usage(client, w["cust"]).json()["segments"] == []


def test_requires_sign_in(client, db, w):
    assert client.get(f"/api/customers/{w['cust']}/usage").status_code == 401


def test_search_returns_customer_id(client, db, w):
    results = client.get("/api/search", params={"q": "Acme"}, headers=H("planner1")).json()
    customers = [result for result in results if result["type"] == "customer"]
    assert customers[0]["customer_id"] == w["cust"]
    segments = client.get("/api/search", params={"q": "A"}, headers=H("planner1")).json()
    assert all(r["customer_id"] is None for r in segments if r["type"] == "segment")


def test_search_finds_segment_of_count_only_customer(client, db, w):
    count_only(db, w, 3)
    name = db.execute(text("SELECT name FROM customers WHERE id = :id"), {"id": w["cust2"]}).scalar()
    results = client.get("/api/search", params={"q": name}, headers=H("planner1")).json()
    found = [r for r in results if r["type"] == "customer" and r["customer_id"] == w["cust2"]]
    assert found[0]["segment_id"] == w["s2"]


def reservations(client, customer_id):
    return usage(client, customer_id).json()["reservations"]


def test_two_reservations_listed_with_own_segments(client, db, w):
    first = book(client, w, [w["c1"][1], w["c1"][2]], srf_id="SRF-1", planned_date="2026-12-01").json()["id"]
    second = book(client, w, [w["c2"][1]]).json()["id"]
    act(client, first, "approve")
    act(client, second, "approve")
    assert reservations(client, w["cust"]) == [
        {"reservation_id": first, "srf_id": "SRF-1", "planned_date": "2026-12-01", "used_cores": 2,
         "segments": [{"segment_id": w["s1"], "used_cores": 2}]},
        {"reservation_id": second, "srf_id": None, "planned_date": None, "used_cores": 1,
         "segments": [{"segment_id": w["s2"], "used_cores": 1}]},
    ]


def test_requested_only_reservation_listed_with_zero(client, db, w):
    rid = book(client, w, [w["c1"][1]]).json()["id"]
    assert reservations(client, w["cust"]) == [
        {"reservation_id": rid, "srf_id": None, "planned_date": None, "used_cores": 0,
         "segments": [{"segment_id": w["s1"], "used_cores": 0}]},
    ]


def test_count_only_reservation_lists_remaining(client, db, w):
    rid = count_only(db, w, 3)
    listed = reservations(client, w["cust2"])
    assert [(r["reservation_id"], r["used_cores"]) for r in listed] == [(rid, 3)]
    assert listed[0]["segments"] == [{"segment_id": w["s2"], "used_cores": 3}]


def test_released_reservation_is_absent(client, db, w):
    rid = book(client, w, [w["c1"][1]]).json()["id"]
    act(client, rid, "approve")
    assert act(client, rid, "release", cores=[w["c1"][1]]).status_code == 200
    assert reservations(client, w["cust"]) == []


def test_corrected_customer_moves_reservation(client, db, w):
    rid = book(client, w, [w["c1"][1]]).json()["id"]
    act(client, rid, "approve")
    act(client, rid, "correct", customer_id=w["cust2"], planned_date="2027-01-05")
    assert reservations(client, w["cust"]) == []
    moved = reservations(client, w["cust2"])
    assert [r["reservation_id"] for r in moved] == [rid]
    assert moved[0]["planned_date"] == "2027-01-05"


def test_reservation_sums_equal_top_level_segments(client, db, w):
    first = book(client, w, [w["c1"][1], w["c1"][2]]).json()["id"]
    second = book(client, w, [w["c1"][3], w["c2"][1]]).json()["id"]
    book(client, w, [w["c1"][4]])  # stays Requested
    act(client, first, "approve")
    act(client, second, "approve")
    body = usage(client, w["cust"]).json()
    summed = {}
    for reservation in body["reservations"]:
        assert reservation["used_cores"] == sum(s["used_cores"] for s in reservation["segments"])
        for segment in reservation["segments"]:
            summed[segment["segment_id"]] = summed.get(segment["segment_id"], 0) + segment["used_cores"]
    assert [{"segment_id": k, "used_cores": v} for k, v in sorted(summed.items())] == body["segments"]
