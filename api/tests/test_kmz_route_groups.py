"""KMZ route lines stored as drawn on the segment the admin assigns (ticket 08)."""

from app.map.service import map_segments, segment_kml
from sqlalchemy.orm import Session
from test_kmz_upload import URL, admin, segments, stage  # noqa: F401 (fixtures)
from test_load_kmz import EJH1_TO_RINI, RINI_TO_OKID, folder_xml, line_xml, one, write_kmz


def kmz_bytes_of(tmp_path, *lines):
    path = tmp_path / "routes.kmz"
    write_kmz(str(path), folder_xml("routes", "".join(lines)))
    return path.read_bytes()


def route_kmz(tmp_path):
    return kmz_bytes_of(
        tmp_path,
        line_xml(EJH1_TO_RINI[::-1], "rini-ejh1"),  # 0:0 reversed title
        line_xml(EJH1_TO_RINI[:2], "EJH1-RINI"),  # 0:1 shorter second line on the same segment
        line_xml(RINI_TO_OKID, "Untitled Path"),  # 0:2 no title, found by location
        line_xml([(103.0, 1.0), (103.1, 1.0)], "Elsewhere"),  # 0:3 nothing near
    )


def preview(client, tmp_path):
    return stage(client, route_kmz(tmp_path), folder_ids=["0"]).json()


def feature_lines(db, segment_id):
    features = map_segments(Session(bind=db))["features"]
    return [f for f in features if f["properties"]["segment_id"] == segment_id]


def test_preview_lists_lines_with_title_suggestions(client, db, admin, segments, tmp_path):
    body = preview(client, tmp_path)
    by_key = {line["key"]: line for line in body["route_lines"]}
    assert list(by_key) == ["0:0", "0:1", "0:2", "0:3"]
    assert by_key["0:0"]["suggested_segment_id"] == segments[0]
    assert by_key["0:1"]["suggested_by"] == "title"
    assert by_key["0:2"]["suggested_segment_id"] is None and by_key["0:2"]["suggested_by"] is None
    assert by_key["0:0"]["folder_path"] == "routes"
    assert "geometry" not in by_key["0:0"]
    assert shaped_none(db)


def shaped_none(db):
    return not any(f["properties"].get("shaped") for f in map_segments(Session(bind=db))["features"])


def test_suggest_by_location(client, db, admin, segments, tmp_path):
    upload_id = preview(client, tmp_path)["upload_id"]
    response = client.post(f"{URL}/uploads/{upload_id}/suggest-by-location")
    assert response.status_code == 200
    found = {item["key"]: item for item in response.json()}
    assert found["0:2"] == {"key": "0:2", "segment_id": segments[1], "suggested_by": "location"}
    assert found["0:0"]["segment_id"] == segments[0]
    assert "0:3" not in found
    assert one(db, "SELECT count(*) FROM kmz_groups") == 0


def test_apply_several_lines_on_one_segment_drawn_and_exported(client, db, admin, segments, tmp_path):
    body = preview(client, tmp_path)
    picks = [{"key": "0:0", "segment_id": segments[0]}, {"key": "0:1", "segment_id": segments[0]}]
    response = client.post(f"{URL}/uploads/{body['upload_id']}/apply", json={"route_lines": picks})
    assert response.status_code == 200
    assert response.json()["route_lines_saved"] == 2
    assert response.json()["shaped"] == 0  # the title join is replaced
    assert one(db, "SELECT count(*) FROM kmz_groups WHERE route AND segment_id = :s", s=segments[0]) == 2
    assert one(db, "SELECT count(*) FROM routes WHERE geom IS NOT NULL") == 0
    drawn = feature_lines(db, segments[0])
    assert len(drawn) == 2
    assert drawn[0]["properties"]["shaped"] is True
    assert "extra_line" not in drawn[0]["properties"] and drawn[1]["properties"]["extra_line"] is True
    assert len(drawn[0]["geometry"]["coordinates"]) == 4  # the longest, as drawn (reversed title line kept as is)
    assert drawn[0]["geometry"]["coordinates"][0] == list(EJH1_TO_RINI[-1])
    other = feature_lines(db, segments[1])
    assert len(other) == 1 and len(other[0]["geometry"]["coordinates"]) == 2  # straight line

    name, kml = segment_kml(Session(bind=db), segments[0])
    assert kml.count("<LineString>") == 2
    assert f"{EJH1_TO_RINI[-1][0]},{EJH1_TO_RINI[-1][1]},0" in kml.split("<Placemark>")[1]


def test_hidden_route_group_falls_back_to_straight_line(client, db, admin, segments, tmp_path):
    body = preview(client, tmp_path)
    picks = [{"key": "0:0", "segment_id": segments[0]}]
    client.post(f"{URL}/uploads/{body['upload_id']}/apply", json={"route_lines": picks})
    group_id = one(db, "SELECT id FROM kmz_groups WHERE route")
    assert client.patch(f"{URL}/groups/{group_id}", json={"hidden": True}).status_code == 200
    only = feature_lines(db, segments[0])
    assert len(only) == 1 and len(only[0]["geometry"]["coordinates"]) == 2
    assert "shaped" not in only[0]["properties"]


def test_unknown_key_or_segment_is_422(client, db, admin, segments, tmp_path):
    upload_id = preview(client, tmp_path)["upload_id"]
    url = f"{URL}/uploads/{upload_id}/apply"
    assert client.post(url, json={"route_lines": [{"key": "9:9", "segment_id": segments[0]}]}).status_code == 422
    assert client.post(url, json={"route_lines": [{"key": "0:0", "segment_id": 999999}]}).status_code == 422
    assert one(db, "SELECT count(*) FROM kmz_groups") == 0


def test_without_route_lines_old_title_join_still_runs(client, db, admin, segments, tmp_path):
    body = preview(client, tmp_path)
    response = client.post(f"{URL}/uploads/{body['upload_id']}/apply")
    assert response.status_code == 200
    assert response.json()["shaped"] == 1
    assert response.json()["route_lines_saved"] == 0
    assert one(db, "SELECT count(*) FROM kmz_groups WHERE route") == 0


def test_export_without_route_group_is_the_old_line(client, db, admin, segments):
    name, kml = segment_kml(Session(bind=db), segments[0])
    assert kml.count("<LineString>") == 1
    assert kml.count("<Point>") == 2


def test_suggest_by_location_needs_admin(client, db, segments):
    assert client.post(f"{URL}/uploads/1/suggest-by-location").status_code in (401, 403)


def test_route_group_moves_only_to_a_segment(client, db, admin, segments, tmp_path):
    body = preview(client, tmp_path)
    picks = [{"key": "0:0", "segment_id": segments[0]}]
    client.post(f"{URL}/uploads/{body['upload_id']}/apply", json={"route_lines": picks})
    group_id = one(db, "SELECT id FROM kmz_groups WHERE route")
    site_id = one(db, "SELECT site_a_id FROM segments WHERE id = :s", s=segments[0])
    to_site = client.patch(f"{URL}/groups/{group_id}", json={"target": {"kind": "site", "id": site_id}})
    assert to_site.status_code == 422
    to_segment = client.patch(f"{URL}/groups/{group_id}", json={"target": {"kind": "segment", "id": segments[1]}})
    assert to_segment.status_code == 200


def test_preview_route_lines_carry_thinned_coords(client, admin, segments, tmp_path):
    long_line = [(101.0 + index / 1000, 3.0) for index in range(250)]
    body = stage(client, kmz_bytes_of(tmp_path, line_xml(long_line, "Long")), folder_ids=["0"]).json()
    coords = body["route_lines"][0]["coords"]
    assert len(coords) <= 101
    assert coords[0] == [101.0, 3.0]
    assert coords[-1] == [101.249, 3.0]


def test_new_import_hides_the_segments_earlier_route_lines(client, db, admin, segments, tmp_path):
    first = preview(client, tmp_path)
    earlier = [{"key": "0:0", "segment_id": segments[0]}]
    client.post(f"{URL}/uploads/{first['upload_id']}/apply", json={"route_lines": earlier})
    second = preview(client, tmp_path)
    picks = [{"key": "0:1", "segment_id": segments[0]}]
    assert client.post(f"{URL}/uploads/{second['upload_id']}/apply", json={"route_lines": picks}).status_code == 200
    assert one(db, "SELECT count(*) FROM kmz_groups WHERE route AND hidden_at IS NULL") == 1
    assert one(db, "SELECT count(*) FROM kmz_groups WHERE route") == 2
    assert len(feature_lines(db, segments[0])) == 1
