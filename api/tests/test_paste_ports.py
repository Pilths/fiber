"""Paste ports for a segment: preview writes nothing, apply writes ports and history."""
import pytest
from sqlalchemy import text
from test_reservations import H, build, one


@pytest.fixture
def w(db):
    return build(db)


def paste(client, segment_id, user="admin1", **body):
    return client.post(f"/api/admin/segments/{segment_id}/ports", json=body, headers=H(user))


def port_label(db, core_id, end):
    return db.execute(text(
        f"SELECT p.port_id FROM cores c JOIN ports p ON p.id = c.{end}_id WHERE c.id = :c"
    ), {"c": core_id}).scalar()


def statuses(response):
    return [row["status"] for row in response.json()["rows"]]


def test_preview_writes_nothing(client, w, db):
    response = paste(client, w["s1"], port_a=["ODF1-P1", "ODF1-P2"])
    assert response.status_code == 200
    assert response.json()["applied"] is False
    assert statuses(response) == ["new", "new"]
    assert response.json()["counts"] == {"new": 2, "replaces": 0, "unchanged": 0, "problem": 0}
    assert db.execute(text("SELECT count(*) FROM ports")).scalar() == 0
    assert db.execute(text("SELECT count(*) FROM data_edits")).scalar() == 0


def test_apply_sets_ports_and_history(client, w, db):
    response = paste(client, w["s1"], port_a=["ODF1-P1", " odf 1 p 2 "], port_b=["ODF2-P1", "ODF2-P2"], apply=True)
    assert response.json()["applied"] is True
    assert port_label(db, w["c1"][1], "port_a") == "ODF1-P1"
    assert port_label(db, w["c1"][2], "port_a") == "ODF1-P2"
    assert port_label(db, w["c1"][2], "port_b") == "ODF2-P2"
    fields = db.execute(text("SELECT field FROM data_edits WHERE entity = 'core' AND entity_id = :c"),
                        {"c": w["c1"][1]}).scalars().all()
    assert sorted(fields) == ["port_a", "port_b"]
    again = paste(client, w["s1"], port_a=["ODF1-P1", "ODF1-P2"], apply=True)
    assert statuses(again) == ["unchanged", "unchanged"]
    changed = paste(client, w["s1"], port_a=["ODF1-P9"])
    assert statuses(changed) == ["replaces"]


def test_empty_line_skips_and_start_core_offsets(client, w, db):
    paste(client, w["s1"], port_a=["ODF1-P1", "ODF1-P2", "ODF1-P3"], apply=True)
    response = paste(client, w["s1"], start_core=2, port_a=["", "ODF1-P5"], apply=True)
    assert [row["core_number"] for row in response.json()["rows"]] == [3]
    assert port_label(db, w["c1"][2], "port_a") == "ODF1-P2"
    assert port_label(db, w["c1"][3], "port_a") == "ODF1-P5"


def test_duplicate_in_paste_is_problem(client, w, db):
    response = paste(client, w["s1"], port_a=["ODF1-P1", "ODF1-P1", "ODF1-P3"], apply=True)
    assert statuses(response) == ["problem", "problem", "new"]
    assert port_label(db, w["c1"][1], "port_a") is None
    assert port_label(db, w["c1"][3], "port_a") == "ODF1-P3"


def test_label_on_another_core_is_problem_unless_moved_away(client, w, db):
    paste(client, w["s1"], port_a=["ODF1-P1"], apply=True)
    blocked = paste(client, w["s1"], start_core=2, port_a=["ODF1-P1"])
    assert statuses(blocked) == ["problem"]
    assert "ODF1-P1 is on core 1 of" in blocked.json()["rows"][0]["problem"]
    moved = paste(client, w["s1"], port_a=["ODF1-P2", "ODF1-P1"], apply=True)
    assert statuses(moved) == ["replaces", "new"]
    assert port_label(db, w["c1"][2], "port_a") == "ODF1-P1"


def test_core_above_verified_count_is_problem(client, w):
    response = paste(client, w["s2"], start_core=4, port_a=["ODF1-P4", "ODF1-P5"], apply=True)
    assert statuses(response) == ["new", "problem"]
    assert "verified" in response.json()["rows"][1]["problem"]


def test_segment_without_verified_count_is_problem(client, w):
    response = paste(client, w["s3"], port_a=["ODF1-P1"])
    assert statuses(response) == ["problem"]
    assert "Core verification count not set" in response.json()["rows"][0]["problem"]


def test_needs_a_list_and_limit(client, w):
    assert paste(client, w["s1"]).status_code == 422
    assert paste(client, w["s1"], port_a=["ODF1-P1"] * 2001).status_code == 422


def test_planner_forbidden(client, w):
    assert paste(client, w["s1"], user="planner1", port_a=["ODF1-P1"]).status_code == 403


def test_lenient_text_is_saved_in_one_canonical_form(client, w, db):
    cell = "FDF 01\nMod 2\nT3\nP5"  # a multi-line Excel cell, joined by the dialog
    response = paste(client, w["s1"], port_a=[cell, "fdf1/m2/tray3/port6"], apply=True)
    assert statuses(response) == ["new", "new"]
    assert port_label(db, w["c1"][1], "port_a") == "FDF1-MOD2-T3-P5"
    assert port_label(db, w["c1"][2], "port_a") == "FDF1-MOD2-T3-P6"


def test_text_that_is_not_a_port_label_is_problem(client, w, db):
    response = paste(client, w["s1"], port_a=["A Tray 1 P1", "FDF1-M2-T3", "ODF1"], apply=True)
    assert statuses(response) == ["problem", "problem", "problem"]
    assert "Use FDF1-MOD2-T3-P5 or ODF1-P5" in response.json()["rows"][0]["problem"]
    assert db.execute(text("SELECT count(*) FROM ports")).scalar() == 0


def test_same_port_written_two_ways_is_a_duplicate(client, w):
    response = paste(client, w["s1"], port_a=["FDF1-MOD1-T1-P1", "fdf01 m1 t1 p1"])
    assert statuses(response) == ["problem", "problem"]


def test_parts_may_be_letters(client, w, db):
    response = paste(client, w["s1"], port_a=["FDF-a-modb-tc-p12", "odf b p 7"], apply=True)
    assert statuses(response) == ["new", "new"]
    assert port_label(db, w["c1"][1], "port_a") == "FDFA-MODB-TC-P12"
    assert port_label(db, w["c1"][2], "port_a") == "ODFB-P7"
