from decimal import Decimal as D

import pytest

from app.loss.service import calculated_loss_db, deviation_pct, warning_level


def test_008_below_calculated_is_green():
    assert warning_level(deviation_pct(D(8), D(10))) == "green"
    assert warning_level(D(-50)) == "green"


@pytest.mark.parametrize("pct,level", [
    ("0", "green"), ("3.0", "green"), ("3.01", "amber"), ("7.0", "amber"), ("7.01", "red"),
    ("10.0", "red"), ("10.01", "off_scale"), ("55", "off_scale"),
])
def test_008_boundaries_belong_to_lower_level(pct, level):
    assert warning_level(D(pct)) == level


def test_008_exact_boundary_from_loss_values():
    assert warning_level(deviation_pct(D("10.3"), D(10))) == "green"  # exactly +3%
    assert warning_level(deviation_pct(D(11), D(10))) == "red"  # exactly +10%


def test_008_missing_distance_gives_no_loss_not_zero():
    assert calculated_loss_db(None) is None
    assert calculated_loss_db(D(10)) == D("3.75")
    assert deviation_pct(D(5), None) is None and deviation_pct(None, D(3)) is None
    assert deviation_pct(D(5), D(0)) is None
    assert warning_level(None) is None


# ---- API ----
def H(u="planner1"):
    return {"X-Dev-User": u}


def one(db, sql, **p):
    from sqlalchemy import text
    return db.execute(text(sql), p).scalar_one()


@pytest.fixture
def segments(db):
    one(db, "INSERT INTO users (username, display_name, role) VALUES ('planner1','p','planner') RETURNING id")
    s = [one(db, "INSERT INTO sites (name, kind) VALUES (:n,'site') RETURNING id", n=n) for n in "ABCD"]
    ids = [one(db, "INSERT INTO segments (site_a_id, site_b_id, region, route_type, distance_km) "
                   "VALUES (:a,:b,:r,'Metro',:d) RETURNING id", a=s[i], b=s[i + 1], r=r, d=d)
           for i, (r, d) in enumerate([("North", 10), ("North", 20), ("South", None)])]
    return ids


def measure(db, segment, loss, at="now()"):
    from sqlalchemy import text
    db.execute(text(f"INSERT INTO measurements (segment_id, loss_db, created_at, test_method, field_team) "
                    f"VALUES (:s,:l,{at},'OTDR','T1')"), {"s": segment, "l": loss})


def test_loss_requires_sign_in(client, segments):
    for url in ("/api/loss/segments", f"/api/loss/segments/{segments[0]}", "/api/loss/coverage", "/api/loss/route?segment_ids=1"):
        assert client.get(url).status_code == 401


def test_latest_measurement_wins_and_statuses(client, db, segments):
    a, b, c = segments
    measure(db, a, 3.75, "now() - interval '2 days'")
    measure(db, a, 4.12, "now() - interval '1 day'")  # 4.12 vs 3.75 = +9.87% -> red
    rows = {r["segment_id"]: r for r in client.get("/api/loss/segments", headers=H()).json()}
    assert rows[a]["measured_db"] == 4.12 and rows[a]["level"] == "red" and rows[a]["deviation_pct"] == 9.9
    assert rows[a]["calculated_db"] == 3.75 and rows[a]["status"] == "measured" and rows[a]["difference_db"] == 0.37
    assert rows[a]["segment_name"] == "A - B" and rows[a]["test_method"] == "OTDR"
    assert rows[b]["status"] == "calculated_only" and rows[b]["calculated_db"] == 6.5 and rows[b]["level"] is None
    assert rows[c]["status"] == "no_distance" and rows[c]["calculated_db"] is None
    d = client.get(f"/api/loss/segments/{a}", headers=H()).json()
    assert [h["loss_db"] for h in d["history"]] == [4.12, 3.75]
    assert client.get("/api/loss/segments/999999", headers=H()).status_code == 404
    assert [r["segment_id"] for r in client.get("/api/loss/segments?region=South", headers=H()).json()] == [c]


def test_latest_is_newest_test_date_not_recorded_time(client, db, segments):
    from sqlalchemy import text
    a = segments[0]
    for loss, day, rec in ((3.3, "2026-10-24", "now() - interval '2 days'"), (3.0, "2026-10-19", "now()")):
        db.execute(text(f"INSERT INTO measurements (segment_id, loss_db, tested_on, created_at, test_method, field_team) "
                        f"VALUES (:s,:l,:d,{rec},'OTDR','T1')"), {"s": a, "l": loss, "d": day})
    rows = {r["segment_id"]: r for r in client.get("/api/loss/segments", headers=H()).json()}
    assert rows[a]["measured_db"] == 3.3 and str(rows[a]["last_test_date"]) == "2026-10-24"
    assert [h["loss_db"] for h in client.get(f"/api/loss/segments/{a}", headers=H()).json()["history"]] == [3.3, 3.0]


def test_coverage_counts(client, db, segments):
    measure(db, segments[0], 3.0)
    cov = client.get("/api/loss/coverage", headers=H()).json()
    assert (cov["measured"], cov["total"]) == (1, 3)
    assert cov["by_region"]["North"] == {"measured": 1, "total": 2}
    assert cov["by_region"]["South"] == {"measured": 0, "total": 1}


def test_route_totals_and_worst_level(client, db, segments):
    a, b, c = segments
    measure(db, a, 3.75)  # green
    url = f"/api/loss/route?segment_ids={b},{a}"
    r = client.get(url, headers=H()).json()
    assert [x["segment_id"] for x in r["segments"]] == [b, a]
    assert r["total_calculated_db"] == 10.25 and r["total_measured_db"] is None and r["level"] == "green"
    measure(db, b, 7.6)  # +16.9% off_scale
    r = client.get(url, headers=H()).json()
    assert r["total_measured_db"] == 11.35 and r["level"] == "off_scale"
    r = client.get(f"/api/loss/route?segment_ids={a},{c}", headers=H()).json()
    assert r["total_calculated_db"] is None  # a segment with no distance never counts as 0
    assert client.get("/api/loss/route?segment_ids=999999", headers=H()).status_code == 404


# ---- loss per core ----
def mk_cores(db, segment, n=2):
    return [one(db, "INSERT INTO cores (segment_id, number) VALUES (:s,:n) RETURNING id", s=segment, n=i + 1) for i in range(n)]


def measure_core(db, segment, core, loss, at="now()"):
    from sqlalchemy import text
    db.execute(text(f"INSERT INTO measurements (segment_id, core_id, loss_db, created_at, test_method, field_team) "
                    f"VALUES (:s,:c,:l,{at},'OTDR','T1')"), {"s": segment, "c": core, "l": loss})


def test_worst_core_wins_and_detail_cores(client, db, segments):
    from sqlalchemy import text
    a = segments[0]  # 10 km -> calculated 3.75
    db.execute(text("UPDATE segments SET survey_cores = 4 WHERE id = :s"), {"s": a})
    c1, c2 = mk_cores(db, a)
    measure_core(db, a, c1, 3.6, "now() - interval '3 days'")  # old, superseded
    measure_core(db, a, c1, 3.75, "now() - interval '1 day'")
    measure_core(db, a, c2, 4.0)  # +6.7% amber, the worst latest
    row = {r["segment_id"]: r for r in client.get("/api/loss/segments", headers=H()).json()}[a]
    assert row["measured_db"] == 4.0 and row["level"] == "amber" and row["worst_core_number"] == 2
    assert row["measured_cores"] == 2 and row["total_cores"] == 4
    d = client.get(f"/api/loss/segments/{a}", headers=H()).json()
    assert [c["core_number"] for c in d["cores"]] == [1, 2]
    assert d["cores"][0]["measured_db"] == 3.75 and [h["loss_db"] for h in d["cores"][0]["history"]] == [3.75, 3.6]
    assert d["cores"][1]["level"] == "amber" and d["cores"][1]["calculated_db"] == 3.75
    assert len(d["history"]) == 3 and d["history"][0]["core_number"] == 2


def test_null_core_measurement_still_works(client, db, segments):
    a = segments[0]
    (c1,) = mk_cores(db, a, 1)
    measure(db, a, 3.0)  # no core
    row = client.get(f"/api/loss/segments/{a}", headers=H()).json()
    assert row["measured_db"] == 3.0 and row["worst_core_number"] is None
    assert row["measured_cores"] == 0 and row["total_cores"] == 0 and row["cores"] == []
    assert row["history"][0]["core_number"] is None
    measure_core(db, a, c1, 3.9)  # worse than the anonymous one
    row = client.get(f"/api/loss/segments/{a}", headers=H()).json()
    assert row["measured_db"] == 3.9 and row["worst_core_number"] == 1 and row["measured_cores"] == 1
    assert client.get(f"/api/loss/route?segment_ids={a}", headers=H()).json()["total_measured_db"] == 3.9


def test_measurement_core_column_and_index(db):
    assert one(db, "SELECT count(*) FROM information_schema.columns WHERE table_name='measurements' AND column_name='core_id'") == 1
    assert one(db, "SELECT count(*) FROM pg_indexes WHERE tablename='measurements' AND indexname='measurements_core_ix'") == 1


def test_calculated_loss_formula():
    from decimal import Decimal
    from app.loss.service import calculated_loss_db
    assert calculated_loss_db(Decimal("32.5")) == Decimal("9.94")
    assert calculated_loss_db(Decimal(0)) == Decimal("1.00")  # connectors only
    assert calculated_loss_db(None) is None
