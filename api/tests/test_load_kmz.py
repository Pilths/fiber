"""KMZ line shapes: spurs end near the highway, an ex infra line must be ignored."""
import io
import json
import zipfile

from sqlalchemy import text
from sqlalchemy.orm import Session

from app.load_kmz import run
from app.map.service import map_segments

EJH1 = (101.5, 3.0)
RINI = (101.52, 3.035)
OKID = (101.52, 3.065)
HIGHWAY = [(101.5, 3.0 + 0.01 * i) for i in range(11)]  # runs on to lat 3.10, past the last junction
SPUR_END_LON = 101.50018  # about 20 m east of the highway, between two highway vertices


def line_xml(points):
    coordinates = " ".join(f"{lon},{lat},0" for lon, lat in points)
    return (
        "<Placemark><name>Untitled Path</name><LineString>"
        f"<coordinates>{coordinates}</coordinates></LineString></Placemark>"
    )


def folder_xml(name, body):
    return f"<Folder><name>{name}</name>{body}</Folder>"


def build_kmz(path):
    points = "".join(
        f"<Placemark><name>{n}</name><Point><coordinates>{x},{y},0</coordinates></Point></Placemark>"
        for n, (x, y) in (("EJH1", EJH1), ("RINI", RINI), ("OKID", OKID))
    )
    spur_rini = [RINI, (101.51, RINI[1]), (SPUR_END_LON, RINI[1])]
    spur_okid = [OKID, (101.51, OKID[1]), (SPUR_END_LON, OKID[1])]
    folders = (
        folder_xml("site", points)
        + folder_xml("ex infra", line_xml([RINI, OKID]))
        + folder_xml("Propose Route ", line_xml(HIGHWAY) + line_xml(spur_rini) + line_xml(spur_okid))
        + folder_xml("distance", "")
    )
    kml = f'<kml xmlns="http://www.opengis.net/kml/2.2"><Document>{folders}</Document></kml>'
    with zipfile.ZipFile(path, "w") as archive:
        archive.writestr("doc.kml", kml)


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


def test_highway_and_spurs_shape_two_segments(db, tmp_path):
    one(db, "INSERT INTO users (username, display_name, role) VALUES ('admin1','a','admin') RETURNING id")
    ejh1, rini, okid = make_site(db, "EJH1", EJH1), make_site(db, "RINI", RINI), make_site(db, "OKID", OKID)
    first = make_segment(db, ejh1, rini)
    second = make_segment(db, rini, okid)
    path = str(tmp_path / "test.kmz")
    build_kmz(path)

    session = Session(bind=db)
    assert run(session, "admin1", path, "propose route") == 0
    assert run(session, "admin1", path, "propose route") == 0  # again: updates, no duplicates

    assert one(db, "SELECT count(*) FROM routes") == 2
    assert one(db, "SELECT count(*) FROM route_segments") == 2
    assert one(db, "SELECT count(*) FROM uploads WHERE kind = 'kmz' AND status = 'confirmed'") == 2

    shape_one = route_coords(db, first)
    shape_two = route_coords(db, second)
    assert shape_one[0] == list(EJH1)
    assert shape_one[-1] == list(RINI)
    assert shape_two[0] == list(RINI)
    assert shape_two[-1] == list(OKID)
    assert [101.5, 3.05] in shape_two  # via the highway, not the ex infra shortcut
    for shape in (shape_one, shape_two):
        assert max(lat for _, lat in shape) <= OKID[1]  # the highway extension is not drawn

    features = {f["properties"]["segment_id"]: f for f in map_segments(session)["features"]}
    assert features[first]["properties"].get("shaped") is True
    assert features[second]["properties"].get("shaped") is True


def test_unknown_folder_and_user_fail(db, tmp_path, capsys):
    path = str(tmp_path / "test.kmz")
    build_kmz(path)
    session = Session(bind=db)
    assert run(session, "nobody", path, "propose route") == 1
    one(db, "INSERT INTO users (username, display_name, role) VALUES ('admin1','a','admin') RETURNING id")
    assert run(session, "admin1", path, "no such folder") == 1
    assert "ex infra" in capsys.readouterr().out
