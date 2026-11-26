"""Admin site and segment lists, create site and segment, kind/route/section edits."""
import pytest
from sqlalchemy import text
from test_admin_edits import edits, post
from test_reservations import H, build, one


@pytest.fixture
def w(db):
    return build(db)


def add_kmz_group(db, w, segment_id, hidden):
    upload = one(
        db,
        "INSERT INTO uploads (kind, filename, status, user_id) VALUES ('kmz', 'x.kmz', 'confirmed', :u) RETURNING id",
        u=w["admin1"],
    )
    hidden_at = "now()" if hidden else "NULL"
    group = one(
        db,
        "INSERT INTO kmz_groups (upload_id, name, folder_path, segment_id, route, hidden_at, created_by) "
        f"VALUES (:up, 'g', 'g', :s, true, {hidden_at}, :u) RETURNING id",
        up=upload, s=segment_id, u=w["admin1"],
    )
    db.execute(
        text(
            "INSERT INTO kmz_elements (group_id, kind, geom) "
            "VALUES (:g, 'line', ST_GeomFromText('LINESTRING(101 3, 102 4)', 4326))"
        ),
        {"g": group},
    )


def test_site_list(client, w, db):
    db.execute(text("UPDATE sites SET geom = ST_SetSRID(ST_MakePoint(101, 3), 4326) WHERE name = 'A'"))
    rows = client.get("/api/admin/sites/list", headers=H("admin1")).json()
    by_name = {row["name"]: row for row in rows}
    assert by_name["A"]["lat"] == 3 and by_name["A"]["lon"] == 101
    assert by_name["B"]["lat"] is None
    assert by_name["B"]["segment_count"] == 2
    assert by_name["A"]["segment_count"] == 1
    assert client.get("/api/admin/sites/list", headers=H("planner1")).status_code == 403


def test_segment_list(client, w, db):
    db.execute(text("UPDATE sites SET kind = 'data_center' WHERE name IN ('A', 'B')"))
    add_kmz_group(db, w, w["s1"], hidden=False)
    add_kmz_group(db, w, w["s2"], hidden=True)
    rows = client.get("/api/admin/segments/list", headers=H("admin1")).json()
    by_id = {row["id"]: row for row in rows}
    assert by_id[w["s1"]]["route_type"] == "DC-DC"
    assert by_id[w["s1"]]["kmz_route_count"] == 1
    assert by_id[w["s2"]]["kmz_route_count"] == 0
    assert by_id[w["s3"]]["survey_cores"] is None
    assert by_id[w["s1"]]["site_a"] == "A"


def test_create_site(client, w, db):
    response = post(client, "sites", name="  New  Site ", kind="toc", lat=3.1, lon=101.5, remarks="r")
    assert response.status_code == 200
    site_id = response.json()["id"]
    assert one(db, "SELECT name FROM sites WHERE id = :i", i=site_id) == "New Site"
    assert edits(db, "site", site_id) == [("created", None, "New Site", "r")]
    assert one(db, "SELECT upload_id IS NULL FROM data_edits WHERE entity = 'site' AND entity_id = :i", i=site_id)
    assert post(client, "sites", name="New Site", kind="toc").status_code == 409
    assert post(client, "sites", name="A-B", kind="toc").status_code == 422
    assert post(client, "sites", name="Q", kind="nope").status_code == 422
    assert post(client, "sites", name="Q", kind="toc", lat=3).status_code == 422


def test_create_segment(client, w, db):
    a, b, c = (one(db, "SELECT id FROM sites WHERE name = :n", n=n) for n in "ABC")
    response = post(client, "segments", site_a_id=a, site_b_id=c, distance_km="12.5", route="R1", remarks="r")
    assert response.status_code == 200
    segment_id = response.json()["id"]
    assert one(db, "SELECT cable_size FROM segments WHERE id = :i", i=segment_id) == 144
    assert one(db, "SELECT survey_cores IS NULL FROM segments WHERE id = :i", i=segment_id)
    assert len(edits(db, "segment", segment_id)) == 1
    assert post(client, "segments", site_a_id=a, site_b_id=a, distance_km="1").status_code == 422
    assert post(client, "segments", site_a_id=a, site_b_id=b, distance_km="1").status_code == 409
    assert post(client, "segments", site_a_id=b, site_b_id=a, distance_km="1").status_code == 409
    assert post(client, "segments", site_a_id=a, site_b_id=999999, distance_km="1").status_code == 404


def test_edit_kind_route_section(client, w, db):
    site_id = one(db, "SELECT id FROM sites WHERE name = 'A'")
    assert post(client, f"sites/{site_id}", kind="toc").status_code == 200
    assert post(client, f"sites/{site_id}", kind="bogus").status_code == 422
    assert edits(db, "site", site_id)[0][:3] == ("kind", "site", "toc")
    s = w["s1"]
    assert post(client, f"segments/{s}", route="R1", section="S2").status_code == 200
    assert post(client, f"segments/{s}", route="  ").status_code == 200
    assert one(db, "SELECT route IS NULL FROM segments WHERE id = :i", i=s)
    fields = [e[0] for e in edits(db, "segment", s)]
    assert fields == ["route", "section", "route"]
