"""Session 8 backend: core status edit, span and site edits, history (TEST-011, TEST-021)."""
import pytest
import test_reservation_upload as tru
import test_site_master as tsm
from sqlalchemy import text
from test_auth import mkuser
from test_reservations import H, act, book, build, one


@pytest.fixture
def w(db):
    return build(db)


def post(client, path, user="admin1", **body):
    return client.post(f"/api/admin/{path}", json=body, headers=H(user))


def edits(db, entity, eid):
    return [tuple(r) for r in db.execute(text("SELECT field, old_value, new_value, reason FROM data_edits WHERE entity = :e AND entity_id = :i "
                                              "ORDER BY id"), {"e": entity, "i": eid})]


def core_status(db, cid):
    return one(db, "SELECT status FROM core_status_v WHERE core_id = :c", c=cid)


def approved(client, w, cores, user="planner1"):
    rid = book(client, w, cores, user=user).json()["id"]
    assert act(client, rid, "approve").status_code == 200
    return rid


# ---------- core status (TASK-046, TEST-011) ----------

def test_011_core_status_needs_reason_and_writes_edit(client, w, db):
    c = w["c1"][1]
    for body in ({"status": "Faulty"}, {"status": "Faulty", "reason": ""}, {"status": "Faulty", "reason": "   "}):
        assert post(client, f"cores/{c}/status", **body).status_code == 422
    assert core_status(db, c) == "Available" and not edits(db, "core", c)
    r = post(client, f"cores/{c}/status", status="Faulty", reason="OTDR shows a break")
    assert r.status_code == 200 and r.json() == {"core_id": c, "status": "Faulty"}
    assert edits(db, "core", c) == [("status", "Available", "Faulty", "OTDR shows a break")]
    assert one(db, "SELECT user_id FROM data_edits WHERE entity = 'core'") == w["admin1"]
    assert post(client, f"cores/{c}/status", status="Faulty", reason="again").status_code == 409
    assert post(client, f"cores/{c}/status", status="Available", reason="spliced").status_code == 200
    assert core_status(db, c) == "Available"
    assert post(client, f"cores/{w['c1'][2]}/status", status="Available", reason="x").status_code == 409  # not Faulty
    assert post(client, f"cores/{c}/status", status="Reserved", reason="x").status_code == 422
    assert post(client, "cores/999999/status", status="Faulty", reason="x").status_code == 404


def test_faulty_held_core_in_action_needed(client, w):
    c = w["c1"][1]
    rid = approved(client, w, [c])
    assert post(client, f"cores/{c}/status", status="Faulty", reason="cut").status_code == 200
    items = client.get("/api/needs-review", headers=H("planner1")).json()
    assert [(i["kind"], i["reservation"]["id"]) for i in items] == [("faulty_held", rid)]


def test_011_distance_edit_changes_calculated_loss(client, w):
    s = w["s1"]
    assert post(client, f"spans/{s}", distance_km="10", reason="from the file").status_code == 200
    calc = lambda: client.get(f"/api/loss/spans/{s}", headers=H("planner1")).json()["calculated_db"]
    first = float(calc())
    assert first == pytest.approx(3.0)
    assert post(client, f"spans/{s}", distance_km="20", reason="resurveyed").status_code == 200
    assert float(calc()) == pytest.approx(6.0)


# ---------- span edits (TASK-047) ----------

def test_span_edit_each_field_own_row_and_noop(client, w, db):
    s = w["s1"]
    r = post(client, f"spans/{s}", reason="survey", route_type="Trunk", region="north", cable_size=96, distance_km="4.5")
    assert r.status_code == 200 and sorted(r.json()["changed"]) == ["cable_size", "distance_km", "region", "route_type"]
    assert {e[0]: e[2:] for e in edits(db, "span", s)} == {
        "route_type": ("Trunk", "survey"), "region": ("North", "survey"), "cable_size": ("96", "survey"), "distance_km": ("4.5", "survey")}
    assert one(db, "SELECT cable_size FROM spans WHERE id = :s", s=s) == 96
    assert len(r.json()["history"]) == 4
    n = len(edits(db, "span", s))
    assert post(client, f"spans/{s}", reason="same", route_type="Trunk", distance_km="4.500").status_code == 400
    assert post(client, f"spans/{s}", reason="x").status_code == 400
    assert len(edits(db, "span", s)) == n
    assert post(client, f"spans/{s}", reason="x", region="Atlantis").status_code == 422
    assert post(client, f"spans/{s}", reason="x", route_type="Wire").status_code == 422
    assert post(client, f"spans/{s}", reason=" ", route_type="Metro").status_code == 422
    assert post(client, f"spans/{s}", reason="x", distance_km="-1").status_code == 422
    assert post(client, "spans/999999", reason="x", cable_size=1).status_code == 404


def test_survey_raise_adds_portless_cores(client, w, db):
    s = w["s2"]  # 4 cores
    assert post(client, f"spans/{s}", survey_cores=7, reason="resurvey").status_code == 200
    rows = db.execute(text("SELECT number, port_a_id FROM cores WHERE span_id = :s ORDER BY number"), {"s": s}).all()
    assert [r[0] for r in rows] == list(range(1, 8)) and all(r[1] is None for r in rows)
    assert edits(db, "span", s) == [("survey_cores", "4", "7", "resurvey")]
    assert one(db, "SELECT count(*) FROM cores c JOIN core_status_v v ON v.core_id = c.id WHERE c.span_id = :s AND v.status = 'Available'", s=s) == 7


def test_survey_lower_blocked_by_held_or_history_allowed_when_free(client, w, db):
    s = w["s1"]  # 6 cores
    rid = approved(client, w, [w["c1"][6]])
    r = post(client, f"spans/{s}", survey_cores=5, reason="resurvey")
    assert r.status_code == 409 and r.json()["detail"]["blocking_core_numbers"] == [6]
    assert one(db, "SELECT count(*) FROM cores WHERE span_id = :s", s=s) == 6 and not edits(db, "span", s)
    assert act(client, rid, "release", cores=[w["c1"][6]]).status_code == 200
    # released, but the reservation history keeps the core: still blocked
    assert post(client, f"spans/{s}", survey_cores=5, reason="resurvey").status_code == 409
    # cores 4 and 5 are free and untouched: lowering to 5 is blocked only by 6, lowering is by highest numbers
    s2 = w["s2"]
    assert post(client, f"spans/{s2}", survey_cores=2, reason="resurvey").status_code == 200
    assert one(db, "SELECT count(*) FROM cores WHERE span_id = :s", s=s2) == 4  # rows stay, nothing is deleted
    assert edits(db, "span", s2) == [("survey_cores", "4", "2", "resurvey")]
    # faulty history blocks too
    assert post(client, f"cores/{w['c1'][3]}/status", status="Faulty", reason="cut").status_code == 200
    assert post(client, f"spans/{s}", survey_cores=2, reason="x").json()["detail"]["blocking_core_numbers"] == [3, 6]


def test_survey_lower_blocked_by_count_only_reservation(client, w, db):
    from test_reservations import count_only
    count_only(db, w, 3, span="s2")  # 4 surveyed, 3 reserved by count
    assert post(client, f"spans/{w['s2']}", survey_cores=2, reason="x").status_code == 409
    assert post(client, f"spans/{w['s2']}", survey_cores=3, reason="x").status_code == 200


def test_not_surveyed_span_bookable_after_count(client, w, db):
    s3 = w["s3"]
    assert book(client, w, [w["c3"]]).status_code == 409
    assert post(client, f"spans/{s3}", survey_cores=3, reason="onsite survey").status_code == 200
    assert edits(db, "span", s3) == [("survey_cores", None, "3", "onsite survey")]
    assert one(db, "SELECT count(*) FROM cores WHERE span_id = :s", s=s3) == 3
    assert book(client, w, [w["c3"]]).status_code == 200


def test_span_sites_change_rules(client, w, db):
    s1, s2 = w["s1"], w["s2"]
    a, b, c, _d = (one(db, "SELECT id FROM sites WHERE name = :n", n=n) for n in "ABCD")
    e = one(db, "INSERT INTO sites (name, kind) VALUES ('E','site') RETURNING id")
    assert post(client, f"spans/{s1}", site_b_id=a, reason="x").status_code == 422  # same site
    assert post(client, f"spans/{s1}", site_b_id=99999, reason="x").status_code == 422  # unknown
    assert post(client, f"spans/{s1}", site_a_id=b, site_b_id=c, reason="x").status_code == 409  # B-C is span s2
    assert post(client, f"spans/{s1}", site_a_id=c, site_b_id=b, reason="x").status_code == 409  # either order
    r = post(client, f"spans/{s1}", site_b_id=e, reason="re-routed")
    assert r.status_code == 200 and r.json()["changed"] == ["site_b_id"]
    assert edits(db, "span", s1) == [("site_b_id", str(b), str(e), "re-routed")]
    assert post(client, f"spans/{s1}", site_a_id=e, site_b_id=a, reason="swap").status_code == 200  # same pair, swapped
    # an active hold blocks
    rid = approved(client, w, [w["c2"][1]])
    f = one(db, "INSERT INTO sites (name, kind) VALUES ('F','site') RETURNING id")
    assert post(client, f"spans/{s2}", site_a_id=f, reason="x").status_code == 409
    assert act(client, rid, "release", cores=[w["c2"][1]]).status_code == 200
    assert post(client, f"spans/{s2}", site_a_id=f, reason="x").status_code == 200


# ---------- site edits ----------

def test_site_edit(client, w, db):
    a = one(db, "SELECT id FROM sites WHERE name = 'A'")
    r = post(client, f"sites/{a}", lat=3.2, lon=101.7, region="north", name="  Alpha  ", reason="moved")
    assert r.status_code == 200 and sorted(r.json()["changed"]) == ["location", "name", "region"]
    got = {e[0]: e[1:] for e in edits(db, "site", a)}
    assert got["name"] == ("A", "Alpha", "moved") and got["location"] == (None, "3.2,101.7", "moved") and got["region"] == (None, "North", "moved")
    g = client.get(f"/api/admin/sites/{a}", headers=H("admin1")).json()
    assert (g["name"], g["lat"], g["lon"], g["region"]) == ("Alpha", 3.2, 101.7, "North") and len(g["history"]) == 3
    r = post(client, f"sites/{a}", lat=3.3, reason="nudge")
    assert r.json()["changed"] == ["location"] and edits(db, "site", a)[-1] == ("location", "3.2,101.7", "3.3,101.7", "nudge")
    assert post(client, f"sites/{a}", lat=3.3, reason="same").status_code == 400
    assert post(client, f"sites/{a}", name="B", reason="x").status_code == 409
    assert post(client, f"sites/{a}", lat=0, lon=0, reason="x").status_code == 422
    assert post(client, f"sites/{a}", lat=101.7, lon=3.2, reason="x").status_code == 422  # swapped
    assert post(client, f"sites/{a}", region="Atlantis", reason="x").status_code == 422
    assert post(client, f"sites/{a}", name=" ", reason="x").status_code == 422
    assert post(client, f"sites/{a}", active=False, reason="x").status_code == 409  # used by span s1
    e = one(db, "INSERT INTO sites (name, kind) VALUES ('E','site') RETURNING id")
    assert post(client, f"sites/{e}", active=False, reason="closed").status_code == 200
    assert edits(db, "site", e) == [("active", "true", "false", "closed")]
    assert [q["name"] for q in client.get("/api/admin/sites", params={"q": "alph"}, headers=H("admin1")).json()] == ["Alpha"]


def test_planner_gets_403_on_every_admin_edit_endpoint(client, w, db):
    a = one(db, "SELECT id FROM sites WHERE name = 'A'")
    for path, body in [(f"cores/{w['c1'][1]}/status", {"status": "Faulty", "reason": "x"}),
                       (f"spans/{w['s1']}", {"cable_size": 96, "reason": "x"}), (f"sites/{a}", {"name": "Z", "reason": "x"})]:
        assert post(client, path, user="planner1", **body).status_code == 403
    for path in ("history?entity=core&id=1", f"spans/{w['s1']}", f"sites/{a}", "sites?q=A"):
        assert client.get(f"/api/admin/{path}", headers=H("planner1")).status_code == 403
    assert db.execute(text("SELECT count(*) FROM data_edits")).scalar_one() == 0


def test_history_endpoint_newest_first_with_user_and_reason(client, w, db):
    s = w["s1"]
    for i, (f, v) in enumerate([("cable_size", 96), ("cable_size", 48)]):
        post(client, f"spans/{s}", **{f: v}, reason=f"edit {i}")
    rows = client.get("/api/admin/history", params={"entity": "span", "id": s}, headers=H("admin1")).json()
    assert [r["reason"] for r in rows] == ["edit 1", "edit 0"]  # same transaction time: ties broken by id, newest first
    assert rows[0]["field"] == "cable_size" and (rows[0]["old_value"], rows[0]["new_value"]) == ("96", "48")
    assert rows[0]["user"] == "admin1" and rows[0]["user_id"] == w["admin1"] and rows[0]["at"]
    assert client.get("/api/admin/history", params={"entity": "bogus", "id": s}, headers=H("admin1")).status_code == 422


# ---------- reservation and core history (TASK-077, TEST-021) ----------

def test_021_reservation_history_in_order(client, w, db):
    c1, c2, c3 = w["c1"][1], w["c1"][2], w["c1"][3]
    rid = book(client, w, [c1, c2, c3]).json()["id"]
    act(client, rid, "approve")
    client.post(f"/api/reservations/{rid}/request-release", json={"cores": [c3]}, headers=H("planner1"))
    act(client, rid, "decline-release", reason="still needed")
    act(client, rid, "correct", reason="typo", planned_date="2026-12-01")
    act(client, rid, "release", cores=[c1])
    h = client.get(f"/api/reservations/{rid}/history", headers=H("planner1")).json()
    assert [e["type"] for e in h] == ["requested", "approved", "release_requested", "release_declined", "corrected", "released"]
    nums = lambda e: [c["number"] for c in e["cores"]]
    assert nums(h[0]) == [1, 2, 3] and nums(h[1]) == [] and nums(h[2]) == [3] and nums(h[5]) == [1]
    assert [e["user"] for e in h] == ["planner1", "admin1", "planner1", "admin1", "admin1", "admin1"]
    assert h[3]["reason"] == "still needed" and h[4]["reason"] == "typo" and h[4]["planned_date"] == "2026-12-01"
    assert all(e["at"] for e in h) and all(e["reservation_id"] == rid for e in h)
    assert h[0]["unassigned_change"] is None


def test_021_assigned_event_and_unassigned_counts(client, w, db):
    from test_reservations import count_only
    rid = count_only(db, w, 3, span="s2")
    assert act(client, rid, "assign", cores=[w["c2"][1], w["c2"][2]]).status_code == 200
    h = client.get(f"/api/reservations/{rid}/history", headers=H("planner1")).json()
    assert [(e["type"], e["unassigned_change"], [c["number"] for c in e["cores"]]) for e in h] == [
        ("requested", 3, []), ("approved", None, []), ("assigned", -2, [1, 2])]


def test_021_planner_sees_only_own_reservation_history(client, w):
    rid = book(client, w, [w["c1"][1]]).json()["id"]
    assert client.get(f"/api/reservations/{rid}/history", headers=H("planner2")).status_code == 403
    assert client.get(f"/api/reservations/{rid}/history", headers=H("planner1")).status_code == 200
    assert client.get(f"/api/reservations/{rid}/history", headers=H("admin2")).status_code == 200
    assert client.get("/api/reservations/99999/history", headers=H("admin1")).status_code == 404


def test_core_history_events_edits_and_visibility(client, w):
    c1, c2 = w["c1"][1], w["c1"][2]
    rid = approved(client, w, [c1, c2])
    post(client, f"cores/{c1}/status", status="Faulty", reason="cut")
    act(client, rid, "release", cores=[c2])
    h = client.get(f"/api/cores/{c1}/history", headers=H("planner1")).json()
    assert {(i["kind"], i["type"]) for i in h} == {("reservation_event", "requested"), ("reservation_event", "approved"),
                                                  ("data_edit", "status")}  # the release of core 2 is not about core 1
    edit = next(i for i in h if i["kind"] == "data_edit")
    assert (edit["old_value"], edit["new_value"], edit["reason"], edit["user"]) == ("Reserved", "Faulty", "cut", "admin1")
    h2 = client.get(f"/api/cores/{c2}/history", headers=H("admin1")).json()
    assert "released" in [i["type"] for i in h2]
    # another planner sees no reservation events, only the status edits
    other = client.get(f"/api/cores/{c1}/history", headers=H("planner2")).json()
    assert [(i["kind"], i["type"]) for i in other] == [("data_edit", "status")]
    assert client.get("/api/cores/99999/history", headers=H("planner1")).status_code == 404


# ---------- dashboard edits are protected from uploads ----------

def test_dashboard_site_edit_marks_site_master_field_protected(client, db):
    mkuser(db, "boss", "admin")
    tsm.seed_sites(db, ["AAAA"])
    sid = one(db, "SELECT id FROM sites WHERE name = 'AAAA'")
    r = client.post(f"/api/admin/sites/{sid}", json={"lat": 3.5, "lon": 101.9, "region": "North", "reason": "surveyed"}, headers=tru.ADMIN)
    assert r.status_code == 200
    up = client.post(f"{tsm.URL}/uploads", headers=tru.ADMIN,
                     files={"file": ("sm.xlsx", tsm.workbook([tsm.site("AAAA", 3.1, 101.6, "South")], None), "application/octet-stream")})
    uid = up.json()["upload_id"]
    items = client.get(f"{tsm.URL}/uploads/{uid}/rows", params={"sheet": "sites", "group": "changed"}, headers=tru.ADMIN).json()["items"]
    ch = {c["field"]: c for c in items[0]["changes"]}
    assert items[0]["edited_in_dashboard"]
    assert ch["location"]["protected"] and ch["location"]["note"] == "edited in dashboard, file differs"
    assert "region" not in ch  # Site Location has no region: an upload never compares or changes it
    done = client.post(f"{tsm.URL}/uploads/{uid}/apply", json={}, headers=tru.ADMIN)
    assert done.status_code == 200
    assert one(db, "SELECT ST_Y(geom) FROM sites WHERE id = :i", i=sid) == pytest.approx(3.5)
    assert one(db, "SELECT details->>'region' FROM sites WHERE id = :i", i=sid) == "North"


def test_dashboard_span_edit_marks_reservation_upload_field_protected(client, db):
    mkuser(db, "boss", "admin")
    mkuser(db, "plan", "planner")
    for n in ("AABB", "BBCC"):
        db.execute(text("INSERT INTO sites (name, kind) VALUES (:n, 'site')"), {"n": n})
    tru.run(client, tru.row())
    sid = one(db, "SELECT id FROM spans")
    for body in ({"distance_km": "9", "reason": "re-measured"}, {"survey_cores": 6, "reason": "resurvey"}, {"region": "South", "reason": "moved"}):
        assert client.post(f"/api/admin/spans/{sid}", json=body, headers=tru.ADMIN).status_code == 200
    j = tru.up(client, tru.workbook(tru.row(km=5, survey=4, region="Central"))).json()
    ch = tru.rows_of(client, j["upload_id"], "changed")[0]["data"]
    by = {c["field"]: c for c in ch["changes"]}
    assert set(by) == {"distance_km", "survey_cores", "region"}
    for c in by.values():
        assert c["protected"] and c["note"] == "edited in dashboard, file differs"


def test_lowered_cores_are_hidden_everywhere_and_raise_reuses_rows(client, w, db):
    s = w["s2"]  # 4 cores
    ids = dict(db.execute(text("SELECT number, id FROM cores WHERE span_id = :s"), {"s": s}).all())
    assert post(client, f"spans/{s}", survey_cores=2, reason="resurvey").status_code == 200
    d = client.get(f"/api/spans/{s}", headers=H("planner1")).json()
    assert [c["number"] for c in d["cores"]] == [1, 2] and d["survey_cores"] == 2
    assert d["free_cores"] == 2 and d["free_to_reserve"] == 2 and d["status_mix"] == {"Available": 2}
    assert next(x["id"] for x in client.get("/api/spans", headers=H("planner1")).json() if x["id"] == s) == s
    assert next(x for x in client.get("/api/spans", headers=H("planner1")).json() if x["id"] == s)["free_cores"] == 2
    hidden = book(client, w, [ids[3]])
    assert hidden.status_code == 409 and hidden.json()["detail"]["taken_core_ids"] == [ids[3]]
    assert book(client, w, [ids[1], ids[3]]).status_code == 409
    assert post(client, f"cores/{ids[3]}/status", status="Faulty", reason="x").status_code == 409
    assert not client.get("/api/search", params={"q": "3"}, headers=H("planner1")).json() or all(
        r.get("core_id") != ids[3] for r in client.get("/api/search", params={"q": "3"}, headers=H("planner1")).json())
    # raising reuses the same rows; new rows only beyond the highest existing number
    assert post(client, f"spans/{s}", survey_cores=5, reason="resurvey").status_code == 200
    now = dict(db.execute(text("SELECT number, id FROM cores WHERE span_id = :s"), {"s": s}).all())
    assert sorted(now) == [1, 2, 3, 4, 5] and all(now[n] == ids[n] for n in ids)
    assert one(db, "SELECT count(*) FROM (SELECT number FROM cores WHERE span_id = :s GROUP BY number HAVING count(*) > 1) t", s=s) == 0
    assert client.get(f"/api/spans/{s}", headers=H("planner1")).json()["free_cores"] == 5
    assert book(client, w, [ids[3]]).status_code == 200


# ---------- ports typed by hand ----------

def test_core_ports_set_change_clear_with_history(client, w, db):
    c = w["c1"][1]
    path = f"cores/{c}/ports"
    r = post(client, path, port_a=" A Tray 1 P1 ", port_b="B Tray 1 P1", reason="from the patch panel")
    assert r.status_code == 200 and (r.json()["port_a"], r.json()["port_b"], r.json()["core_id"]) == ("A Tray 1 P1", "B Tray 1 P1", c)
    assert one(db, "SELECT site_id FROM ports WHERE port_id = 'A Tray 1 P1'") == one(db, "SELECT site_a_id FROM spans WHERE id = :s", s=w["s1"])
    assert one(db, "SELECT site_id FROM ports WHERE port_id = 'B Tray 1 P1'") == one(db, "SELECT site_b_id FROM spans WHERE id = :s", s=w["s1"])
    assert edits(db, "core", c) == [("port_a", None, "A Tray 1 P1", "from the patch panel"), ("port_b", None, "B Tray 1 P1", "from the patch panel")]
    assert one(db, "SELECT user_id FROM data_edits WHERE entity = 'core' AND field = 'port_a'") == w["admin1"]
    # nothing changed: 200 and no history
    assert post(client, path, port_a="A Tray 1 P1", port_b="B Tray 1 P1", reason="same").status_code == 200
    assert len(edits(db, "core", c)) == 2
    # change one end only
    assert post(client, path, port_a="A Tray 1 P2", port_b="B Tray 1 P1", reason="moved").json()["port_a"] == "A Tray 1 P2"
    assert edits(db, "core", c)[2:] == [("port_a", "A Tray 1 P1", "A Tray 1 P2", "moved")]
    # clear: null and empty string; the ports rows stay
    r = post(client, path, port_a=None, port_b="  ", reason="wrong core")
    assert (r.json()["port_a"], r.json()["port_b"]) == (None, None)
    assert edits(db, "core", c)[3:] == [("port_a", "A Tray 1 P2", None, "wrong core"), ("port_b", "B Tray 1 P1", None, "wrong core")]
    assert one(db, "SELECT count(*) FROM ports") == 3
    assert one(db, "SELECT port_a_id IS NULL AND port_b_id IS NULL FROM cores WHERE id = :c", c=c)


def test_core_ports_label_at_another_site_is_409(client, w, db):
    assert post(client, f"cores/{w['c1'][1]}/ports", port_b="X1", reason="r").status_code == 200  # X1 at site B
    assert post(client, f"cores/{w['c2'][1]}/ports", port_a="X1", reason="r").status_code == 200  # s2 first site is B too: fine
    r = post(client, f"cores/{w['c1'][2]}/ports", port_a="X1", reason="r")  # s1 first site is A
    assert r.status_code == 409 and "another site" in r.json()["detail"]["message"]
    assert not edits(db, "core", w["c1"][2])


def test_core_ports_validation_and_permissions(client, w, db):
    c = w["c1"][1]
    for body in ({"port_a": "P1"}, {"port_a": "P1", "reason": " "}):
        assert post(client, f"cores/{c}/ports", **body).status_code == 422
    assert post(client, f"cores/{c}/ports", port_a="P1", reason="x", user="planner1").status_code == 403
    assert post(client, "cores/999999/ports", port_a="P1", reason="x").status_code == 404
    assert one(db, "SELECT count(*) FROM ports") == 0 and not edits(db, "core", c)


# ---------- count-only holds listed on the span ----------

def test_span_detail_lists_unassigned_holds(client, w, db):
    from test_reservations import count_only
    r1 = count_only(db, w, 2, span="s2")
    r2 = count_only(db, w, 1, span="s2")
    d = client.get(f"/api/spans/{w['s2']}", headers=H("planner1")).json()
    assert [(u["reservation_id"], u["remaining"], u["customer"]) for u in d["unassigned"]] == [(r1, 2, "Beta"), (r2, 1, "Beta")]
    assert d["unassigned_reserved"] == sum(u["remaining"] for u in d["unassigned"]) == 3
    assert "planned_date" in d["unassigned"][0]
    assert act(client, r1, "assign", cores=[w["c2"][1], w["c2"][2]]).status_code == 200  # fully assigned: drops out
    d = client.get(f"/api/spans/{w['s2']}", headers=H("planner1")).json()
    assert [(u["reservation_id"], u["remaining"]) for u in d["unassigned"]] == [(r2, 1)] and d["unassigned_reserved"] == 1
    assert client.get(f"/api/spans/{w['s1']}", headers=H("planner1")).json()["unassigned"] == []
