"""Map GeoJSON (TASK-053, TASK-084)."""
import json

from sqlalchemy import text


def H(u="planner1"):
    return {"X-Dev-User": u}


def one(db, sql, **p):
    return db.execute(text(sql), p).scalar_one()


def site(db, name, kind="site", xy=None, lrd=None, region=None):
    g = "ST_SetSRID(ST_MakePoint(:x, :y), 4326)" if xy else "NULL"
    return one(db, f"INSERT INTO sites (name, kind, geom, lrd_site_id, details) VALUES (:n,:k,{g},:l,CAST(:d AS jsonb)) RETURNING id",
               n=name, k=kind, x=xy[0] if xy else None, y=xy[1] if xy else None, l=lrd,
               d=json.dumps({"region": region} if region else {}))


def span(db, a, b, survey, used=0):
    sid = one(db, "INSERT INTO spans (site_a_id, site_b_id, distance_km, survey_cores, route_type, region) "
                  "VALUES (:a,:b,5,:n,'Metro','Central') RETURNING id", a=a, b=b, n=survey)
    for n in range(1, (survey or 0) + 1):
        db.execute(text("INSERT INTO cores (span_id, number, in_use) VALUES (:s,:n,:u)"), {"s": sid, "n": n, "u": n <= used})
    return sid


def mkuser(db):
    one(db, "INSERT INTO users (username, display_name, role) VALUES ('planner1','p','planner') RETURNING id")


def test_requires_sign_in(client):
    assert client.get("/api/map/spans").status_code == 401
    assert client.get("/api/map/sites").status_code == 401


def test_spans_straight_chips_and_not_drawn(client, db):
    mkuser(db)
    a, b, c, d, e, nogeo = [*(site(db, n, xy=(101 + i, 3)) for i, n in enumerate("ABCDE")), site(db, "Z")]
    ok, low, full, ns = span(db, a, b, 12), span(db, b, c, 12, used=5), span(db, c, d, 3, used=3), span(db, d, e, None)
    lost = span(db, e, nogeo, 4)
    r = client.get("/api/map/spans", headers=H()).json()
    by = {f["properties"]["span_id"]: f for f in r["features"]}
    assert [by[i]["properties"]["chip"] for i in (ok, low, full, ns)] == ["ok", "low", "full", "not_surveyed"]
    assert by[low]["properties"]["free_to_reserve"] == 7 and by[ns]["properties"]["surveyed"] is False
    assert by[ok]["geometry"]["coordinates"] == [[101, 3], [102, 3]] and "shaped" not in by[ok]["properties"]
    assert by[ok]["properties"]["segment_id"] is None
    assert lost not in by and r["not_drawn"] == [{"span_id": lost, "name": "E - Z", "reason": "no valid coordinates for Z"}]


def test_shaped_segment_parts(client, db):
    mkuser(db)
    a, b, c, d = site(db, "A", xy=(101, 3)), site(db, "B", xy=(102, 4)), site(db, "C", xy=(103, 3)), site(db, "D", xy=(104, 3))
    ab, cb, cd = span(db, a, b, 5), span(db, c, b, 5), span(db, c, d, 5)  # C-B stored reversed
    seg = one(db, "INSERT INTO segments (site_a_id, site_b_id, geom) VALUES (:a,:c, ST_GeomFromText("
                  "'LINESTRING(101 3, 101.4 3.8, 102 4, 102.6 3.8, 103 3)', 4326)) RETURNING id", a=a, c=c)
    for i, s in enumerate((ab, cb), 1):
        db.execute(text("INSERT INTO segment_spans (segment_id, span_id, position) VALUES (:g,:s,:p)"), {"g": seg, "s": s, "p": i})
    by = {f["properties"]["span_id"]: f for f in client.get("/api/map/spans", headers=H()).json()["features"]}
    assert by[ab]["geometry"]["coordinates"] == [[101, 3], [101.4, 3.8], [102, 4]]
    assert by[cb]["geometry"]["coordinates"] == [[103, 3], [102.6, 3.8], [102, 4]]  # oriented site A (C) -> site B (B)
    assert by[ab]["properties"]["shaped"] and by[cb]["properties"]["segment_id"] == seg
    assert by[cd]["geometry"]["coordinates"] == [[103, 3], [104, 3]] and "shaped" not in by[cd]["properties"]


def test_sites(client, db):
    mkuser(db)
    lrd = site(db, "LRD1", xy=(101, 3))
    dc_fallback = site(db, "DC fallback", "data_center", lrd=lrd, region="North")
    dc_none = site(db, "DC none", "data_center")
    dc_own = site(db, "DC own", "data_center", xy=(102, 3), lrd=lrd)
    toc = site(db, "TOC", "toc", xy=(103, 3))
    bad = site(db, "Nogeo")
    site(db, "Lonely", xy=(105, 3))  # no span: left out
    for x, y in ((lrd, dc_fallback), (dc_none, dc_own), (toc, bad)):
        span(db, x, y, 2)
    r = client.get("/api/map/sites", headers=H()).json()
    by = {f["properties"]["name"]: f for f in r["features"]}
    assert set(by) == {"LRD1", "DC fallback", "DC own", "TOC"}
    assert by["DC fallback"]["properties"] == {"site_id": dc_fallback, "name": "DC fallback", "kind": "data_center",
                                               "lrd_site_id": lrd, "region": "North", "location_from_site": "LRD1"}
    assert by["DC fallback"]["geometry"]["coordinates"] == [101, 3]
    assert "location_from_site" not in by["DC own"]["properties"] and by["TOC"]["properties"]["kind"] == "toc"
    assert {n["name"] for n in r["not_drawn"]} == {"DC none", "Nogeo"}
