"""KMZ upload: stage a preview, apply it. Uses the KMZ builder from test_load_kmz."""
import pytest
from app.map.service import map_segments
from sqlalchemy.orm import Session
from test_auth import login, mkuser
from test_load_kmz import EJH1, OKID, RINI, build_kmz, make_segment, make_site, one

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
    assert applied.json() == {
        "upload_id": body["upload_id"], "shaped": 2, "groups_saved": 0, "clusters_created": 0,
        "route_lines_saved": 0}
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


def nested_kmz():
    import zipfile
    import io
    from test_load_kmz import HIGHWAY, folder_xml, line_xml
    inner = folder_xml("inner", line_xml(HIGHWAY))
    outer = folder_xml("outer", line_xml(HIGHWAY[::-1]) + inner)
    other = folder_xml("other", "")
    loose = line_xml(HIGHWAY)
    kml = f'<kml xmlns="http://www.opengis.net/kml/2.2"><Document>{outer}{other}{loose}</Document></kml>'
    buffer = io.BytesIO()
    with zipfile.ZipFile(buffer, "w") as archive:
        archive.writestr("doc.kml", kml)
    return buffer.getvalue()


def test_folder_tree_shape_and_counts(client, admin):
    response = client.post(f"{URL}/folders", files={"file": ("n.kmz", nested_kmz())})
    assert response.status_code == 200
    assert response.json() == {
        "folders": [
            {"id": "-", "name": "No folder", "lines": 1, "areas": 0, "points": 0, "children": []},
            {"id": "0", "name": "outer", "lines": 2, "areas": 0, "points": 0, "children": [
                {"id": "0/0", "name": "inner", "lines": 1, "areas": 0, "points": 0, "children": []}]},
            {"id": "1", "name": "other", "lines": 0, "areas": 0, "points": 0, "children": []},
        ],
        "loose_lines": 1,
    }


def test_folders_bad_file(client, admin):
    assert client.post(f"{URL}/folders", files={"file": ("n.kmz", b"junk")}).status_code == 422


def test_folder_ids_dedupe_parent_and_child(client, db, admin, segments):
    body = stage(client, nested_kmz(), folder_ids=["0", "0/0"]).json()
    assert body["lines"] == 2
    assert body["folder"] == "outer"


def test_folder_ids_child_only_and_empty(client, db, admin, segments):
    assert stage(client, nested_kmz(), folder_ids=["0/0"]).json()["folder"] == "inner"
    body = stage(client, nested_kmz(), folder_ids=["1"]).json()
    assert body["block_reason"] == "No lines in the selected folders."


def test_folder_ids_unknown_is_422(client, admin):
    assert stage(client, nested_kmz(), folder_ids=["9"]).status_code == 422


def test_folder_ids_preview_and_old_folder_path(client, db, admin, segments, kmz_bytes):
    tree = client.post(f"{URL}/folders", files={"file": ("t.kmz", kmz_bytes)}).json()
    route_id = next(node["id"] for node in tree["folders"] if node["lines"] == 3)
    by_ids = stage(client, kmz_bytes, folder_ids=[route_id]).json()
    by_name = stage(client, kmz_bytes).json()
    assert by_ids["lines"] == by_name["lines"] == 3
    assert [i["segment_id"] for i in by_ids["shaped"]] == [i["segment_id"] for i in by_name["shaped"]]
