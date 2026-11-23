"""Segment list upload: Verified cores and Total cores columns."""
from sqlalchemy import text
from test_auth import login, mkuser  # noqa: F401  (admin fixture below uses them through test_segment_list)
from test_segment_list import admin, apply, post, problems, rows, seed_segment, segment, sites, workbook  # noqa: F401

HEAD = ["Link", "Distance", "Verified cores", "Total cores"]


def core_count(db, segment_id):
    return db.execute(text("SELECT count(*) FROM cores WHERE segment_id = :i"), {"i": segment_id}).scalar_one()


def test_verified_cores_added_to_segment_with_none(client, admin, sites, db):
    seed_segment(db, "AAAA", "BBBB")
    data = workbook([["AAAA-BBBB", None, 12, 48], ["BBBB-CCCC", 3, 4, None]], head=HEAD)
    uid = post(client, data).json()["upload_id"]
    assert apply(client, uid).json()["blocked"] == 0
    old = segment(db, "AAAA", "BBBB")
    assert (old["survey_cores"], old["cable_size"], core_count(db, old["id"])) == (12, 48, 12)
    new = segment(db, "BBBB", "CCCC")
    assert (new["survey_cores"], new["cable_size"], core_count(db, new["id"])) == (4, 144, 4)


def test_dashboard_edited_verified_cores_kept(client, admin, sites, db):
    sid = seed_segment(db, "AAAA", "BBBB")
    db.execute(text("UPDATE segments SET survey_cores = 6 WHERE id = :i"), {"i": sid})
    db.execute(text("INSERT INTO data_edits (entity, entity_id, field, old_value, new_value, user_id) "
                    "VALUES ('segment', :i, 'survey_cores', NULL, '6', :u)"), {"i": sid, "u": admin})
    uid = post(client, workbook([["AAAA-BBBB", None, 20, None]], head=HEAD)).json()["upload_id"]
    assert apply(client, uid).json()["protected_kept"] == 1
    assert segment(db, "AAAA", "BBBB")["survey_cores"] == 6


def test_lowering_below_existing_cores_is_blocked_other_changes_apply(client, admin, sites, db):
    sid = seed_segment(db, "AAAA", "BBBB", "5.000")
    first = post(client, workbook([["AAAA-BBBB", None, 10, None]], head=HEAD)).json()["upload_id"]
    apply(client, first)
    uid = post(client, workbook([["AAAA-BBBB", 9, 4, None]], head=HEAD)).json()["upload_id"]
    item = rows(client, uid, "changed")["items"][0]
    blocked = [c["blocked"] for c in item["changes"] if c["field"] == "survey_cores"]
    assert blocked == ["cannot lower below the 10 cores that already exist"]
    result = apply(client, uid).json()
    assert result["blocked"] == 1 and len(result["blocked_changes"]) == 1
    row = segment(db, "AAAA", "BBBB")
    assert (str(row["distance_km"]), row["survey_cores"], core_count(db, sid)) == ("9.000", 10, 10)


def test_verified_above_total_is_needs_review(client, admin, sites):
    data = workbook([["AAAA-BBBB", 1, 50, 48], ["BBBB-CCCC", 1, "x", None], ["CCCC-DDDD", 1, 5, 0]], head=HEAD)
    uid = post(client, data).json()["upload_id"]
    found = problems(client, uid)
    assert found[2] == "Verified cores 50 is above Total cores 48"
    assert found[3] == "Verified cores is not a whole number"
    assert found[4] == "Total cores must be above 0"
