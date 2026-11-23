"""A field is protected from uploads only when a dashboard edit (a data_edits row with no upload_id) exists."""
from datetime import datetime

import pytest
from sqlalchemy import text
from test_auth import login, mkuser
from test_load_data import run as run_load_data
from test_reservation_upload import ADMIN
from test_reservation_upload import row as reservation_row
from test_reservation_upload import workbook as reservation_workbook
from test_segment_list import apply, post, row, segment, workbook

RESERVATION_URL = "/api/admin/uploads"


@pytest.fixture
def admin(client, db):
    admin_id = mkuser(db, "boss", "admin")
    assert login(client, "boss").status_code == 200
    for name in ("AABB", "BBCC"):
        db.execute(text("INSERT INTO sites (name, kind) VALUES (:name, 'site')"), {"name": name})
    return admin_id


def segment_list_upload(client, distance):
    uploaded = post(client, workbook([row("AABB-BBCC", dist=distance)]))
    assert uploaded.status_code == 201
    applied = apply(client, uploaded.json()["upload_id"])
    assert applied.status_code == 200
    return applied.json()


def distance_of(db):
    return float(segment(db, "AABB", "BBCC")["distance_km"])


def add_dashboard_edit(db, admin_id, remarks):
    segment_id = segment(db, "AABB", "BBCC")["id"]
    db.execute(
        text(
            "INSERT INTO data_edits (entity, entity_id, field, old_value, new_value, remarks, user_id) "
            "VALUES ('segment', :segment_id, 'distance_km', '10.5', '20', :remarks, :user_id)"
        ),
        {"segment_id": segment_id, "remarks": remarks, "user_id": admin_id},
    )


def test_dashboard_edit_protects_the_field(client, db, admin):
    segment_list_upload(client, 10.5)
    add_dashboard_edit(db, admin, "checked on site")
    result = segment_list_upload(client, 30)
    assert result["protected_kept"] == 1
    assert result["changed"] == 0
    assert distance_of(db) == 10.5


def test_upload_edit_does_not_protect(client, db, admin):
    segment_list_upload(client, 10.5)
    edit = db.execute(text("SELECT upload_id FROM data_edits WHERE field = 'distance_km'")).all()
    assert edit == []  # a new segment is created with its distance, no edit row
    segment_list_upload(client, 12)
    assert distance_of(db) == 12
    assert db.execute(text("SELECT upload_id FROM data_edits WHERE field = 'distance_km'")).scalar() is not None
    result = segment_list_upload(client, 14)
    assert result["protected_kept"] == 0
    assert result["changed"] == 1
    assert distance_of(db) == 14


def test_dashboard_remarks_that_look_like_an_upload_note_still_protect(client, db, admin):
    segment_list_upload(client, 10.5)
    add_dashboard_edit(db, admin, "segment list upload by hand #1")
    result = segment_list_upload(client, 30)
    assert result["protected_kept"] == 1
    assert distance_of(db) == 10.5


def test_reservation_upload_may_change_a_distance_set_by_a_segment_list_upload(client, db, admin):
    segment_list_upload(client, 10.5)
    segment_list_upload(client, 12)
    workbook_bytes = reservation_workbook(reservation_row("AABB-BBCC", km=15, date=datetime(2025, 10, 10)))
    uploaded = client.post(
        RESERVATION_URL, files={"file": ("res.xlsx", workbook_bytes, "application/octet-stream")}, headers=ADMIN
    )
    assert uploaded.status_code == 201
    upload_id = uploaded.json()["upload_id"]
    confirmed = client.post(f"{RESERVATION_URL}/{upload_id}/confirm", json={}, headers=ADMIN)
    assert confirmed.status_code == 200
    assert distance_of(db) == 15


def test_a_value_written_by_load_data_does_not_protect(db, monkeypatch, tmp_path):
    mkuser(db, "boss1", "admin")
    sites = [["AAAA", 3.1, 101.6, None], ["BBBB", 3.2, 101.7, None]]
    first = [["AAAA-BBBB", 10, None, None, 8, 144]]
    assert run_load_data(monkeypatch, db, tmp_path, sites, first) == 0
    second = [["AAAA-BBBB", 20, None, None, 8, 288]]
    assert run_load_data(monkeypatch, db, tmp_path, sites, second) == 0
    changed = db.execute(text("SELECT distance_km, cable_size FROM segments")).one()
    assert (float(changed[0]), changed[1]) == (20, 288)
    unlinked = db.execute(text("SELECT count(*) FROM data_edits WHERE upload_id IS NULL")).scalar_one()
    assert unlinked == 0
