"""KMZ elements: parser (shapes, styles, counts), folder groups with default targets, apply per target."""
import io
import json
import zipfile
from xml.etree import ElementTree

from app.ingest.kmz import elements_in_folder, folder_nodes, folder_tree, kml_colour, parse_styles
from sqlalchemy import text
from test_auth import login, mkuser
from test_kmz_upload import URL, admin, segments, stage  # noqa: F401 (fixtures)
from test_load_kmz import EJH1, OKID, RINI, folder_xml, line_xml, make_site, one

import pytest

SQUARE = [(101.4, 2.9), (101.6, 2.9), (101.6, 3.1), (101.4, 3.1), (101.4, 2.9)]
HOLE = [(101.45, 2.95), (101.55, 2.95), (101.55, 3.05), (101.45, 3.05), (101.45, 2.95)]
STYLES = """
<Style id="red"><LineStyle><color>ff0000ff</color><width>3</width></LineStyle>
<PolyStyle><color>800000ff</color><fill>1</fill><outline>0</outline></PolyStyle></Style>
<StyleMap id="map"><Pair><key>normal</key><styleUrl>#red</styleUrl></Pair>
<Pair><key>highlight</key><styleUrl>#other</styleUrl></Pair></StyleMap>
"""


def coords(points):
    return " ".join(f"{lon},{lat},5" for lon, lat in points)


def ring_xml(points):
    return f"<LinearRing><coordinates>{coords(points)}</coordinates></LinearRing>"


def polygon_xml(outer, hole=None):
    inner = f"<innerBoundaryIs>{ring_xml(hole)}</innerBoundaryIs>" if hole else ""
    return f"<Polygon><outerBoundaryIs>{ring_xml(outer)}</outerBoundaryIs>{inner}</Polygon>"


def point_xml(lon, lat):
    return f"<Point><coordinates>{lon},{lat},0</coordinates></Point>"


def placemark(name, shape, style=""):
    return f"<Placemark><name>{name}</name>{style}{shape}</Placemark>"


def kml_bytes(body):
    kml = f'<kml xmlns="http://www.opengis.net/kml/2.2"><Document>{STYLES}{body}</Document></kml>'
    buffer = io.BytesIO()
    with zipfile.ZipFile(buffer, "w") as archive:
        archive.writestr("doc.kml", kml)
    return buffer.getvalue()


def root_of(body):
    return ElementTree.fromstring(f'<kml xmlns="http://www.opengis.net/kml/2.2"><Document>{STYLES}{body}</Document></kml>')


def first_folder_elements(body):
    root = root_of(body)
    folder = folder_nodes(root)["0"]
    return elements_in_folder(folder, parse_styles(root))


def test_colour_is_aabbggrr():
    assert kml_colour("ff0000ff") == ("#ff0000", 1.0)
    assert kml_colour("80ff8000") == ("#0080ff", 0.5)
    assert kml_colour("bad") is None


def test_polygon_with_hole_and_style_url():
    body = folder_xml("f", placemark("Block", polygon_xml(SQUARE, HOLE), "<styleUrl>#map</styleUrl>"))
    [element] = first_folder_elements(body)
    assert element["kind"] == "area"
    assert element["name"] == "Block"
    assert element["geometry"]["type"] == "Polygon"
    assert len(element["geometry"]["coordinates"]) == 2
    assert element["geometry"]["coordinates"][0][0] == [101.4, 2.9]  # altitude dropped
    assert element["kmz_style"] == {
        "line_colour": "#ff0000", "line_opacity": 1.0, "line_width": 3.0,
        "fill_colour": "#ff0000", "fill_opacity": 0.5, "fill": True, "outline": False,
    }


def test_inline_style_point_and_degenerate_shapes():
    inline = "<Style><LineStyle><color>ff00ff00</color></LineStyle></Style>"
    body = folder_xml("f", (
        placemark("POE", point_xml(101.5, 3.0), inline)
        + placemark("short", f"<LineString><coordinates>{coords([(101.5, 3.0)])}</coordinates></LineString>")
        + placemark("flat ring", ring_xml([(101.4, 2.9), (101.6, 2.9)]))
    ))
    [element] = first_folder_elements(body)
    assert element["kind"] == "point"
    assert element["geometry"] == {"type": "Point", "coordinates": [101.5, 3.0]}
    assert element["kmz_style"] == {"line_colour": "#00ff00", "line_opacity": 1.0}


def test_multigeometry_splits_by_kind_and_linear_ring_is_area():
    multi = (
        "<MultiGeometry>" + polygon_xml(SQUARE) + polygon_xml(HOLE) + point_xml(101.5, 3.0)
        + f"<LineString><coordinates>{coords([(101.4, 2.9), (101.5, 3.0)])}</coordinates></LineString>"
        + "</MultiGeometry>"
    )
    body = folder_xml("f", placemark("Area", multi) + placemark("ring", ring_xml(SQUARE)))
    elements = first_folder_elements(body)
    kinds = [(element["name"], element["kind"], element["geometry"]["type"]) for element in elements]
    assert kinds == [
        ("Area", "point", "Point"), ("Area", "line", "LineString"), ("Area", "area", "MultiPolygon"),
        ("ring", "area", "Polygon"),
    ]


def test_child_folders_are_not_entered_but_wrappers_are():
    body = folder_xml("outer", placemark("a", point_xml(101.5, 3.0))
                      + "<Wrapper>" + placemark("b", point_xml(101.5, 3.1)) + "</Wrapper>"
                      + folder_xml("inner", placemark("c", point_xml(101.5, 3.2))))
    assert [element["name"] for element in first_folder_elements(body)] == ["a", "b"]


def test_folder_tree_counts_are_recursive():
    body = folder_xml("outer", placemark("a", point_xml(101.5, 3.0)) + folder_xml(
        "inner", placemark("b", polygon_xml(SQUARE)) + placemark("c", point_xml(101.5, 3.2))
        + line_xml([(101.4, 2.9), (101.5, 3.0)])))
    tree, loose = folder_tree(io.BytesIO(kml_bytes(body)))
    outer = tree[0]
    assert (outer["lines"], outer["areas"], outer["points"]) == (1, 1, 2)
    assert (outer["children"][0]["areas"], outer["children"][0]["points"]) == (1, 1)
    assert loose == 0


# ---- preview and apply ----

@pytest.fixture
def sites(db):
    inside = make_site(db, "INSIDE", (101.5, 3.0))
    outside = make_site(db, "FARAWAY", (103.0, 4.0))
    return {"inside": inside, "outside": outside}


def groups_kmz():
    area = placemark("Block", polygon_xml(SQUARE))
    return kml_bytes(
        folder_xml("Routes", line_xml([EJH1, RINI], "EJH1-RINI") + folder_xml("Blocks", area))
        + folder_xml("INSIDE", placemark("POE", point_xml(101.5, 3.0)))
        + folder_xml("Unknown", placemark("x", point_xml(101.5, 3.0)))
        + folder_xml("Far", placemark("x", point_xml(10.0, 50.0)))
    )


def preview(client):
    response = stage(client, groups_kmz(), folder_ids=["0", "1", "2", "3"])
    assert response.status_code == 201
    body = response.json()
    return body["upload_id"], {group["name"]: group for group in body["groups"]}


def test_preview_defaults(client, db, admin, segments, sites):
    cluster_id = one(db, "INSERT INTO clusters (name, created_by) VALUES ('Blocks', (SELECT id FROM users LIMIT 1)) "
                         "RETURNING id")
    _, groups = preview(client)
    assert set(groups) == {"Blocks", "INSIDE", "Unknown", "Far"}  # Routes: its only line is a route line
    assert groups["Blocks"]["default_target"] == "cluster"
    assert groups["Blocks"]["default_target_id"] == cluster_id
    assert groups["Blocks"]["status"] == "Ready"
    assert groups["Blocks"]["folder_path"] == "Routes / Blocks"
    assert groups["Blocks"]["counts"] == {"lines": 0, "areas": 1, "points": 0}
    members = groups["Blocks"]["member_site_ids"]
    assert sites["inside"] in members
    assert sites["outside"] not in members
    assert "geometry" not in groups["Blocks"]["elements"][0]
    assert groups["INSIDE"]["default_target"] == "site"
    assert groups["INSIDE"]["default_target_id"] == sites["inside"]
    assert groups["Unknown"]["default_target"] == "skip"
    assert groups["Unknown"]["status"] == "Needs review"
    assert groups["Unknown"]["reason"] == "pick a target"
    assert groups["Far"]["status"] == "Needs review"
    assert groups["Far"]["reason"] == "outside Malaysia"


def apply(client, upload_id, **body):
    return client.post(f"{URL}/uploads/{upload_id}/apply", json=body)


def group_rows(db):
    sql = "SELECT name, segment_id, site_id, cluster_id, colour_mode FROM kmz_groups ORDER BY id"
    return [dict(row) for row in db.execute(text(sql)).mappings()]


def test_apply_to_segment_site_and_skip(client, db, admin, segments, sites):
    upload_id, _ = preview(client)
    response = apply(client, upload_id, route_segment_ids=[], groups=[
        {"key": "0/0", "target": "segment", "target_id": segments[0], "colour_mode": "kmz"},
        {"key": "1", "target": "site", "target_id": sites["inside"]},
        {"key": "2", "target": "skip"},
    ])
    assert response.status_code == 200
    assert response.json() == {"upload_id": upload_id, "shaped": 0, "groups_saved": 2, "clusters_created": 0}
    rows = group_rows(db)
    assert [row["name"] for row in rows] == ["Blocks", "INSIDE"]
    assert rows[0]["segment_id"] == segments[0]
    assert rows[0]["colour_mode"] == "kmz"
    assert rows[1]["site_id"] == sites["inside"]
    assert rows[1]["colour_mode"] == "theme"
    assert one(db, "SELECT count(*) FROM kmz_elements") == 2
    assert one(db, "SELECT ST_GeometryType(geom) FROM kmz_elements WHERE kind = 'area'") == "ST_Polygon"
    edits = db.execute(text("SELECT entity, field, upload_id FROM data_edits WHERE entity = 'kmz_group'")).all()
    assert len(edits) == 2
    assert all(edit.field == "created" and edit.upload_id == upload_id for edit in edits)
    assert one(db, "SELECT count(*) FROM routes WHERE geom IS NOT NULL") == 0  # route_segment_ids=[]


def test_apply_new_cluster_with_members_and_existing_cluster(client, db, admin, segments, sites):
    upload_id, groups = preview(client)
    members = [sites["inside"]]
    response = apply(client, upload_id, groups=[
        {"key": "0/0", "target": "cluster", "new_cluster_name": " Alpha ", "member_site_ids": members},
        {"key": "1", "target": "cluster", "new_cluster_name": "alpha"},
    ])
    assert response.status_code == 200
    assert response.json()["clusters_created"] == 1
    assert response.json()["shaped"] == 1  # no body list: every route line, as before
    cluster_id = one(db, "SELECT id FROM clusters WHERE name = 'Alpha'")
    assert one(db, "SELECT count(*) FROM kmz_groups WHERE cluster_id = :c", c=cluster_id) == 2
    assert one(db, "SELECT site_id FROM cluster_sites WHERE cluster_id = :c", c=cluster_id) == sites["inside"]
    sql = "SELECT entity, field FROM data_edits WHERE entity = 'cluster' AND upload_id = :u ORDER BY id"
    fields = db.execute(text(sql), {"u": upload_id}).all()
    assert [tuple(row) for row in fields] == [("cluster", "created"), ("cluster", "site_added")]

    second_id, _ = preview(client)
    existing = apply(client, second_id, route_segment_ids=[], groups=[
        {"key": "0/0", "target": "cluster", "target_id": cluster_id, "member_site_ids": members}])
    assert existing.status_code == 200
    assert existing.json()["clusters_created"] == 0
    assert one(db, "SELECT count(*) FROM cluster_sites") == 1  # already a member: no duplicate, no second edit
    assert one(db, "SELECT count(*) FROM data_edits WHERE field = 'site_added'") == 1


def test_duplicate_cluster_name_is_409_and_nothing_saved(client, db, admin, segments, sites):
    one(db, "INSERT INTO clusters (name, created_by) VALUES ('Taken', (SELECT id FROM users LIMIT 1)) RETURNING id")
    upload_id, _ = preview(client)
    response = apply(client, upload_id, groups=[
        {"key": "1", "target": "site", "target_id": sites["inside"]},
        {"key": "0/0", "target": "cluster", "new_cluster_name": "TAKEN"},
    ])
    assert response.status_code == 409
    assert one(db, "SELECT count(*) FROM kmz_groups") == 0
    assert one(db, "SELECT count(*) FROM routes WHERE geom IS NOT NULL") == 0


@pytest.mark.parametrize("choice", [
    {"key": "9", "target": "site", "target_id": 1},
    {"key": "1", "target": "site"},
    {"key": "1", "target": "site", "target_id": 99999},
    {"key": "1", "target": "cluster"},
    {"key": "1", "target": "cluster", "target_id": 1, "new_cluster_name": "x"},
    {"key": "1", "target": "other"},
    {"key": "1", "target": "skip", "colour_mode": "blue"},
    {"key": "3", "target": "site", "target_id": 1},  # outside Malaysia
])
def test_bad_choices_are_422(client, db, admin, segments, sites, choice):
    upload_id, _ = preview(client)
    assert apply(client, upload_id, groups=[choice]).status_code == 422
    assert one(db, "SELECT count(*) FROM kmz_groups") == 0


def test_route_lines_stay_out_of_groups_and_replacing_is_logged(client, db, admin, segments, sites):
    upload_id, groups = preview(client)
    assert all(element["name"] != "EJH1-RINI" for group in groups.values() for element in group["elements"])
    assert apply(client, upload_id).status_code == 200  # no body: today's behaviour
    assert one(db, "SELECT count(*) FROM kmz_groups") == 0
    assert one(db, "SELECT count(*) FROM data_edits WHERE field = 'route_line'") == 0  # first line, nothing replaced

    second_id, _ = preview(client)
    assert apply(client, second_id).status_code == 200
    edit = db.execute(text("SELECT entity_id, old_value, new_value, upload_id FROM data_edits "
                           "WHERE field = 'route_line'")).one()
    assert edit.entity_id == segments[0]
    assert json.loads(edit.old_value)["type"] == "LineString"
    assert edit.new_value == f"kmz upload #{second_id}"
    assert edit.upload_id == second_id


def test_nothing_chosen_is_409(client, db, admin, segments, sites):
    upload_id, _ = preview(client)
    assert apply(client, upload_id, route_segment_ids=[], groups=[{"key": "2", "target": "skip"}]).status_code == 409


def test_cluster_list(client, db, admin):
    assert client.get(f"{URL}/clusters").json() == []
    one(db, "INSERT INTO clusters (name, created_by) VALUES ('Beta', (SELECT id FROM users LIMIT 1)) RETURNING id")
    one(db, "INSERT INTO clusters (name, created_by) VALUES ('Alpha', (SELECT id FROM users LIMIT 1)) RETURNING id")
    assert [cluster["name"] for cluster in client.get(f"{URL}/clusters").json()] == ["Alpha", "Beta"]
