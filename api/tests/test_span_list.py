"""Span list upload. Fixtures are tiny workbooks built here; no real data."""
import io

import openpyxl
import pytest
from conftest import alembic_cfg
from sqlalchemy import text
from test_auth import login, mkuser

from alembic import command

URL = "/api/admin/span-list"
HEAD = ["Link", "Site A", "Route", "Section", "Type", "Distance", "lat"]


def workbook(rows, head=HEAD, tab="Spans", offset=0, pad=0):
    wb = openpyxl.Workbook()
    wb.active.title = "Cover"
    wb.active.append(["nothing here"])
    ws = wb.create_sheet(tab)
    for _ in range(offset):
        ws.append(["title"])
    ws.append([None] * pad + list(head))
    for r in rows:
        ws.append([None] * pad + list(r))
    out = io.BytesIO()
    wb.save(out)
    return out.getvalue()


def row(link, dist=10.5, a=None, route="R1", section="S1", typ="Trunk"):
    return [link, a, route, section, typ, dist, 1.0]


@pytest.fixture
def admin(client, db):
    uid = mkuser(db, "boss", "admin")
    assert login(client, "boss").status_code == 200
    return uid


@pytest.fixture
def sites(db):
    for n in ("AAAA", "BBBB", "CCCC", "DDDD"):
        db.execute(text("INSERT INTO sites (name, kind) VALUES (:n, 'site')"), {"n": n})
    db.execute(text("INSERT INTO sites (name, kind, active) VALUES ('OFFF', 'site', false)"))


def post(client, data, name="sl.xlsx"):
    return client.post(f"{URL}/uploads", files={"file": (name, data, "application/octet-stream")})


def rows(client, uid, group, **q):
    return client.get(f"{URL}/uploads/{uid}/rows", params={"group": group, **q}).json()


def apply(client, uid):
    return client.post(f"{URL}/uploads/{uid}/apply")


def span(db, a, b):
    return db.execute(text("SELECT s.* FROM spans s JOIN sites x ON x.id = s.site_a_id JOIN sites y ON y.id = s.site_b_id "
                           "WHERE x.name = :a AND y.name = :b"), {"a": a, "b": b}).mappings().first()


def seed_span(db, a, b, dist="5.000", typ=None, route=None, section=None):
    return db.execute(text("INSERT INTO spans (site_a_id, site_b_id, distance_km, route_type, route, section) "
                           "SELECT x.id, y.id, :d, :t, :r, :s FROM sites x, sites y WHERE x.name = :a AND y.name = :b RETURNING id"),
                      {"a": a, "b": b, "d": dist, "t": typ, "r": route, "s": section}).scalar_one()


def problems(client, uid):
    return {i["row_number"]: i["reason"] for i in rows(client, uid, "problem")["items"]}


def test_happy_path_new_changed_unchanged_and_apply(client, admin, sites, db):
    seed_span(db, "BBBB", "CCCC", "5.000", "Metro", "R9", "S9")
    seed_span(db, "CCCC", "DDDD", "7.000", "Trunk", "R1", "S1")
    r = post(client, workbook([row("AAAA-BBBB"), row("BBBB-CCCC", 6), row("CCCC-DDDD", 7), row("AAAA-ZZZZ")]))
    assert r.status_code == 201
    j = r.json()
    assert j["found"] and j["sheet_name"] == "Spans" and j["counts"] == {"rows": 4, "new": 1, "changed": 1, "unchanged": 1, "problem": 1}
    ch = rows(client, j["upload_id"], "changed")["items"][0]
    assert {(c["field"], c["old"], c["new"]) for c in ch["changes"]} == {
        ("distance_km", "5.000", "6.000"), ("route_type", "Metro", "Trunk"), ("route", "R9", "R1"), ("section", "S9", "S1")}
    assert ch["parsed"]["site_a"] == "BBBB" and ch["raw"]["lat"] == 1.0  # ignored column stays in the raw row
    assert problems(client, j["upload_id"]) == {5: "site ZZZZ is not in the dashboard"}
    assert span(db, "AAAA", "BBBB") is None  # staging writes no span
    res = apply(client, j["upload_id"])
    assert res.status_code == 200
    assert res.json() == {"upload_id": j["upload_id"], "created": 1, "changed": 1, "protected_kept": 0, "skipped": 1, "warnings": []}
    new = span(db, "AAAA", "BBBB")
    assert (str(new["distance_km"]), new["route_type"], new["route"], new["section"]) == ("10.500", "Trunk", "R1", "S1")
    assert new["survey_cores"] is None and new["region"] is None and new["cable_size"] == 144
    assert db.execute(text("SELECT count(*) FROM cores WHERE span_id = :i"), {"i": new["id"]}).scalar_one() == 0
    assert str(span(db, "BBBB", "CCCC")["distance_km"]) == "6.000"
    assert db.execute(text("SELECT status FROM uploads WHERE id = :i"), {"i": j["upload_id"]}).scalar_one() == "confirmed"


def test_history_rows_written(client, admin, sites, db):
    sid = seed_span(db, "AAAA", "BBBB", "5.000", "Metro")
    uid = post(client, workbook([row("AAAA-BBBB", 6, typ="Trunk")]), "my.xlsx").json()["upload_id"]
    apply(client, uid)
    h = db.execute(text("SELECT field, old_value, new_value, reason, user_id FROM data_edits WHERE entity = 'span' AND entity_id = :i "
                        "ORDER BY field"), {"i": sid}).all()
    assert [(x[0], x[1], x[2]) for x in h] == [("distance_km", "5.000", "6.000"), ("route", None, "R1"), ("route_type", "Metro", "Trunk"),
                                                ("section", None, "S1")]
    assert all(x[3] == f"span list upload my.xlsx #{uid}" and x[4] == admin for x in h)


def test_header_below_row_one_away_from_column_a_other_sheet_name_and_aliases(client, admin, sites):
    head = ["SiteA", "Links", "Segment", "Route type", "KM"]
    data = workbook([["AAAA", "AAAA-BBBB", "Seg", "metro", "3.5"]], head=head, tab="zz", offset=12, pad=3)
    j = post(client, data).json()
    assert j["found"] and j["sheet_name"] == "zz" and j["counts"]["new"] == 1
    p = rows(client, j["upload_id"], "new")["items"][0]["parsed"]
    assert (p["section"], p["type"], p["distance_km"], p["route"]) == ("Seg", "Metro", "3.500", None)
    j = post(client, workbook([["AAAA-BBBB", 2]], head=["Link", "Distance (km)"])).json()
    assert j["counts"]["new"] == 1


def test_no_sheet_blocks_with_reason_and_cannot_apply(client, admin, sites):
    j = post(client, workbook([["AAAA-BBBB"]], head=["Link", "Notes"])).json()
    assert not j["found"] and "Link, Distance" in j["block_reason"] and j["counts"]["rows"] == 0
    assert apply(client, j["upload_id"]).status_code == 409


def test_row_rules(client, admin, sites):
    data = workbook([
        row("AAAA-BBBB", a="CCCC"), row("AAAA-CCCC", "abc"), row("AAAA-DDDD", -1), row("BBBB-CCCC", "1,5"),
        row("BBBB-DDDD", typ="Fibre"), row("AAAA AAAA"), row("AAAA-AAAA"), row("AAAA-OFFF"), row("AAAA"), row(None),
        row("CCCC-DDDD", a="CCCC"), row("DDDD-CCCC")])
    uid = post(client, data).json()["upload_id"]
    p = problems(client, uid)
    assert 2 not in p  # Site A is not checked, so a different Site A is fine
    assert p[3] == p[4] == p[5] == "distance is not a number"
    assert p[6] == "type must be Trunk or Metro"
    assert all("Link" in p[n] for n in (7, 8, 10, 11))
    assert p[9] == "site OFFF is not active in the dashboard"
    assert p[12] == p[13] == "duplicate link in file (rows 12, 13)"


def test_duplicate_pair_does_not_block_others(client, admin, sites, db):
    uid = post(client, workbook([row("AAAA-BBBB"), row("BBBB-AAAA"), row("CCCC-DDDD")])).json()["upload_id"]
    assert problems(client, uid) == {2: "duplicate link in file (rows 2, 3)", 3: "duplicate link in file (rows 2, 3)"}
    assert apply(client, uid).json()["created"] == 1
    assert span(db, "CCCC", "DDDD") and span(db, "AAAA", "BBBB") is None


def test_blank_cells_never_clear(client, admin, sites, db):
    seed_span(db, "AAAA", "BBBB", "5.000", "Metro", "R9", "S9")
    data = workbook([["AAAA-BBBB", None, None, "", None, None, None]])
    j = post(client, data).json()
    assert j["counts"]["unchanged"] == 1
    assert apply(client, j["upload_id"]).json()["changed"] == 0
    s = span(db, "AAAA", "BBBB")
    assert (str(s["distance_km"]), s["route_type"], s["route"], s["section"]) == ("5.000", "Metro", "R9", "S9")


def test_protected_field_kept(client, admin, sites, db):
    sid = seed_span(db, "AAAA", "BBBB", "5.000", "Metro")
    db.execute(text("INSERT INTO data_edits (entity, entity_id, field, old_value, new_value, reason, user_id) "
                    "VALUES ('span', :i, 'distance_km', '4', '5', 'surveyed', :u)"), {"i": sid, "u": admin})
    uid = post(client, workbook([row("AAAA-BBBB", 9)])).json()["upload_id"]
    it = rows(client, uid, "changed")["items"][0]
    d = next(c for c in it["changes"] if c["field"] == "distance_km")
    assert d["protected"] and d["note"] == "edited in dashboard, file differs" and it["edited_in_dashboard"]
    res = apply(client, uid).json()
    assert res["protected_kept"] == 1 and res["changed"] == 1
    s = span(db, "AAAA", "BBBB")
    assert str(s["distance_km"]) == "5.000" and s["route_type"] == "Trunk" and s["route"] == "R1"


def test_reverse_order_matches_and_keeps_site_order(client, admin, sites, db):
    seed_span(db, "AAAA", "BBBB", "5.000")
    uid = post(client, workbook([row("BBBB-AAAA", 8)])).json()["upload_id"]
    assert rows(client, uid, "changed")["total"] == 1
    apply(client, uid)
    assert span(db, "BBBB", "AAAA") is None and str(span(db, "AAAA", "BBBB")["distance_km"]) == "8.000"
    assert db.execute(text("SELECT count(*) FROM spans")).scalar_one() == 1


def test_idempotent_reupload_and_site_added_later(client, admin, sites, db):
    data = workbook([row("AAAA-BBBB"), row("AAAA-NEWW")])
    uid = post(client, data).json()["upload_id"]
    assert apply(client, uid).json()["created"] == 1
    j = post(client, data).json()
    assert j["counts"] == {"rows": 2, "new": 0, "changed": 0, "unchanged": 1, "problem": 1}
    db.execute(text("INSERT INTO sites (name, kind) VALUES ('NEWW', 'site')"))
    j = post(client, data).json()
    assert j["counts"]["new"] == 1 and j["counts"]["unchanged"] == 1
    assert apply(client, j["upload_id"]).json()["created"] == 1
    assert post(client, data).json()["counts"]["unchanged"] == 2


def test_planner_forbidden_apply_twice_and_bad_file(client, db, admin, sites):
    uid = post(client, workbook([row("AAAA-BBBB")])).json()["upload_id"]
    assert apply(client, uid).status_code == 200
    assert apply(client, uid).status_code == 409
    assert client.post(f"{URL}/uploads", files={"file": ("x.csv", b"a", "text/csv")}).status_code == 422
    client.post("/api/auth/logout")
    mkuser(db, "plan", "planner")
    assert login(client, "plan").status_code == 200
    assert post(client, workbook([row("AAAA-BBBB")])).status_code == 403
    assert apply(client, uid).status_code == 403
    assert client.get(f"{URL}/uploads/{uid}/rows", params={"group": "new"}).status_code == 403


def test_span_api_shows_route_section_and_route_filter(client, admin, sites, db):
    seed_span(db, "AAAA", "BBBB", route="Rx", section="Sx")
    seed_span(db, "CCCC", "DDDD", route="Ry")
    got = client.get("/api/spans", params={"route": "rX"}).json()
    assert len(got) == 1 and got[0]["route"] == "Rx" and got[0]["section"] == "Sx"
    assert client.get(f"/api/spans/{got[0]['id']}").json()["section"] == "Sx"


def test_migration_0008_roundtrip(engine, db):
    cfg = alembic_cfg()
    command.downgrade(cfg, "0007")
    assert not db.execute(text("SELECT 1 FROM information_schema.columns WHERE table_name = 'spans' AND column_name = 'route'")).first()
    command.upgrade(cfg, "head")
    u = db.execute(text("INSERT INTO users (username, display_name, role) VALUES ('u','U','admin') RETURNING id")).scalar_one()
    db.execute(text("INSERT INTO uploads (user_id, filename, kind) VALUES (:u, 'f.xlsx', 'span_list')"), {"u": u})
    db.execute(text("INSERT INTO sites (name, kind) VALUES ('A','site'), ('B','site')"))
    db.execute(text("INSERT INTO spans (site_a_id, site_b_id, route, section) SELECT a.id, b.id, 'r', 's' FROM sites a, sites b "
                    "WHERE a.name = 'A' AND b.name = 'B'"))


def test_bespoke_type_is_no_longer_accepted(client, admin, sites):
    uid = post(client, workbook([row("AAAA-BBBB", typ="Bespoke"), row("BBBB-CCCC", typ="metro")])).json()["upload_id"]
    p = problems(client, uid)
    assert p == {2: "type must be Trunk or Metro"}
