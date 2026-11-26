"""KMZ import box evidence per line: end distances, km vs Excel, duplicate, closest suggestion, same."""
from sqlalchemy import text
from test_kmz_segment_routes import apply_picks
from test_kmz_upload import URL, admin, segments, stage  # noqa: F401 (fixtures)
from test_load_kmz import EJH1_TO_RINI, RINI_TO_OKID, folder_xml, line_xml, write_kmz


def stage_folders(client, tmp_path, *folders):
    path = tmp_path / "folders.kmz"
    write_kmz(str(path), "".join(folder_xml(name, "".join(lines)) for name, lines in folders))
    ids = [str(index) for index in range(len(folders))]
    body = stage(client, path.read_bytes(), folder_ids=ids).json()
    return body, {line["key"]: line for line in body["route_lines"]}


def test_end_distance_and_km_against_excel(client, db, admin, segments, tmp_path):
    db.execute(text("UPDATE segments SET distance_km = 1 WHERE id = :s"), {"s": segments[0]})
    _, lines = stage_folders(client, tmp_path, ("a", [line_xml(EJH1_TO_RINI, "EJH1-RINI")]))
    line = lines["0:0"]
    assert line["end_a_m"] == 0 and line["end_b_m"] == 0
    assert line["km"] > 3 and line["excel_km"] == 1 and line["km_differs"] is True
    assert line["same"] is False and line["duplicate"] is False


def test_duplicate_across_folders(client, db, admin, segments, tmp_path):
    _, lines = stage_folders(
        client, tmp_path,
        ("one", [line_xml(EJH1_TO_RINI, "EJH1-RINI")]), ("two", [line_xml(EJH1_TO_RINI, "EJH1-RINI")]),
    )
    assert [lines[key]["duplicate"] for key in sorted(lines)] == [False, True]


def test_closest_suggestion_by_location_and_folder(client, db, admin, segments, tmp_path):
    shifted = [(lon + 0.0003, lat) for lon, lat in RINI_TO_OKID]
    _, lines = stage_folders(
        client, tmp_path,
        ("EJH1-RINI", [line_xml(shifted, "Path 7"), line_xml(EJH1_TO_RINI, "Titled")]),
    )
    # the folder named after a site pair is a suggestion, and nothing is assigned
    assert lines["0:0"]["closest_by"] == "folder" and lines["0:0"]["closest_segment_id"] == segments[0]
    assert lines["0:0"]["suggested_segment_id"] is None
    _, lines = stage_folders(client, tmp_path, ("misc", [line_xml(shifted, "Path 7")]))
    assert lines["0:0"]["closest_by"] == "location" and lines["0:0"]["closest_segment_id"] == segments[1]
    assert 0 < lines["0:0"]["end_a_m"] < 100 and lines["0:0"]["suggested_segment_id"] is None


def test_same_as_stored_route_is_flagged_and_never_stored_twice(client, db, admin, segments, tmp_path):
    first, _ = stage_folders(client, tmp_path, ("a", [line_xml(EJH1_TO_RINI, "EJH1-RINI")]))
    assert apply_picks(client, first["upload_id"], segments[0], ["0:0"]).json()["route_lines_saved"] == 1
    body, lines = stage_folders(client, tmp_path, ("a", [line_xml(EJH1_TO_RINI, "EJH1-RINI")]))
    assert lines["0:0"]["same"] is True
    assert apply_picks(client, body["upload_id"], segments[0], ["0:0"]).json()["route_lines_saved"] == 0
