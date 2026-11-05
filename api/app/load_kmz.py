"""Draw road-shaped segment lines from a Google Earth KMZ.

    docker compose exec api python -m app.load_kmz USERNAME data/file.kmz [--folder "propose route"]

Put the file in api/data/ (git-ignored). Only the lines of one KML folder are read (default "propose route");
site points, existing infrastructure and distance folders are ignored, and so are line names. A segment gets
its shape from the shortest path over the drawn lines between its two sites, so lines are matched to segments
by where their ends are. Safe to run again: the shape of a segment is updated, not duplicated.
"""
import argparse
import json
import math
import sys
import xml.etree.ElementTree as ElementTree
import zipfile
from typing import BinaryIO

import networkx
from sqlalchemy import text
from sqlalchemy.orm import Session

from app.db import engine

# ponytail: hand-tuned for hand-drawn Google Earth paths (spurs end near, not on, the highway);
# change per file
SNAP_M = 50  # a dangling line end this close to another line is joined to it
SITE_M = 300  # a site this close to a line is attached to it
PATH_FACTOR = 3  # a path longer than this times the straight line between the sites is not a real route
EARTH_RADIUS_M = 6_371_000
MALAYSIA_LON = (99.5, 119.5)
MALAYSIA_LAT = (0.8, 7.5)

USER_SQL = "SELECT id FROM users WHERE username = :username AND active"
SEGMENTS_SQL = """
SELECT s.id, s.distance_km, s.site_a_id, s.site_b_id, a.name AS a_name, b.name AS b_name,
       ST_X(a.geom) AS a_lon, ST_Y(a.geom) AS a_lat, ST_X(b.geom) AS b_lon, ST_Y(b.geom) AS b_lat
FROM segments s
JOIN sites a ON a.id = s.site_a_id AND a.geom IS NOT NULL
JOIN sites b ON b.id = s.site_b_id AND b.geom IS NOT NULL
ORDER BY s.id
"""
OWN_ROUTE_SQL = """
SELECT r.id FROM routes r
JOIN route_segments rs ON rs.route_id = r.id AND rs.segment_id = :segment_id
WHERE NOT EXISTS (
    SELECT 1 FROM route_segments other WHERE other.route_id = r.id AND other.segment_id <> :segment_id
)
ORDER BY r.id LIMIT 1
"""
OWN_SHAPE_SQL = """
SELECT 1 FROM routes r
JOIN route_segments rs ON rs.route_id = r.id AND rs.segment_id = :segment_id
WHERE r.geom IS NOT NULL
AND NOT EXISTS (
    SELECT 1 FROM route_segments other WHERE other.route_id = r.id AND other.segment_id <> :segment_id
)
LIMIT 1
"""
SEGMENT_BY_ID_SQL = "SELECT id, site_a_id, site_b_id FROM segments WHERE id = :segment_id"
UPDATE_ROUTE_SQL = """
UPDATE routes SET geom = ST_SetSRID(ST_GeomFromGeoJSON(:geojson), 4326) WHERE id = :route_id
"""
INSERT_ROUTE_SQL = """
INSERT INTO routes (site_a_id, site_b_id, geom)
VALUES (:site_a_id, :site_b_id, ST_SetSRID(ST_GeomFromGeoJSON(:geojson), 4326)) RETURNING id
"""
INSERT_ROUTE_SEGMENT_SQL = """
INSERT INTO route_segments (route_id, segment_id, position) VALUES (:route_id, :segment_id, 1)
"""
INSERT_UPLOAD_SQL = """
INSERT INTO uploads (user_id, filename, kind, status, summary, confirmed_at)
VALUES (:user_id, :filename, 'kmz', 'confirmed', CAST(:summary AS jsonb), now())
"""


def vertex_key(lon: float, lat: float) -> tuple[float, float]:
    return (round(lon, 7), round(lat, 7))


def haversine_m(first: tuple[float, float], second: tuple[float, float]) -> float:
    lat_first = math.radians(first[1])
    lat_second = math.radians(second[1])
    delta_lat = lat_second - lat_first
    delta_lon = math.radians(second[0] - first[0])
    half = (
        math.sin(delta_lat / 2) ** 2
        + math.cos(lat_first) * math.cos(lat_second) * math.sin(delta_lon / 2) ** 2
    )
    return 2 * EARTH_RADIUS_M * math.asin(math.sqrt(half))


def local_tag(element: ElementTree.Element) -> str:
    return element.tag.rsplit("}", 1)[-1]


def folder_name(folder: ElementTree.Element) -> str:
    for child in folder:
        if local_tag(child) == "name":
            return (child.text or "").strip()
    return ""


def read_kml_root(source: str | BinaryIO) -> ElementTree.Element:
    """`source` is a path or an open binary file."""
    try:
        with zipfile.ZipFile(source) as archive:
            kml_names = [name for name in archive.namelist() if name.lower().endswith(".kml")]
            if not kml_names:
                raise ValueError("no .kml inside the KMZ")
            chosen = "doc.kml" if "doc.kml" in kml_names else kml_names[0]
            return ElementTree.fromstring(archive.read(chosen))
    except (zipfile.BadZipFile, ElementTree.ParseError) as error:
        raise ValueError(f"not a valid KMZ ({error})") from error


def parse_coordinates(coordinates_text: str) -> list[tuple[float, float]]:
    vertices: list[tuple[float, float]] = []
    for token in coordinates_text.split():
        parts = token.split(",")
        if len(parts) < 2:
            continue
        key = vertex_key(float(parts[0]), float(parts[1]))
        if vertices and vertices[-1] == key:
            continue
        vertices.append(key)
    return vertices


def lines_in_folder(folder: ElementTree.Element) -> list[list[tuple[float, float]]]:
    lines = []
    for element in folder.iter():
        if local_tag(element) != "LineString":
            continue
        for child in element:
            if local_tag(child) == "coordinates":
                vertices = parse_coordinates(child.text or "")
                if len(vertices) >= 2:
                    lines.append(vertices)
    return lines


def parse_lines(source: str | BinaryIO, folder: str) -> tuple[list[list[tuple[float, float]]], list[str]]:
    """Lines of every folder named `folder`, and all folder names found (to help when none matches).
    A blank `folder`, or a file with no folders at all, reads every line in the file."""
    wanted = folder.strip().lower()
    root = read_kml_root(source)
    names: list[str] = []
    lines: list[list[tuple[float, float]]] = []

    def walk(parent: ElementTree.Element) -> None:
        for child in parent:
            if local_tag(child) != "Folder":
                walk(child)
                continue
            name = folder_name(child)
            names.append(name)
            if name.lower() == wanted:
                lines.extend(lines_in_folder(child))
            else:
                walk(child)

    if not wanted:
        return lines_in_folder(root), names
    walk(root)
    if not names:
        return lines_in_folder(root), names
    return lines, names


def build_graph(lines: list[list[tuple[float, float]]]) -> networkx.Graph:
    graph = networkx.Graph()
    for line_index, vertices in enumerate(lines):
        for first, second in zip(vertices, vertices[1:]):
            graph.add_edge(first, second, weight=haversine_m(first, second), line=line_index)
    return graph


def distance_to_edge(point: tuple[float, float], first: tuple[float, float], second: tuple[float, float]):
    """(metres, nearest point) from `point` to the edge, projected in local equirectangular metres."""
    metres_per_degree = EARTH_RADIUS_M * math.pi / 180
    lon_scale = math.cos(math.radians(point[1])) * metres_per_degree
    first_x = (first[0] - point[0]) * lon_scale
    first_y = (first[1] - point[1]) * metres_per_degree
    delta_x = (second[0] - first[0]) * lon_scale
    delta_y = (second[1] - first[1]) * metres_per_degree
    length_squared = delta_x ** 2 + delta_y ** 2
    fraction = 0.0
    if length_squared > 0:
        fraction = -(first_x * delta_x + first_y * delta_y) / length_squared
    fraction = max(0.0, min(1.0, fraction))
    metres = math.hypot(first_x + fraction * delta_x, first_y + fraction * delta_y)
    nearest = vertex_key(
        first[0] + fraction * (second[0] - first[0]),
        first[1] + fraction * (second[1] - first[1]),
    )
    return metres, nearest


def nearest_on_lines(graph: networkx.Graph, point: tuple[float, float], skip_line: int | None = None):
    """(metres, edge first, edge second, nearest point) over drawn line edges, or None."""
    best = None
    for first, second, data in graph.edges(data=True):
        if data["line"] is None or data["line"] == skip_line:
            continue
        metres, nearest = distance_to_edge(point, first, second)
        if best is None or metres < best[0]:
            best = (metres, first, second, nearest)
    return best


def split_edge(graph: networkx.Graph, first: tuple, second: tuple, point: tuple) -> tuple:
    """Make `point` a node of the graph; returns it."""
    if point in (first, second):
        return point
    line_index = graph.edges[first, second]["line"]
    graph.remove_edge(first, second)
    graph.add_edge(first, point, weight=haversine_m(first, point), line=line_index)
    graph.add_edge(point, second, weight=haversine_m(point, second), line=line_index)
    return point


def snap_dangling_ends(graph: networkx.Graph, lines: list[list[tuple[float, float]]]) -> None:
    dangling = []
    for line_index, vertices in enumerate(lines):
        for end in (vertices[0], vertices[-1]):
            if graph.degree(end) == 1:
                dangling.append((line_index, end))
    for line_index, end in dangling:
        found = nearest_on_lines(graph, end, skip_line=line_index)
        if found is None or found[0] > SNAP_M:
            continue
        _, first, second, nearest = found
        junction = split_edge(graph, first, second, nearest)
        if junction != end:
            graph.add_edge(end, junction, weight=haversine_m(end, junction), line=None)


def attach_site(graph: networkx.Graph, attached: dict, site_id: int, lon: float, lat: float):
    """Join the site to the nearest line within SITE_M; once per site. Returns its node or None."""
    if site_id in attached:
        return attached[site_id]
    node = None
    site_point = (lon, lat)
    found = nearest_on_lines(graph, site_point)
    if found is not None and found[0] <= SITE_M:
        _, first, second, nearest = found
        junction = split_edge(graph, first, second, nearest)
        node = ("site", site_id)
        graph.add_node(node, point=site_point)
        graph.add_edge(node, junction, weight=haversine_m(site_point, junction), line=None)
    attached[site_id] = node
    return node


def node_point(graph: networkx.Graph, node: tuple) -> tuple[float, float]:
    return graph.nodes[node].get("point", node)


def inside_malaysia(coords: list[list[float]]) -> bool:
    for lon, lat in coords:
        if not (MALAYSIA_LON[0] <= lon <= MALAYSIA_LON[1] and MALAYSIA_LAT[0] <= lat <= MALAYSIA_LAT[1]):
            return False
    return True


def segment_shape(graph: networkx.Graph, node_a: tuple, node_b: tuple):
    """(coords site A -> site B, drawn km, None) or (None, None, reason)."""
    try:
        path = networkx.shortest_path(graph, node_a, node_b, weight="weight")
    except networkx.NetworkXNoPath:
        return None, None, "not connected"
    length_m = networkx.path_weight(graph, path, weight="weight")
    straight_m = haversine_m(node_point(graph, node_a), node_point(graph, node_b))
    if length_m > PATH_FACTOR * straight_m:
        return None, None, "path too long"
    coords: list[list[float]] = []
    for node in path:
        point = list(node_point(graph, node))
        if not coords or coords[-1] != point:
            coords.append(point)
    if not inside_malaysia(coords):
        return None, None, "outside Malaysia"
    return coords, length_m / 1000, None


def save_shape(db: Session, segment, coords: list[list[float]]) -> None:
    geojson = json.dumps({"type": "LineString", "coordinates": coords})
    route_id = db.execute(text(OWN_ROUTE_SQL), {"segment_id": segment["id"]}).scalar()
    if route_id is not None:
        db.execute(text(UPDATE_ROUTE_SQL), {"geojson": geojson, "route_id": route_id})
        return
    route_id = db.execute(
        text(INSERT_ROUTE_SQL),
        {"site_a_id": segment["site_a_id"], "site_b_id": segment["site_b_id"], "geojson": geojson},
    ).scalar_one()
    db.execute(text(INSERT_ROUTE_SEGMENT_SQL), {"route_id": route_id, "segment_id": segment["id"]})


def compute_shapes(db: Session, lines: list[list[tuple[float, float]]]) -> dict:
    """Shapes for every segment whose two sites are near the lines. Saves nothing."""
    graph = build_graph(lines)
    snap_dangling_ends(graph, lines)
    attached: dict = {}
    site_names: dict[int, str] = {}
    shaped = []
    skipped = []
    for segment in db.execute(text(SEGMENTS_SQL)).mappings():
        node_a = attach_site(graph, attached, segment["site_a_id"], segment["a_lon"], segment["a_lat"])
        node_b = attach_site(graph, attached, segment["site_b_id"], segment["b_lon"], segment["b_lat"])
        site_names[segment["site_a_id"]] = segment["a_name"]
        site_names[segment["site_b_id"]] = segment["b_name"]
        if node_a is None or node_b is None:
            continue
        name = f"{segment['a_name']} - {segment['b_name']}"
        coords, km, reason = segment_shape(graph, node_a, node_b)
        if coords is None:
            skipped.append({"segment_id": segment["id"], "name": name, "reason": reason})
            continue
        excel_km = float(segment["distance_km"]) if segment["distance_km"] is not None else None
        had_shape = db.execute(text(OWN_SHAPE_SQL), {"segment_id": segment["id"]}).first() is not None
        shaped.append(
            {
                "segment_id": segment["id"],
                "name": name,
                "km": round(km, 2),
                "excel_km": excel_km,
                "had_shape": had_shape,
                "coords": coords,
            }
        )
    sites_attached = [site_names[site_id] for site_id, node in attached.items() if node is not None]
    return {"shaped": shaped, "skipped": skipped, "sites_attached": sites_attached}


def run(db: Session, username: str, path: str, folder: str) -> int:
    user_id = db.execute(text(USER_SQL), {"username": username}).scalar()
    if user_id is None:
        print(f"User '{username}' not found or not active.")
        return 1
    try:
        lines, folder_names = parse_lines(path, folder)
    except ValueError as error:
        print(error)
        return 1
    if not lines:
        found = ", ".join(folder_names) or "none"
        print(f"No lines found in folder '{folder}'. Folders in the file: {found}")
        return 1
    result = compute_shapes(db, lines)
    for item in result["shaped"]:
        segment = db.execute(text(SEGMENT_BY_ID_SQL), {"segment_id": item["segment_id"]}).mappings().one()
        save_shape(db, segment, item["coords"])
    shaped = [{key: value for key, value in item.items() if key != "coords"} for item in result["shaped"]]
    summary = {"shaped": shaped, "skipped": result["skipped"]}
    upload = {"user_id": user_id, "filename": path.rsplit("/", 1)[-1], "summary": json.dumps(summary)}
    db.execute(text(INSERT_UPLOAD_SQL), upload)
    db.commit()
    print_report(len(lines), shaped, result["skipped"], result["sites_attached"])
    return 0


def print_report(line_count: int, shaped: list, skipped: list, attached_names: list[str]) -> None:
    print(f"Lines read: {line_count}")
    for item in shaped:
        excel = "none" if item["excel_km"] is None else f"{item['excel_km']:.2f} km"
        print(f"{item['name']}: {item['km']:.2f} km drawn (Excel {excel})")
    for item in skipped:
        print(f"Skipped {item['name']}: {item['reason']}")
    print(f"Sites attached: {', '.join(attached_names) or 'none'}")


def main(argv: list[str]) -> int:
    parser = argparse.ArgumentParser(description="Draw segment shapes from a KMZ file")
    parser.add_argument("username")
    parser.add_argument("kmz_path")
    parser.add_argument("--folder", default="propose route")
    args = parser.parse_args(argv)
    with Session(engine) as db:
        return run(db, args.username, args.kmz_path, args.folder)


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
