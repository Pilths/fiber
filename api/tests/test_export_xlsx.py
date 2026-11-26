"""Export: locked keys, open edit cells, and the file uploads back with every row unchanged."""
import io

import openpyxl
import pytest
from test_auth import login, mkuser
from test_load_kmz import EJH1, RINI, make_segment, make_site

URL = "/api/admin/export/fiber-data.xlsx"


@pytest.fixture
def admin(client, db):
    mkuser(db, "boss", "admin")
    assert login(client, "boss").status_code == 200


def test_export_locks_keys_and_round_trips(client, db, admin):
    make_segment(db, make_site(db, "EJH1", EJH1), make_site(db, "RINI", RINI))
    response = client.get(URL)
    assert response.status_code == 200
    wb = openpyxl.load_workbook(io.BytesIO(response.content))
    sites, segments = wb["Sites"], wb["Segments"]
    assert sites.protection.sheet and segments.protection.sheet
    assert segments["A2"].value == "EJH1-RINI"
    assert segments["A2"].protection.locked
    assert not segments["B2"].protection.locked
    assert sites["A2"].protection.locked
    uploaded = client.post("/api/admin/segment-list/uploads", files={"file": ("x.xlsx", response.content)})
    assert uploaded.status_code == 201
    assert uploaded.json()["counts"]["problem"] == 0
    assert uploaded.json()["counts"]["new"] == 0


def test_export_needs_admin(client):
    assert client.get(URL).status_code in (401, 403)
