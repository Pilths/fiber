from datetime import date, timedelta

import pytest
from sqlalchemy import text


def H(user):
    return {"X-Dev-User": user}


def one(db, sql, **params):
    return db.execute(text(sql), params).scalar_one()


@pytest.fixture
def world(db):
    admin = one(db, "INSERT INTO users (username, display_name, role) VALUES ('admin1','a','admin') RETURNING id")
    one(db, "INSERT INTO users (username, display_name, role) VALUES ('planner1','p','planner') RETURNING id")
    site_a = one(db, "INSERT INTO sites (name, kind) VALUES ('A','site') RETURNING id")
    site_b = one(db, "INSERT INTO sites (name, kind) VALUES ('B','site') RETURNING id")
    segment = one(db, "INSERT INTO segments (site_a_id, site_b_id, distance_km, survey_cores) "
                      "VALUES (:a,:b,10,2) RETURNING id", a=site_a, b=site_b)
    cores = [one(db, "INSERT INTO cores (segment_id, number) VALUES (:s,:n) RETURNING id", s=segment, n=n)
             for n in (1, 2, 3)]
    return {"admin": admin, "segment": segment, "cores": cores}


def add(client, core_id, user="admin1", **body):
    body.setdefault("loss_db", "4.0")
    body.setdefault("tested_on", date.today().isoformat())
    return client.post(f"/api/admin/cores/{core_id}/measurements", json=body, headers=H(user))


def test_admin_adds_tests_and_latest_wins(client, db, world):
    core = world["cores"][0]
    first = add(client, core, loss_db="3.9", tested_on=(date.today() - timedelta(days=2)).isoformat(),
                test_method="  OTDR ", field_team=" ")
    assert first.status_code == 200
    assert first.json()["measured_db"] == 3.9 and first.json()["test_method"] == "OTDR"
    assert first.json()["field_team"] is None
    second = add(client, core, loss_db="4.0")  # 10 km -> calculated 3.75, +6.7%
    assert second.json()["measured_db"] == 4.0 and second.json()["level"] == "amber"
    assert [h["loss_db"] for h in second.json()["history"]] == [4.0, 3.9]
    stored = one(db, "SELECT count(*) FROM measurements WHERE core_id = :c AND created_by = :u",
                 c=core, u=world["admin"])
    assert stored == 2


def test_validation_and_errors(client, world):
    core = world["cores"][0]
    tomorrow = (date.today() + timedelta(days=2)).isoformat()
    assert add(client, core, tested_on=tomorrow).status_code == 422
    assert add(client, core, loss_db="0").status_code == 422
    assert add(client, core, loss_db="101").status_code == 422
    assert add(client, 999999).status_code == 404
    assert add(client, world["cores"][2]).status_code == 409  # core 3 is above the 2 surveyed cores
    assert add(client, core, user="planner1").status_code == 403
