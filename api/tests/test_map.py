"""Map GeoJSON (TASK-053, TASK-084)."""
import json

from sqlalchemy import text


def H(u="planner1"):
    return {"X-Dev-User": u}


def one(db, sql, **p):
    return db.execute(text(sql), p).scalar_one()


def site(db, name, kind="site", xy=None, lrd=None, region=None):
    g = "ST_SetSRID(ST_MakePoint(:x, :y), 4326)" if xy else "NULL"
    return one(
        db,
        f"INSERT INTO sites (name, kind, geom, lrd_site_id, details) "
        f"VALUES (:n,:k,{g},:l,CAST(:d AS jsonb)) RETURNING id",
        n=name,
        k=kind,
        x=xy[0] if xy else None,
        y=xy[1] if xy else None,
        l=lrd,
        d=json.dumps({k: v for k, v in (("region", region),) if v}),
    )


def segment(db, a, b, survey, used=0):
    sid = one(db, "INSERT INTO segments (site_a_id, site_b_id, distance_km, survey_cores, region) "
                  "VALUES (:a,:b,5,:n,'Central') RETURNING id", a=a, b=b, n=survey)
    for n in range(1, (survey or 0) + 1):
        db.execute(
            text("INSERT INTO cores (segment_id, number, in_use) VALUES (:s,:n,:u)"), {"s": sid, "n": n, "u": n <= used}
        )
    return sid


def mkuser(db):
    one(db, "INSERT INTO users (username, display_name, role) VALUES ('planner1','p','planner') RETURNING id")


def test_requires_sign_in(client):
    assert client.get("/api/map/segments").status_code == 401
    assert client.get("/api/map/sites").status_code == 401


def test_segments_straight_chips_and_not_drawn(client, db):
    mkuser(db)
    a, b, c, d, e, nogeo = [*(site(db, n, xy=(101 + i, 3)) for i, n in enumerate("ABCDE")), site(db, "Z")]
    ok, low, full, ns = (
        segment(db, a, b, 12),
        segment(db, b, c, 12, used=5),
        segment(db, c, d, 3, used=3),
        segment(db, d, e, None),
    )
    lost = segment(db, e, nogeo, 4)
    r = client.get("/api/map/segments", headers=H()).json()
    by = {f["properties"]["segment_id"]: f for f in r["features"]}
    assert [by[i]["properties"]["health"] for i in (ok, low, full, ns)] == ["free", "free", "full", "not_verified"]
    assert by[low]["properties"]["free_to_reserve"] == 7 and by[ns]["properties"]["surveyed"] is False
    assert by[ok]["geometry"]["coordinates"] == [[101, 3], [102, 3]] and "shaped" not in by[ok]["properties"]
    assert by[ok]["properties"]["route_id"] is None
    assert lost not in by
    assert r["not_drawn"] == [{"segment_id": lost, "name": "E - Z", "reason": "no valid coordinates for Z"}]


def test_shaped_route_parts(client, db):
    mkuser(db)
    a, b, c, d = (
        site(db, "A", xy=(101, 3)),
        site(db, "B", xy=(102, 4)),
        site(db, "C", xy=(103, 3)),
        site(db, "D", xy=(104, 3)),
    )
    ab, cb, cd = segment(db, a, b, 5), segment(db, c, b, 5), segment(db, c, d, 5)  # C-B stored reversed
    seg = one(db, "INSERT INTO routes (site_a_id, site_b_id, geom) VALUES (:a,:c, ST_GeomFromText("
                  "'LINESTRING(101 3, 101.4 3.8, 102 4, 102.6 3.8, 103 3)', 4326)) RETURNING id", a=a, c=c)
    for i, s in enumerate((ab, cb), 1):
        db.execute(
            text("INSERT INTO route_segments (route_id, segment_id, position) VALUES (:g,:s,:p)"),
            {"g": seg, "s": s, "p": i},
        )
    by = {f["properties"]["segment_id"]: f for f in client.get("/api/map/segments", headers=H()).json()["features"]}
    assert by[ab]["geometry"]["coordinates"] == [[101, 3], [101.4, 3.8], [102, 4]]
    assert by[cb]["geometry"]["coordinates"] == [[103, 3], [102.6, 3.8], [102, 4]]  # oriented site A (C) -> site B (B)
    assert by[ab]["properties"]["shaped"] and by[cb]["properties"]["route_id"] == seg
    assert by[cd]["geometry"]["coordinates"] == [[103, 3], [104, 3]] and "shaped" not in by[cd]["properties"]


def test_sites(client, db):
    mkuser(db)
    lrd = site(db, "LRD1", xy=(101, 3))
    dc_fallback = site(db, "DC fallback", "data_center", lrd=lrd, region="North")
    dc_none = site(db, "DC none", "data_center")
    dc_own = site(db, "DC own", "data_center", xy=(102, 3), lrd=lrd)
    toc = site(db, "TOC", "toc", xy=(103, 3))
    bad = site(db, "Nogeo")
    site(db, "Lonely", xy=(105, 3))  # no segment: still drawn
    site(db, "Lonely nogeo")  # no segment, no point: not listed as not drawn
    for x, y in ((lrd, dc_fallback), (dc_none, dc_own), (toc, bad)):
        segment(db, x, y, 2)
    r = client.get("/api/map/sites", headers=H()).json()
    by = {f["properties"]["name"]: f for f in r["features"]}
    assert set(by) == {"LRD1", "DC fallback", "DC own", "TOC", "Lonely"}
    assert by["DC fallback"]["properties"] == {"site_id": dc_fallback, "name": "DC fallback", "kind": "data_center",
                                               "lrd_site_id": lrd, "region": "North",
                                               "location_from_site": "LRD1"}
    assert by["DC fallback"]["geometry"]["coordinates"] == [101, 3]
    assert "location_from_site" not in by["DC own"]["properties"] and by["TOC"]["properties"]["kind"] == "toc"
    assert {n["name"] for n in r["not_drawn"]} == {"DC none", "Nogeo"}


def test_segments_expose_fiber_cut_as_full(client, db):
    mkuser(db)
    a, b, c = (site(db, n, xy=(101 + i, 3)) for i, n in enumerate("ABC"))
    ok, cut = segment(db, a, b, 12), segment(db, b, c, 12)
    db.execute(text("UPDATE segments SET fiber_cut = true WHERE id = :s"), {"s": cut})
    by = {
        f["properties"]["segment_id"]: f["properties"]
        for f in client.get("/api/map/segments", headers=H()).json()["features"]
    }
    assert (by[ok]["fiber_cut"], by[ok]["health"]) == (False, "free")
    assert (by[cut]["fiber_cut"], by[cut]["health"], by[cut]["free_to_reserve"]) == (True, "cut", 0)


def test_segment_kmz_download(client, db):
    import io
    import zipfile

    mkuser(db)
    a = site(db, "EJH1", xy=(101.60, 3.10))
    b = site(db, "RINI", xy=(101.70, 3.20))
    sid = segment(db, a, b, 4)
    response = client.get(f"/api/map/segments/{sid}/kmz", headers=H())
    assert response.status_code == 200
    assert response.headers["content-type"] == "application/vnd.google-earth.kmz"
    assert 'filename="EJH1 - RINI.kmz"' in response.headers["content-disposition"]
    kml = zipfile.ZipFile(io.BytesIO(response.content)).read("doc.kml").decode()
    assert "<name>EJH1 - RINI</name>" in kml
    assert "101.6,3.1,0 101.7,3.2,0" in kml
    assert client.get("/api/map/segments/999999/kmz", headers=H()).status_code == 404


def test_segment_kmz_without_coordinates_is_404(client, db):
    mkuser(db)
    a = site(db, "EJH1", xy=(101.60, 3.10))
    b = site(db, "RINI")
    sid = segment(db, a, b, 4)
    assert client.get(f"/api/map/segments/{sid}/kmz", headers=H()).status_code == 404


def kmz_group(db, name, target, target_id, hidden=False, colour_mode="theme"):
    user = "(SELECT id FROM users WHERE username = 'planner1')"
    upload = one(db, f"INSERT INTO uploads (user_id, filename, kind) VALUES ({user}, 'x.kmz', 'kmz') RETURNING id")
    hidden_at = "now()" if hidden else "NULL"
    return one(
        db,
        f"INSERT INTO kmz_groups (upload_id, name, folder_path, {target}_id, colour_mode, hidden_at, created_by) "
        f"VALUES (:u, :n, :n, :t, :m, {hidden_at}, {user}) RETURNING id",
        u=upload, n=name, t=target_id, m=colour_mode,
    )


def kmz_element(db, group_id, name, kind, wkt, style="{}"):
    return one(
        db,
        "INSERT INTO kmz_elements (group_id, name, kind, geom, kmz_style) "
        "VALUES (:g, :n, :k, ST_GeomFromText(:w, 4326), CAST(:s AS jsonb)) RETURNING id",
        g=group_id, n=name, k=kind, w=wkt, s=style,
    )


def test_kmz_elements(client, db):
    mkuser(db)
    assert client.get("/api/map/kmz-elements").status_code == 401
    site_id = site(db, "Hut", xy=(101.5, 3.0))
    cluster_id = one(db, "INSERT INTO clusters (name, created_by) VALUES ('Alpha', "
                         "(SELECT id FROM users WHERE username = 'planner1')) RETURNING id")
    cluster_group = kmz_group(db, "Boundary", "cluster", cluster_id, colour_mode="kmz")
    area = kmz_element(db, cluster_group, "Area", "area", "POLYGON((101 3, 101.2 3, 101.2 3.2, 101 3.2, 101 3))",
                       '{"fill_colour": "#ff0000", "fill_opacity": 0.3}')
    site_group = kmz_group(db, "Compound", "site", site_id)
    point = kmz_element(db, site_group, "Gate", "point", "POINT(101.5 3.0)")
    hidden_group = kmz_group(db, "Old", "site", site_id, hidden=True)
    kmz_element(db, hidden_group, "Gone", "line", "LINESTRING(101 3, 102 3)")

    body = client.get("/api/map/kmz-elements", headers=H()).json()
    assert body["type"] == "FeatureCollection"
    features = {feature["properties"]["element_id"]: feature for feature in body["features"]}
    assert set(features) == {area, point}
    area_props = features[area]["properties"]
    assert area_props["target"] == "cluster"
    assert area_props["cluster_name"] == "Alpha"
    assert area_props["colour_mode"] == "kmz"
    assert area_props["kmz_style"] == {"fill_colour": "#ff0000", "fill_opacity": 0.3}
    assert area_props["group_name"] == "Boundary"
    assert features[area]["geometry"]["type"] == "Polygon"
    label_x, label_y = area_props["label_point"]
    assert 101 <= label_x <= 101.2 and 3 <= label_y <= 3.2
    point_props = features[point]["properties"]
    assert point_props["target"] == "site"
    assert point_props["cluster_name"] is None
    assert point_props["label_point"] is None
    assert features[point]["geometry"] == {"type": "Point", "coordinates": [101.5, 3.0]}
