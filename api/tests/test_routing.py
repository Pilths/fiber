"""Routing (TEST-012): options over the span graph, route picking, graph invalidation."""
import pytest
from sqlalchemy import text

from app.routing.graph import invalidate


def H(u="planner1"):
    return {"X-Dev-User": u}


def one(db, sql, **p):
    return db.execute(text(sql), p).scalar_one()


@pytest.fixture(autouse=True)
def fresh_graph():
    invalidate()  # tests roll back their data, so the cache must not outlive them
    yield
    invalidate()


@pytest.fixture
def g(db):
    """Sites A..F. Paths A->D: short A-B-D (3+3=6 km, B-D has 1 free core), mid A-C-D (4+4=8 km, 3 free),
    long A-E-D (5+5=10 km, E-D has no distance), plus A-D direct (7 km, not surveyed). F has no span.
    Segment 'A - D' labels A-B, B-D. B-C exists too (more paths)."""
    w = {}
    for u, role in [("planner1", "planner"), ("admin1", "admin")]:
        w[u] = one(db, "INSERT INTO users (username, display_name, role) VALUES (:u,:u,:r) RETURNING id", u=u, r=role)
    s = {n: one(db, "INSERT INTO sites (name, kind) VALUES (:n,'site') RETURNING id", n=n) for n in "ABCDEF"}
    w["site"] = s

    def span(a, b, km, survey):
        sid = one(db, "INSERT INTO spans (site_a_id, site_b_id, distance_km, survey_cores) VALUES (:a,:b,:k,:n) RETURNING id",
                  a=s[a], b=s[b], k=km, n=survey)
        for n in range(1, (survey or 0) + 1):
            db.execute(text("INSERT INTO cores (span_id, number) VALUES (:s,:n)"), {"s": sid, "n": n})
        return sid

    w["AB"], w["BD"] = span("A", "B", 3, 5), span("B", "D", 3, 1)
    w["AC"], w["CD"] = span("A", "C", 4, 3), span("D", "C", 4, 3)  # D-C stored reversed: travel order must flip
    w["AE"], w["ED"] = span("A", "E", 5, 4), span("E", "D", None, 4)
    w["AD"] = span("A", "D", 7, None)
    seg = one(db, "INSERT INTO segments (site_a_id, site_b_id) VALUES (:a,:d) RETURNING id", a=s["A"], d=s["D"])
    for i, k in enumerate(("AB", "BD")):
        db.execute(text("INSERT INTO segment_spans (segment_id, span_id, position) VALUES (:g,:s,:p)"), {"g": seg, "s": w[k], "p": i})
    db.execute(text("INSERT INTO measurements (span_id, loss_db) VALUES (:s, 1.0)"), {"s": w["AB"]})
    w["cust"] = one(db, "INSERT INTO customers (name) VALUES ('Acme') RETURNING id")
    return w


def routes(client, g, a="A", b="D", n=1, sort=None, user="planner1"):
    q = f"/api/routes?from={g['site'][a]}&to={g['site'][b]}&cores_needed={n}" + (f"&sort={sort}" if sort else "")
    return client.get(q, headers=H(user))


def test_012_km_order_max_three_and_shape(client, g):
    r = routes(client, g, n=1)
    assert r.status_code == 200
    opts = r.json()["options"]
    assert len(opts) == 3  # 4+ candidates exist; only 3 returned
    kms = [o["total_km"] for o in opts]
    assert kms[:2] == [6, 8] and opts[2]["estimated_db"] is None  # third is A-E-D: unknown km weighs the 10 km fallback (15)
    first = opts[0]
    assert [s["name"] for s in first["spans"]] == ["A - B", "B - D"]
    assert [(s["site_a"], s["site_b"]) for s in first["spans"]] == [("A", "B"), ("B", "D")]
    assert first["spans"][0]["segment_label"] == "A - D" and first["spans"][0]["measured"] is True
    assert first["spans"][1]["measured"] is False
    assert first["fewest_free"] == 1 and first["bottleneck_span_id"] == g["BD"]
    assert (first["measured_spans"], first["total_spans"]) == (1, 2)
    assert first["estimated_db"] == pytest.approx(1.8) and first["insufficient"] is False
    assert first["best_match"] is True


def test_012_travel_order_flips_reversed_span(client, g):
    o = routes(client, g, n=1).json()["options"][1]  # A-C-D, D-C stored reversed
    assert [(s["site_a"], s["site_b"]) for s in o["spans"]] == [("A", "C"), ("C", "D")]
    assert o["spans"][1]["name"] == "D - C"


def test_012_insufficient_last_and_best_match_first_that_fits(client, g):
    opts = routes(client, g, n=2).json()["options"]  # A-B-D has only 1 free
    assert [o["insufficient"] for o in opts[:2]] == [False, False] and opts[0]["total_km"] == 8
    assert opts[0]["best_match"] is True and not any(o["best_match"] for o in opts[1:])
    assert opts[-1]["insufficient"] is True  # the not surveyed direct span or the 1-free path


def test_012_free_cores_sort(client, g):
    opts = routes(client, g, n=1, sort="free_cores").json()["options"]
    assert [o["fewest_free"] for o in opts[:2]] == [4, 3]  # A-E-D, then A-C-D; A-B-D (1 free) last
    assert opts[2]["fewest_free"] == 1
    assert opts[0]["best_match"] is True


def test_012_null_db_when_span_has_no_distance_and_not_surveyed_insufficient(client, g):
    opts = routes(client, g, n=1).json()["options"]
    e = next(o for o in opts if o["spans"][1]["span_id"] == g["ED"])
    assert e["estimated_db"] is None and e["distance_incomplete"] is True and e["spans"][1]["km"] is None
    opts = routes(client, g, n=4).json()["options"]  # only A-E-D has 4 free; the others are insufficient, by weight
    assert [o["insufficient"] for o in opts] == [False, True, True] and opts[0]["best_match"]
    direct = opts[-1]
    assert [s["span_id"] for s in direct["spans"]] == [g["AD"]]
    assert direct["insufficient"] is True and direct["spans"][0]["surveyed"] is False and direct["fewest_free"] == 0


def test_012_route_inside_a_segment(client, g):
    r = routes(client, g, a="B", b="D").json()  # B is inside segment A - D
    assert r["options"][0]["spans"][0]["span_id"] == g["BD"] and r["options"][0]["spans"][0]["segment_label"] == "A - D"


def test_012_errors_and_no_path(client, g):
    assert routes(client, g, a="A", b="A").status_code == 422
    assert "from and to must differ" in routes(client, g, a="A", b="A").text
    assert client.get(f"/api/routes?from=999999&to={g['site']['A']}&cores_needed=1", headers=H()).status_code == 422
    for q, field in [("to=1&cores_needed=1", "from"), (f"from={g['site']['A']}&cores_needed=1", "to"),
                     (f"from={g['site']['A']}&to={g['site']['B']}", "cores_needed"),
                     (f"from={g['site']['A']}&to={g['site']['B']}&cores_needed=0", "cores_needed"),
                     (f"from={g['site']['A']}&to={g['site']['B']}&cores_needed=x", "cores_needed")]:
        r = client.get("/api/routes?" + q, headers=H())
        assert r.status_code == 422 and field in r.json()["detail"][0]["loc"]
    r = routes(client, g, a="A", b="F")  # F exists but has no span
    assert r.status_code == 200 and r.json() == {"options": [], "message": "No route connects these sites"}


def test_endpoints_only_sites_with_spans_sorted(client, g):
    r = client.get("/api/routes/endpoints", headers=H()).json()
    assert [s["name"] for s in r] == list("ABCDE") and set(r[0]) == {"id", "name", "kind"}


def test_graph_invalidated_after_span_edit(client, g, db):
    before = routes(client, g, n=1).json()["options"][0]
    assert before["total_km"] == 6
    r = client.post(f"/api/admin/spans/{g['BD']}", json={"distance_km": 50, "reason": "re-measured"}, headers=H("admin1"))
    assert r.status_code == 200, r.text
    after = routes(client, g, n=1).json()["options"][0]
    assert after["total_km"] == 8  # A-B-D now costs 53


def test_routes_need_sign_in(client, g):
    for url in ("/api/routes/endpoints", f"/api/routes?from={g['site']['A']}&to={g['site']['D']}&cores_needed=1",
                f"/api/routes/pick?span_ids={g['AB']}&cores_needed=1"):
        assert client.get(url).status_code in (401, 403)
        assert client.get(url, headers=H()).status_code == 200


def test_pick_takes_first_free_cores_and_posts_one_reservation(client, g, db):
    ids = f"span_ids={g['AB']}&span_ids={g['AC']}"
    p = client.get(f"/api/routes/pick?{ids}&cores_needed=2", headers=H())
    assert p.status_code == 200
    body = p.json()
    assert [[c["number"] for c in s["cores"]] for s in body["spans"]] == [[1, 2], [1, 2]]
    r = client.post("/api/reservations", json={"customer_id": g["cust"], "cores": body["core_ids"]}, headers=H())
    assert r.status_code == 200 and len(r.json()["cores"]) == 4
    assert {c["span_id"] for c in r.json()["cores"]} == {g["AB"], g["AC"]}
    assert one(db, "SELECT count(*) FROM reservations") == 1
    assert list(db.execute(text("SELECT type FROM reservation_events ORDER BY id")).scalars()) == ["requested"]
    nxt = client.get(f"/api/routes/pick?span_ids={g['AB']}&cores_needed=2", headers=H()).json()  # next free cores
    assert [c["number"] for c in nxt["spans"][0]["cores"]] == [3, 4]


def test_pick_respects_count_only_holds_and_409_names_short_span(client, g, db):
    rid = one(db, "INSERT INTO reservations (customer_id, planner_id, imported, unassigned_cores, unassigned_span_id) "
                  "VALUES (:c,:u,true,2,:s) RETURNING id", c=g["cust"], u=g["planner1"], s=g["AC"])
    for kind in ("requested", "approved"):
        db.execute(text("INSERT INTO reservation_events (reservation_id, type, user_id) VALUES (:r,:t,:u)"),
                   {"r": rid, "t": kind, "u": g["admin1"]})
    r = client.get(f"/api/routes/pick?span_ids={g['AB']}&span_ids={g['AC']}&cores_needed=2", headers=H())
    assert r.status_code == 409 and "A - C" in r.json()["detail"]["message"] and r.json()["detail"]["span_id"] == g["AC"]
    assert client.get(f"/api/routes/pick?span_ids={g['AC']}&cores_needed=1", headers=H()).status_code == 200
    # not surveyed
    r = client.get(f"/api/routes/pick?span_ids={g['AD']}&cores_needed=1", headers=H())
    assert r.status_code == 409 and "not surveyed" in r.json()["detail"]["message"]


def test_endpoints_ordered_by_section(client, g, db):
    for k, sec in (("AB", "C-C"), ("BD", "N-C"), ("AC", "north to north"), ("CD", "N-C")):
        db.execute(text("UPDATE spans SET section = :s WHERE id = :i"), {"s": sec, "i": g[k]})
    names = [s["name"] for s in client.get("/api/routes/endpoints", headers=H()).json()]
    # A and C touch N-N, then B and D touch N-C, E has no section and goes last
    assert names == ["A", "C", "B", "D", "E"]


def test_fiber_cut_span_is_not_routed(client, g, db):
    db.execute(text("UPDATE spans SET fiber_cut = true WHERE id = :s"), {"s": g["BD"]})
    invalidate()
    opts = routes(client, g, n=1).json()["options"]
    assert opts and all(g["BD"] not in [s["span_id"] for s in o["spans"]] for o in opts)
    assert opts[0]["total_km"] == 8  # next best is A-C-D
