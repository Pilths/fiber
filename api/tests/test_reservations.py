"""Reservation lifecycle: TEST-001 to TEST-006 and the surveyed-capacity / count-only rules."""
from concurrent.futures import ThreadPoolExecutor
from threading import Barrier

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import text
from sqlalchemy.orm import Session

from app.db import get_db
from app.main import app


def one(db, sql, **p):
    return db.execute(text(sql), p).scalar_one()


def build(db):
    """planner1/2, admin1/2, span s1 (6 surveyed cores), s2 (4), s3 (never surveyed, 1 stray core), customers."""
    w = {}
    for u, role in [("planner1", "planner"), ("planner2", "planner"), ("admin1", "admin"), ("admin2", "admin")]:
        w[u] = one(db, "INSERT INTO users (username, display_name, role) VALUES (:u,:u,:r) RETURNING id", u=u, r=role)
    a, b, c, d = (one(db, "INSERT INTO sites (name, kind) VALUES (:n,'site') RETURNING id", n=n) for n in "ABCD")
    w["s1"], w["s2"], w["s3"] = (
        one(db, "INSERT INTO spans (site_a_id, site_b_id, survey_cores) VALUES (:a,:b,:n) RETURNING id", a=x, b=y, n=n)
        for x, y, n in [(a, b, 6), (b, c, 4), (c, d, None)])
    w["c1"] = {n: one(db, "INSERT INTO cores (span_id, number) VALUES (:s,:n) RETURNING id", s=w["s1"], n=n) for n in range(1, 7)}
    w["c2"] = {n: one(db, "INSERT INTO cores (span_id, number) VALUES (:s,:n) RETURNING id", s=w["s2"], n=n) for n in range(1, 5)}
    w["c3"] = one(db, "INSERT INTO cores (span_id, number) VALUES (:s, 1) RETURNING id", s=w["s3"])
    w["cust"] = one(db, "INSERT INTO customers (name) VALUES ('Acme') RETURNING id")
    w["cust2"] = one(db, "INSERT INTO customers (name) VALUES ('Beta') RETURNING id")
    return w


@pytest.fixture
def w(db):
    return build(db)


def H(user):
    return {"X-Dev-User": user}


def book(client, w, cores, user="planner1", **kw):
    return client.post("/api/reservations", json={"customer_id": w["cust"], "cores": cores, **kw}, headers=H(user))


def act(client, rid, action, user="admin1", **body):
    return client.post(f"/api/reservations/{rid}/{action}", json=body, headers=H(user))


def status(db, core):
    return one(db, "SELECT status FROM core_status_v WHERE core_id = :c", c=core)


def event_types(db, rid):
    return list(db.execute(text("SELECT type FROM reservation_events WHERE reservation_id = :r ORDER BY id"), {"r": rid}).scalars())


def count_only(db, w, n, span="s2", planner="planner1"):
    """What an Excel import makes: approved, n cores wanted, no cores, no holds."""
    rid = one(db, "INSERT INTO reservations (customer_id, planner_id, imported, unassigned_cores, unassigned_span_id) "
                  "VALUES (:c,:u,true,:n,:s) RETURNING id", c=w["cust2"], u=w[planner], n=n, s=w[span])
    for kind, who in (("requested", planner), ("approved", "admin1")):
        db.execute(text("INSERT INTO reservation_events (reservation_id, type, user_id) VALUES (:r,:t,:u)"),
                   {"r": rid, "t": kind, "u": w[who]})
    return rid


def span(client, sid):
    return client.get(f"/api/spans/{sid}", headers=H("planner1")).json()


# ---------- TEST-001 ----------

def test_001_second_request_for_same_core_gets_409(client, w, db):
    core = w["c1"][1]
    assert book(client, w, [core]).status_code == 200
    r = book(client, w, [core], user="planner2")
    assert r.status_code == 409 and r.json()["detail"]["taken_core_ids"] == [core]
    assert status(db, core) == "Requested"


def test_001_concurrent_requests_exactly_one_wins(engine):
    with engine.begin() as c:
        w = build(c)
    core = w["c1"][1]

    def override():
        with Session(engine) as s:
            yield s

    app.dependency_overrides[get_db] = override
    barrier = Barrier(2)

    def go(user):
        barrier.wait()
        return book(TestClient(app), w, [core], user=user)

    try:
        with ThreadPoolExecutor(2) as pool:
            codes = sorted(f.result().status_code for f in [pool.submit(go, "planner1"), pool.submit(go, "planner2")])
        assert codes == [200, 409]
        with engine.connect() as c:
            assert one(c, "SELECT count(*) FROM core_holds") == 1
    finally:
        app.dependency_overrides.clear()
        with engine.begin() as c:
            c.execute(text("TRUNCATE users, sites, customers CASCADE"))


def test_customer_is_required(client, w):
    assert client.post("/api/reservations", json={"cores": [w["c1"][1]]}, headers=H("planner1")).status_code == 422
    assert book(client, w, []).status_code == 422
    assert client.post("/api/reservations", json={"customer_id": 999999, "cores": [w["c1"][1]]},
                       headers=H("planner1")).status_code == 422


def test_route_request_is_one_reservation_and_marks_new_customer(client, w, db):
    r = book(client, w, [w["c1"][1], w["c2"][1]], planned_date="2026-12-01").json()
    assert r["status"] == "pending" and r["is_new_customer"] is True and len(r["cores"]) == 2
    assert {c["span_id"] for c in r["cores"]} == {w["s1"], w["s2"]}
    assert one(db, "SELECT count(*) FROM core_holds") == 2 and event_types(db, r["id"]) == ["requested"]
    assert book(client, w, [w["c1"][2]]).json()["is_new_customer"] is False


def test_cannot_book_non_available_core(client, w, db):
    db.execute(text("UPDATE cores SET in_use = true WHERE id = :c"), {"c": w["c1"][1]})
    assert book(client, w, [w["c1"][1], w["c1"][2]]).status_code == 409
    assert one(db, "SELECT count(*) FROM reservations") == 0  # all or nothing


# ---------- TEST-002 ----------

def test_002_approve_then_reject_with_reason(client, w, db):
    rid = book(client, w, [w["c1"][1]]).json()["id"]
    assert status(db, w["c1"][1]) == "Requested"
    assert act(client, rid, "approve").json()["status"] == "approved"
    assert status(db, w["c1"][1]) == "Reserved"

    rid2 = book(client, w, [w["c1"][2]]).json()["id"]
    assert act(client, rid2, "reject").status_code == 422
    assert act(client, rid2, "reject", reason="  ").status_code == 422
    assert act(client, rid2, "reject", reason="Needed for another customer").status_code == 200
    assert status(db, w["c1"][2]) == "Available"
    mine = client.get("/api/reservations", params={"mine": True, "status": "rejected"}, headers=H("planner1")).json()
    assert [(r["id"], r["last_reason"]) for r in mine] == [(rid2, "Needed for another customer")]
    assert [r["id"] for r in client.get("/api/reservations", params={"mine": True, "status": "pending"}, headers=H("planner1")).json()] == []
    assert act(client, rid, "approve").status_code == 409  # already approved
    assert act(client, rid2, "approve").status_code == 409  # rejected is final
    assert act(client, rid2, "approve", user="planner1").status_code == 403


def test_approvals_are_admin_only_oldest_first(client, w, db):
    first = book(client, w, [w["c1"][1]]).json()["id"]
    second = book(client, w, [w["c1"][2]], user="planner2").json()["id"]
    assert client.get("/api/approvals", headers=H("planner1")).status_code == 403
    assert [r["id"] for r in client.get("/api/approvals", headers=H("admin1")).json()] == [first, second]
    bell = client.get("/api/bell", headers=H("admin1")).json()
    assert bell == {"approvals": 2, "needs_review": 0, "total": 2}
    assert client.get("/api/bell", headers=H("planner1")).json()["approvals"] == 0


# ---------- TEST-003 ----------

def test_003_withdraw(client, w, db):
    rid = book(client, w, [w["c1"][1]]).json()["id"]
    assert act(client, rid, "withdraw", user="planner2").status_code == 403
    assert status(db, w["c1"][1]) == "Requested"
    assert act(client, rid, "withdraw", user="planner1").json()["status"] == "withdrawn"
    assert status(db, w["c1"][1]) == "Available"
    assert book(client, w, [w["c1"][1]], user="planner2").status_code == 200  # free again at once
    approved = book(client, w, [w["c1"][2]]).json()["id"]
    act(client, approved, "approve")
    assert act(client, approved, "withdraw", user="planner1").status_code == 409  # only pending


# ---------- TEST-004 ----------

def test_004_partial_release_of_route_reservation(client, w, db):
    s1c, s2c = [w["c1"][1], w["c1"][2]], [w["c2"][1]]
    rid = book(client, w, s1c + s2c).json()["id"]
    act(client, rid, "approve")
    assert act(client, rid, "request-release", user="planner2", cores=s1c).status_code == 403
    assert act(client, rid, "request-release", user="planner1", cores=[w["c1"][5]]).status_code == 422  # not its core
    r = act(client, rid, "request-release", user="planner1", cores=s1c).json()
    assert r["awaiting"] == "release" and sorted(r["release_requested_cores"]) == sorted(s1c)
    assert [i["kind"] for i in client.get("/api/needs-review", headers=H("planner1")).json()] == ["release_requested"]
    assert {x["id"] for x in client.get("/api/approvals", headers=H("admin1")).json()} == {rid}
    assert status(db, s1c[0]) == "Reserved"  # still Reserved until an admin releases

    assert act(client, rid, "decline-release").status_code == 422
    r = act(client, rid, "decline-release", reason="Customer confirmed the order").json()
    assert r["awaiting"] is None and r["last_reason"] == "Customer confirmed the order"  # planner sees why
    assert act(client, rid, "decline-release", reason="again").status_code == 409  # nothing waiting

    assert act(client, rid, "request-release", user="planner1", cores=s1c).status_code == 200
    r = act(client, rid, "release", cores=s1c).json()
    assert r["status"] == "approved"
    assert [status(db, c) for c in s1c + s2c] == ["Available", "Available", "Reserved"]  # other span stays Reserved
    assert one(db, "SELECT count(*) FROM reservation_cores WHERE reservation_id = :r", r=rid) == 3  # nothing deleted
    assert event_types(db, rid) == ["requested", "approved", "release_requested", "release_declined",
                                    "release_requested", "released"]
    per_event = db.execute(text("SELECT e.type, array_agg(rc.core_id ORDER BY rc.core_id) FROM release_cores rc "
                                "JOIN reservation_events e ON e.id = rc.event_id GROUP BY e.id, e.type ORDER BY e.id")).all()
    assert per_event == [("release_requested", sorted(s1c)), ("release_requested", sorted(s1c)), ("released", sorted(s1c))]
    assert [(c["core_id"], c["held"]) for c in r["cores"] if c["span_id"] == w["s1"]] == [(c, False) for c in s1c]

    r = act(client, rid, "release", cores=s2c).json()  # releasing the rest ends it
    assert r["status"] == "ended" and status(db, s2c[0]) == "Available"
    assert one(db, "SELECT count(*) FROM core_holds") == 0
    assert act(client, rid, "release", cores=s2c).status_code == 409
    assert act(client, rid, "keep", user="planner1").status_code == 409


def test_release_must_name_held_cores(client, w):
    rid = book(client, w, [w["c1"][1]]).json()["id"]
    act(client, rid, "approve")
    assert act(client, rid, "release", cores=[]).status_code == 422
    assert act(client, rid, "release", cores=[w["c1"][3]]).status_code == 422
    assert act(client, rid, "release", user="planner1", cores=[w["c1"][1]]).status_code == 403


# ---------- TEST-005 ----------

def old_reservation(db, w, months, imported=False, planned_date=None):
    rid = one(db, "INSERT INTO reservations (customer_id, planner_id, imported, planned_date) VALUES (:c,:u,:i,:d) RETURNING id",
              c=w["cust"], u=w["planner1"], i=imported, d=planned_date)
    for kind, who in (("requested", "planner1"), ("approved", "admin1")):
        db.execute(text("INSERT INTO reservation_events (reservation_id, type, user_id, created_at) "
                        "VALUES (:r,:t,:u, now() - make_interval(months => :m))"), {"r": rid, "t": kind, "u": w[who], "m": months})
    return rid


def review(client, user="planner1"):
    return [(i["kind"], i["reservation"]["id"]) for i in client.get("/api/needs-review", headers=H(user)).json()]


def test_005_stale_keep_and_undated_import(client, w, db):
    fresh, stale = old_reservation(db, w, 1), old_reservation(db, w, 4)
    assert review(client) == [("stale", stale)]
    assert client.get("/api/bell", headers=H("planner1")).json() == {"approvals": 0, "needs_review": 1, "total": 1}
    assert review(client, "planner2") == []  # planners see only their own
    assert review(client, "admin1") == [("stale", stale)]
    assert act(client, stale, "keep", user="planner2").status_code == 403
    assert act(client, stale, "keep", user="planner1").status_code == 200
    assert review(client) == []
    assert fresh and event_types(db, stale)[-1] == "kept"

    undated = old_reservation(db, w, 5, imported=True)  # import date = its approved event
    assert review(client) == [("stale", undated)]
    r = act(client, undated, "correct", reason="typo", planned_date="2027-01-01")
    assert r.status_code == 409  # its date cannot be corrected
    assert act(client, undated, "correct", reason="rename", customer_id=w["cust2"]).status_code == 200  # customer can

    dated = old_reservation(db, w, 0, imported=True, planned_date="2020-01-01")  # reserved date starts the clock
    assert ("stale", dated) in review(client)


def test_old_core_status_edit_is_not_in_needs_review(client, w, db):
    rid = book(client, w, [w["c1"][1]]).json()["id"]
    act(client, rid, "approve")
    db.execute(text("INSERT INTO data_edits (entity, entity_id, field, new_value, reason, user_id) "
                    "VALUES ('core', :c, 'status', 'Faulty', 'OTDR', :u)"), {"c": w["c1"][1], "u": w["admin1"]})
    assert client.get("/api/needs-review", headers=H("planner1")).json() == []
    assert "faulty_held" not in client.get("/openapi.json").text


# ---------- TEST-006 ----------

def test_006_admin_can_approve_their_own_request(client, w, db):
    rid = book(client, w, [w["c1"][1]], user="admin1").json()["id"]
    r = act(client, rid, "approve", user="admin1")
    assert r.status_code == 200 and r.json()["status"] == "approved"
    ev = db.execute(text("SELECT type, user_id FROM reservation_events WHERE reservation_id = :r ORDER BY id"), {"r": rid}).all()
    assert [e[0] for e in ev] == ["requested", "approved"] and ev[0][1] == ev[1][1]  # both events name the same admin


def test_006_correction_rules(client, w, db):
    rid = book(client, w, [w["c1"][1]], planned_date="2026-12-01").json()["id"]
    assert act(client, rid, "correct", reason="x", planned_date="2027-01-01").status_code == 409  # pending
    act(client, rid, "approve")
    assert act(client, rid, "correct", planned_date="2027-01-01").status_code == 422  # reason required
    assert act(client, rid, "correct", reason="  ", planned_date="2027-01-01").status_code == 422
    assert act(client, rid, "correct", reason="typo").status_code == 422  # nothing to change
    assert act(client, rid, "correct", reason="swap", cores=[w["c1"][2]]).status_code == 422  # cores are never corrected
    assert act(client, rid, "correct", reason="typo", planned_date="2027-01-01", user="planner1").status_code == 403

    r = act(client, rid, "correct", reason="Customer renamed", customer_id=w["cust2"], planned_date="2027-01-01").json()
    assert (r["customer"], r["planned_date"], r["status"]) == ("Beta", "2027-01-01", "approved")
    # the original values stay in the reservation row and the history; the grid shows the corrected ones
    assert db.execute(text("SELECT customer_id, planned_date::text FROM reservations WHERE id = :r"), {"r": rid}).one() == (w["cust"], "2026-12-01")
    assert event_types(db, rid) == ["requested", "approved", "corrected"]
    assert one(db, "SELECT reason FROM reservation_events WHERE type = 'corrected'") == "Customer renamed"
    core = span(client, w["s1"])["cores"][0]
    assert (core["customer"], core["planned_date"]) == ("Beta", "2027-01-01")
    assert act(client, rid, "correct", reason="date only", planned_date="2027-02-02").json()["customer"] == "Beta"

    rejected = book(client, w, [w["c1"][3]]).json()["id"]
    act(client, rejected, "reject", reason="no")
    withdrawn = book(client, w, [w["c1"][3]]).json()["id"]
    act(client, withdrawn, "withdraw", user="planner1")
    ended = book(client, w, [w["c1"][4]]).json()["id"]
    act(client, ended, "approve")
    act(client, ended, "release", cores=[w["c1"][4]])
    for other in (rejected, withdrawn, ended):
        assert act(client, other, "correct", reason="x", planned_date="2027-01-01").status_code == 409


def test_my_reservations_list(client, w):
    mine = book(client, w, [w["c1"][1]]).json()["id"]
    book(client, w, [w["c1"][2]], user="planner2")
    assert [r["id"] for r in client.get("/api/reservations", params={"mine": True}, headers=H("planner1")).json()] == [mine]
    assert len(client.get("/api/reservations", headers=H("planner1")).json()) == 1  # planners never see others
    assert len(client.get("/api/reservations", headers=H("admin1")).json()) == 2
    assert client.get("/api/reservations", params={"status": "bogus"}, headers=H("admin1")).status_code == 422


# ---------- surveyed capacity and count-only reservations ----------

def test_not_surveyed_span_refuses_booking(client, w):
    r = book(client, w, [w["c3"]])
    assert r.status_code == 409 and "not surveyed" in r.json()["detail"]["message"]
    s = span(client, w["s3"])
    assert (s["survey_cores"], s["not_surveyed"], s["free_to_reserve"]) == (None, None, 0)


def test_count_only_limits_booking(client, w, db):
    count_only(db, w, 3)  # 3 of the 4 cores on s2 promised
    s = client.get("/api/spans", headers=H("planner1")).json()
    s2 = next(x for x in s if x["id"] == w["s2"])
    assert (s2["free_cores"], s2["unassigned_reserved"], s2["free_to_reserve"]) == (4, 3, 1)
    r = book(client, w, [w["c2"][1], w["c2"][2]])
    assert r.status_code == 409 and "only 1 free to reserve" in r.json()["detail"]["message"]
    assert one(db, "SELECT count(*) FROM core_holds") == 0
    assert book(client, w, [w["c2"][1]]).status_code == 200
    assert book(client, w, [w["c2"][2]], user="planner2").status_code == 409  # now 0 free to reserve
    assert book(client, w, [w["c1"][1], w["c1"][2]]).status_code == 200  # other spans unaffected


def test_assign_reduces_remaining_and_creates_holds(client, w, db):
    rid = count_only(db, w, 3)
    assert act(client, rid, "assign", cores=[w["c2"][1], w["c2"][2], w["c2"][3], w["c2"][4]]).status_code == 409  # > remaining
    assert act(client, rid, "assign", cores=[w["c1"][1]]).status_code == 422  # wrong span
    assert act(client, rid, "assign", user="planner1", cores=[w["c2"][1]]).status_code == 403
    assert act(client, rid, "assign", cores=[]).status_code == 422
    r = act(client, rid, "assign", cores=[w["c2"][1], w["c2"][2]]).json()
    assert (r["unassigned_cores"], r["remaining_unassigned"], len(r["cores"])) == (3, 1, 2)
    assert [status(db, w["c2"][n]) for n in (1, 2, 3)] == ["Reserved", "Reserved", "Available"]
    assert one(db, "SELECT count(*) FROM core_holds WHERE reservation_id = :r", r=rid) == 2
    assert event_types(db, rid) == ["requested", "approved", "assigned"]
    s2 = next(x for x in client.get("/api/spans", headers=H("planner1")).json() if x["id"] == w["s2"])
    assert (s2["free_cores"], s2["unassigned_reserved"], s2["free_to_reserve"]) == (2, 1, 1)  # promise kept, not exceeded
    assert act(client, rid, "assign", cores=[w["c2"][1]]).status_code == 409  # already held
    assert act(client, rid, "assign", cores=[w["c2"][3], w["c2"][4]]).status_code == 409  # only 1 remaining
    assert act(client, rid, "assign", cores=[w["c2"][3]]).json()["remaining_unassigned"] == 0


def test_assign_conflict_with_taken_core(client, w, db):
    rid = count_only(db, w, 2)
    assert book(client, w, [w["c2"][1]], user="planner2").status_code == 200  # 4 - 2 promised leaves 2
    r = act(client, rid, "assign", cores=[w["c2"][1]])
    assert r.status_code == 409 and r.json()["detail"]["taken_core_ids"] == [w["c2"][1]]


def test_release_of_count_only_frees_its_count(client, w, db):
    rid = count_only(db, w, 3)
    assert next(x for x in client.get("/api/spans", headers=H("planner1")).json() if x["id"] == w["s2"])["free_to_reserve"] == 1
    r = act(client, rid, "release", cores=[]).json()
    assert r["status"] == "ended" and r["remaining_unassigned"] == 0
    assert next(x for x in client.get("/api/spans", headers=H("planner1")).json() if x["id"] == w["s2"])["free_to_reserve"] == 4
    assert one(db, "SELECT count(*) FROM reservations WHERE id = :r AND unassigned_cores = 3", r=rid) == 1  # nothing rewritten

    other = count_only(db, w, 2)  # partly assigned, then every held core released: the rest of the count goes too
    act(client, other, "assign", cores=[w["c2"][1]])
    r = act(client, other, "release", cores=[w["c2"][1]]).json()
    assert r["status"] == "ended" and r["remaining_unassigned"] == 0


def test_count_only_reservation_in_lists(client, w, db):
    rid = count_only(db, w, 3)
    r = next(x for x in client.get("/api/reservations", params={"mine": True}, headers=H("planner1")).json() if x["id"] == rid)
    assert (r["status"], r["cores"], r["remaining_unassigned"]) == ("approved", [], 3)
    assert r["unassigned_span"] == "B - C"


# ---------- core holder endpoint and stale flags on span detail ----------

def test_core_holder_endpoint_and_span_stale(client, w, db):
    free, held, old = w["c1"][1], w["c1"][2], w["c1"][3]
    r = client.get(f"/api/cores/{free}", headers=H("planner2"))
    assert r.status_code == 200 and r.json()["holder"] is None and r.json()["hidden"] is False
    assert r.json()["span_id"] == w["s1"] and r.json()["number"] == 1 and r.json()["span_name"] == "A - B"
    rid = book(client, w, [held]).json()["id"]
    mine = client.get(f"/api/cores/{held}", headers=H("planner1")).json()["holder"]
    assert mine["is_mine"] is True and mine["state"] == "requested" and mine["customer"] == "Acme" and mine["stale"] is False
    other = client.get(f"/api/cores/{held}", headers=H("planner2")).json()["holder"]
    assert other["is_mine"] is False and other["customer"] == "Acme" and other["reservation_id"] == rid
    assert other["owner"]["username"] == "planner1"
    act(client, rid, "approve")
    assert client.get(f"/api/cores/{held}", headers=H("planner2")).json()["holder"]["state"] == "approved"
    # a 4-month-old approved reservation holding core 3
    orid = old_reservation(db, w, 4)
    db.execute(text("INSERT INTO reservation_cores (reservation_id, core_id) VALUES (:r,:c)"), {"r": orid, "c": old})
    db.execute(text("INSERT INTO core_holds (core_id, reservation_id) VALUES (:c,:r)"), {"r": orid, "c": old})
    h = client.get(f"/api/cores/{old}", headers=H("planner2")).json()["holder"]
    assert h["stale"] is True and h["stale_since"] is not None
    rows = {c["id"]: c for c in span(client, w["s1"])["cores"]}
    assert rows[old]["stale"] is True and rows[old]["reservation_id"] == orid and rows[old]["stale_since"] == h["stale_since"]
    assert rows[held]["stale"] is False and rows[held]["reservation_id"] == rid
    assert rows[free]["reservation_id"] is None and rows[free]["stale"] is False
    # hidden core (above survey_cores) and unknown core
    hidden = one(db, "INSERT INTO cores (span_id, number) VALUES (:s, 7) RETURNING id", s=w["s1"])
    assert client.get(f"/api/cores/{hidden}", headers=H("planner1")).status_code == 404
    assert client.get("/api/cores/999999", headers=H("planner1")).status_code == 404


def test_srf_and_planner_on_span_detail(client, w, db):
    core = w["c1"][1]
    assert book(client, w, [core], srf_id=" SRF-9 ").status_code == 200
    held = next(c for c in span(client, w["s1"])["cores"] if c["id"] == core)
    assert held["srf_id"] == "SRF-9" and held["planner"] and held["srf_id"] != " SRF-9 "
    free = next(c for c in span(client, w["s1"])["cores"] if c["id"] != core and c["status"] == "Available")
    assert free["srf_id"] is None and free["planner"] is None
