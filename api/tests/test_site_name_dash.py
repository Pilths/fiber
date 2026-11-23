"""Site names: any length, no '-' inside (it separates the two sites in a segment link)."""
import test_reservation_upload as tru
import test_segment_list as tsl
import test_site_master as tsm
from sqlalchemy import text
from test_auth import mkuser
from test_reservations import one

admin = tsl.admin


def test_segment_list_with_three_letter_site_names(client, admin, db):
    for name in ("KLG", "SBG"):
        db.execute(text("INSERT INTO sites (name, kind) VALUES (:n, 'site')"), {"n": name})
    upload = tsl.post(client, tsl.workbook([tsl.row("KLG-SBG")])).json()["upload_id"]
    assert tsl.apply(client, upload).status_code == 200
    assert tsl.segment(db, "KLG", "SBG") is not None


def test_site_master_row_with_dash_needs_review(client, db):
    mkuser(db, "boss", "admin")
    tsm.login(client, "boss")
    upload = tsm.post(client, tsm.workbook([tsm.site("KL-1"), tsm.site("KL1")])).json()["upload_id"]
    problems = tsm.rows(client, upload, "sites", "problem")["items"]
    assert [(p["key"], p["reason"]) for p in problems] == [("KL-1", "site name has '-'")]


def test_dashboard_rename_with_dash_is_422(client, db):
    mkuser(db, "boss", "admin")
    tsm.seed_sites(db, ["AAAA"])
    sid = one(db, "SELECT id FROM sites WHERE name = 'AAAA'")
    r = client.post(f"/api/admin/sites/{sid}", json={"name": "A-B"}, headers=tru.ADMIN)
    assert r.status_code == 422
