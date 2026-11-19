"""KMZ line shapes: lines are matched to segments by their title AAAA-BBBB."""
import json
import zipfile

from app.load_kmz import compute_shapes, run
from app.map.service import map_segments
from sqlalchemy import text
from sqlalchemy.orm import Session

EJH1 = (101.5, 3.0)
RINI = (101.52, 3.035)
OKID = (101.52, 3.065)
HIGHWAY = [(101.5, 3.0 + 0.01 * i) for i in range(11)]
EJH1_TO_RINI = [EJH1, (101.5, 3.02), (101.51, 3.03), RINI]
RINI_TO_OKID = [RINI, (101.53, 3.05), OKID]


def line_xml(points, title="Untitled Path"):
    coordinates = " ".join(f"{lon},{lat},0" for lon, lat in points)
    return (
        f"<Placemark><name>{title}</name><LineString>"
        f"<coordinates>{coordinates}</coordinates></LineString></Placemark>"
    )


def folder_xml(name, body):
    return f"<Folder><name>{name}</name>{body}</Folder>"


def write_kmz(path, folders):
    kml = f'<kml xmlns="http://www.opengis.net/kml/2.2"><Document>{folders}</Document></kml>'
    with zipfile.ZipFile(path, "w") as archive:
        archive.writestr("doc.kml", kml)


def build_kmz(path):
    """EJH1-RINI drawn backwards, RINI-OKID drawn in two pieces with a spaced lowercase title."""
    middle = RINI_TO_OKID[1]
    folders = (
        folder_xml("ex infra", line_xml([RINI, OKID], "EJH1-OKID"))
        + folder_xml(
            "Propose Route ",
            line_xml(EJH1_TO_RINI[::-1], "EJH1-RINI")
            + line_xml([middle, OKID], "okid - rini")
            + line_xml([RINI, middle], "RINI-OKID"),
        )
        + folder_xml("distance", "")
    )
    write_kmz(path, folders)


def one(db, sql, **params):
    return db.execute(text(sql), params).scalar_one()


def make_site(db, name, xy):
    sql = (
        "INSERT INTO sites (name, kind, geom) "
        "VALUES (:n, 'site', ST_SetSRID(ST_MakePoint(:x, :y), 4326)) RETURNING id"
    )
    return one(db, sql, n=name, x=xy[0], y=xy[1])


def make_segment(db, site_a, site_b):
    return one(db, "INSERT INTO segments (site_a_id, site_b_id, distance_km, survey_cores) "
                   "VALUES (:a, :b, 5, 2) RETURNING id", a=site_a, b=site_b)


def route_coords(db, segment_id):
    sql = (
        "SELECT ST_AsGeoJSON(r.geom) FROM routes r "
        "JOIN route_segments rs ON rs.route_id = r.id WHERE rs.segment_id = :s"
    )
    geojson = one(db, sql, s=segment_id)
    return json.loads(geojson)["coordinates"]


def test_titles_shape_two_segments(db, tmp_path):
    one(db, "INSERT INTO users (username, display_name, role) VALUES ('admin1','a','admin') RETURNING id")
    ejh1, rini, okid = make_site(db, "EJH1", EJH1), make_site(db, "RINI", RINI), make_site(db, "OKID", OKID)
    first = make_segment(db, ejh1, rini)
    second = make_segment(db, okid, rini)  # site A is OKID, the title says RINI first
    path = str(tmp_path / "test.kmz")
    build_kmz(path)

    session = Session(bind=db)
    assert run(session, "admin1", path, "propose route") == 0
    assert run(session, "admin1", path, "propose route") == 0  # again: updates, no duplicates

    assert one(db, "SELECT count(*) FROM routes") == 2
    assert one(db, "SELECT count(*) FROM route_segments") == 2
    assert one(db, "SELECT count(*) FROM uploads WHERE kind = 'kmz' AND status = 'confirmed'") == 2

    shape_one = route_coords(db, first)
    assert shape_one[0] == list(EJH1)  # drawn RINI to EJH1, stored A to B
    assert shape_one[-1] == list(RINI)
    shape_two = route_coords(db, second)
    assert shape_two == [list(OKID), list(RINI_TO_OKID[1]), list(RINI)]  # two pieces joined, A is OKID

    features = {f["properties"]["segment_id"]: f for f in map_segments(session)["features"]}
    assert features[first]["properties"].get("shaped") is True
    assert features[second]["properties"].get("shaped") is True


def test_bad_and_unknown_titles_are_skipped_with_reasons(db):
    ejh1, rini = make_site(db, "EJH1", EJH1), make_site(db, "RINI", RINI)
    segment = make_segment(db, ejh1, rini)
    lines = [
        ("Untitled Path", HIGHWAY),
        ("Untitled Path", HIGHWAY),
        ("", HIGHWAY),
        ("EJH1-RINI-OKID", HIGHWAY),
        ("ABCD-WXYZ", HIGHWAY),
        (" ejh1 - rini ", EJH1_TO_RINI),
    ]
    result = compute_shapes(Session(bind=db), lines)
    assert [item["segment_id"] for item in result["shaped"]] == [segment]
    reasons = {item["name"]: item["reason"] for item in result["skipped"]}
    assert reasons["Untitled Path"] == 'title "Untitled Path" is not a site pair like AAAA-BBBB (2 lines)'
    assert reasons["(no title)"] == 'title "" is not a site pair like AAAA-BBBB'
    assert reasons["EJH1-RINI-OKID"].startswith('title "EJH1-RINI-OKID"')
    assert reasons["ABCD-WXYZ"] == "no segment ABCD-WXYZ in the dashboard"
    assert "sites_attached" not in result


def test_unknown_folder_and_user_fail(db, tmp_path, capsys):
    path = str(tmp_path / "test.kmz")
    build_kmz(path)
    session = Session(bind=db)
    assert run(session, "nobody", path, "propose route") == 1
    one(db, "INSERT INTO users (username, display_name, role) VALUES ('admin1','a','admin') RETURNING id")
    assert run(session, "admin1", path, "no such folder") == 1
    assert "ex infra" in capsys.readouterr().out


def test_file_without_folders_or_blank_folder_reads_every_line(tmp_path):
    from app.load_kmz import parse_lines
    path = tmp_path / "flat.kmz"
    write_kmz(path, line_xml(HIGHWAY))
    lines, folders = parse_lines(str(path), "propose route")
    assert len(lines) == 1 and folders == []
    build_kmz(str(tmp_path / "foldered.kmz"))
    lines, _folders = parse_lines(str(tmp_path / "foldered.kmz"), "")
    assert len(lines) == 4  # every line, ex infra included, when the folder box is left empty
