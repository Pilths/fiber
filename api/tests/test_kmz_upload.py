"""KMZ upload: stage a preview, apply it. Uses the KMZ builder from test_load_kmz."""
import pytest
from sqlalchemy import text
from sqlalchemy.orm import Session
from test_auth import login, mkuser
from test_load_kmz import EJH1, OKID, RINI, build_kmz, make_segment, make_site, one

from app.map.service import map_segments

URL = "/api/admin/kmz"


@pytest.fixture
def admin(client, db):
    mkuser(db, "boss", "admin")
    assert login(client, "boss").status_code == 200


@pytest.fixture
def segments(db):
    ejh1, rini, okid = make_site(db, "EJH1", EJH1), make_site(db, "RINI", RINI), make_site(db, "OKID", OKID)
    return make_segment(db, ejh1, rini), make_segment(db, rini, okid)


@pytest.fixture
def kmz_bytes(tmp_path):
    path = tmp_path / "test.kmz"
    build_kmz(str(path))
    return path.read_bytes()


def stage(client, data, name="test.kmz", **form):
    return client.post(f"{URL}/uploads", files={"file": (name, data)}, data=form)


def shaped_ids(db):
    features = map_segments(Session(bind=db))["features"]
    return {f["properties"]["segment_id"] for f in features if f["properties"].get("shaped")}


def test_stage_apply_then_restage(client, db, admin, segments, kmz_bytes):
    first = stage(client, kmz_bytes)
    assert first.status_code == 201
    body = first.json()
    assert body["block_reason"] is None
    assert body["lines"] == 3
    assert sorted(item["segment_id"] for item in body["shaped"]) == sorted(segments)
    assert all(item["had_shape"] is False for item in body["shaped"])
    assert "coords" not in body["shaped"][0]
    assert shaped_ids(db) == set()

    applied = client.post(f"{URL}/uploads/{body['upload_id']}/apply")
    assert applied.status_code == 200
    assert applied.json() == {"upload_id": body["upload_id"], "shaped": 2}
    assert shaped_ids(db) == set(segments)
    assert one(db, "SELECT status FROM uploads WHERE id = :i", i=body["upload_id"]) == "confirmed"

    second = stage(client, kmz_bytes).json()
    assert all(item["had_shape"] is True for item in second["shaped"])


def test_planner_forbidden(client, db, segments, kmz_bytes):
    mkuser(db, "plan", "planner")
    assert login(client, "plan").status_code == 200
    assert stage(client, kmz_bytes).status_code == 403
    assert client.post(f"{URL}/uploads/1/apply").status_code == 403


def test_only_kmz_accepted(client, admin):
    assert stage(client, b"x", name="a.xlsx").status_code == 422
    assert stage(client, b"not a zip").status_code == 422


def test_wrong_folder_blocks_apply(client, db, admin, segments, kmz_bytes):
    body = stage(client, kmz_bytes, folder="no such folder").json()
    assert "ex infra" in body["block_reason"]
    assert body["shaped"] == []
    assert client.post(f"{URL}/uploads/{body['upload_id']}/apply").status_code == 409
    assert shaped_ids(db) == set()


def test_apply_twice_and_unknown(client, admin, segments, kmz_bytes):
    upload_id = stage(client, kmz_bytes).json()["upload_id"]
    assert client.post(f"{URL}/uploads/{upload_id}/apply").status_code == 200
    assert client.post(f"{URL}/uploads/{upload_id}/apply").status_code == 409
    assert client.post(f"{URL}/uploads/99999/apply").status_code == 404
