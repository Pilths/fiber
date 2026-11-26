"""The per-segment KMZ routes card: list, remove and undo, export, preview statuses, apply with ticked lines."""
import io
import zipfile

from test_kmz_route_groups import kmz_bytes_of
from test_kmz_upload import URL, admin, segments, stage  # noqa: F401 (fixtures)
from test_load_kmz import EJH1_TO_RINI, line_xml, one


def stage_lines(client, tmp_path, *lines):
    return stage(client, kmz_bytes_of(tmp_path, *lines), folder_ids=["0"]).json()


def apply_picks(client, upload_id, segment_id, keys):
    picks = [{"key": key, "segment_id": segment_id} for key in keys]
    return client.post(f"{URL}/uploads/{upload_id}/apply", json={"route_lines": picks})


def statuses(client, upload_id, segment_id):
    body = client.get(f"{URL}/uploads/{upload_id}/segments/{segment_id}/lines").json()
    return {line["key"]: line["status"] for line in body["lines"]}, body


def test_statuses_new_then_same_and_replaces(client, db, admin, segments, tmp_path):
    first = stage_lines(client, tmp_path, line_xml(EJH1_TO_RINI, "A"))
    found, _ = statuses(client, first["upload_id"], segments[0])
    assert found == {"0:0": "new"}
    assert apply_picks(client, first["upload_id"], segments[0], ["0:0"]).json()["route_lines_saved"] == 1

    second = stage_lines(client, tmp_path, line_xml(EJH1_TO_RINI, "A again"), line_xml(EJH1_TO_RINI[:2], "B"),
                         line_xml(EJH1_TO_RINI[::-1], "reversed"))
    found, body = statuses(client, second["upload_id"], segments[0])
    assert found == {"0:0": "same", "0:1": "replaces route", "0:2": "same"}
    assert all(line["distance_km"] > 0 for line in body["lines"])
    assert len(body["stored"]) == 1
    other, _ = statuses(client, second["upload_id"], segments[1])
    assert other["0:0"] == "new"  # the other segment has no route


def test_apply_one_ticked_line_and_never_twice(client, db, admin, segments, tmp_path):
    body = stage_lines(client, tmp_path, line_xml(EJH1_TO_RINI, "A"), line_xml(EJH1_TO_RINI[:2], "B"))
    assert apply_picks(client, body["upload_id"], segments[0], ["0:1"]).json()["route_lines_saved"] == 1
    assert one(db, "SELECT count(*) FROM kmz_groups WHERE route AND segment_id = :s", s=segments[0]) == 1

    again = stage_lines(client, tmp_path, line_xml(EJH1_TO_RINI[:2], "B copy"))
    assert apply_picks(client, again["upload_id"], segments[0], ["0:0"]).json()["route_lines_saved"] == 0
    assert one(db, "SELECT count(*) FROM kmz_groups WHERE route AND segment_id = :s", s=segments[0]) == 1


def test_replacing_line_hides_earlier_routes(client, db, admin, segments, tmp_path):
    first = stage_lines(client, tmp_path, line_xml(EJH1_TO_RINI, "A"))
    apply_picks(client, first["upload_id"], segments[0], ["0:0"])
    second = stage_lines(client, tmp_path, line_xml(EJH1_TO_RINI[:2], "B"))
    apply_picks(client, second["upload_id"], segments[0], ["0:0"])
    listed = client.get(f"{URL}/segments/{segments[0]}/routes").json()
    assert [route["name"] for route in listed] == ["B"]
    assert one(db, "SELECT count(*) FROM kmz_groups WHERE route AND segment_id = :s", s=segments[0]) == 2


def test_list_hide_show_keeps_history(client, db, admin, segments, tmp_path):
    body = stage_lines(client, tmp_path, line_xml(EJH1_TO_RINI, "A"))
    apply_picks(client, body["upload_id"], segments[0], ["0:0"])
    listed = client.get(f"{URL}/segments/{segments[0]}/routes").json()
    assert len(listed) == 1
    route = listed[0]
    assert route["folder"] == "routes" and route["name"] == "A" and route["file"] == "test.kmz"
    assert route["distance_km"] > 0 and len(route["uploaded"]) == 10
    assert client.get(f"{URL}/segments/{segments[1]}/routes").json() == []

    assert client.patch(f"{URL}/groups/{route['id']}", json={"hidden": True}).status_code == 200
    assert client.get(f"{URL}/segments/{segments[0]}/routes").json() == []
    assert client.patch(f"{URL}/groups/{route['id']}", json={"hidden": False}).status_code == 200
    assert len(client.get(f"{URL}/segments/{segments[0]}/routes").json()) == 1

    assert one(db, "SELECT count(*) FROM kmz_groups WHERE id = :g", g=route["id"]) == 1
    sql = "SELECT count(*) FROM data_edits WHERE entity = 'kmz_group' AND entity_id = :g AND field = 'hidden'"
    assert one(db, sql, g=route["id"]) == 2


def test_export_one_group(client, db, admin, segments, tmp_path):
    body = stage_lines(client, tmp_path, line_xml(EJH1_TO_RINI, "A"))
    apply_picks(client, body["upload_id"], segments[0], ["0:0"])
    route = client.get(f"{URL}/segments/{segments[0]}/routes").json()[0]
    response = client.get(f"{URL}/groups/{route['id']}/kmz")
    assert response.status_code == 200
    kml = zipfile.ZipFile(io.BytesIO(response.content)).read("doc.kml").decode()
    assert kml.count("<LineString>") == 1 and "<name>A</name>" in kml
    assert client.get(f"{URL}/groups/999999/kmz").status_code == 404
