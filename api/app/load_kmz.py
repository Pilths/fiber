"""Draw road-shaped segment lines from a Google Earth KMZ.

    docker compose exec api python -m app.load_kmz USERNAME data/file.kmz [--folder "propose route"]

Put the file in api/data/ (git-ignored). Only the lines of one KML folder are read (default "propose route");
site points, existing infrastructure and distance folders are ignored. Lines are matched to segments by their
title AAAA-BBBB (two site names); pieces with the same title are joined into one line. A title that is not a
site pair, or a pair with no segment, is skipped and reported. Safe to run again: the shape of a segment is
updated, not duplicated.
"""
import argparse
import json
import math
import sys
import zipfile
from typing import BinaryIO
from xml.etree import ElementTree

from sqlalchemy import text
from sqlalchemy.orm import Session

from app.db import engine
from app.ingest.checks import split_nodes

EARTH_RADIUS_M = 6_371_000
MALAYSIA_LON = (99.5, 119.5)
MALAYSIA_LAT = (0.8, 7.5)

USER_SQL = "SELECT id FROM users WHERE username = :username AND active"
SEGMENTS_SQL = """
SELECT s.id, s.distance_km, s.site_a_id, s.site_b_id, a.name AS a_name, b.name AS b_name,
       ST_X(a.geom) AS a_lon, ST_Y(a.geom) AS a_lat, ST_X(b.geom) AS b_lon, ST_Y(b.geom) AS b_lat
FROM segments s
JOIN sites a ON a.id = s.site_a_id
JOIN sites b ON b.id = s.site_b_id
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


TitledLine = tuple[str, list[tuple[float, float]]]  # (Placemark title, vertices)


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


def placemark_title(placemark: ElementTree.Element) -> str:
    for child in placemark:
        if local_tag(child) == "name":
            return (child.text or "").strip()
    return ""


def lines_in_folder(folder: ElementTree.Element) -> list[TitledLine]:
    """Every LineString under the folder with the title of its Placemark ("" if it has none)."""
    lines: list[TitledLine] = []

    def collect(parent: ElementTree.Element, title: str) -> None:
        for child in parent:
            tag = local_tag(child)
            if tag == "Placemark":
                collect(child, placemark_title(child))
            elif tag == "LineString":
                for part in child:
                    if local_tag(part) == "coordinates":
                        vertices = parse_coordinates(part.text or "")
                        if len(vertices) >= 2:
                            lines.append((title, vertices))
            else:
                collect(child, title)

    collect(folder, "")
    return lines


def parse_lines(source: str | BinaryIO, folder: str) -> tuple[list[TitledLine], list[str]]:
    """Lines of every folder named `folder`, and all folder names found (to help when none matches).
    A blank `folder`, or a file with no folders at all, reads every line in the file."""
    wanted = folder.strip().lower()
    root = read_kml_root(source)
    names: list[str] = []
    lines: list[TitledLine] = []

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


def child_folders(parent: ElementTree.Element) -> list[ElementTree.Element]:
    """Folders directly under `parent`; other wrappers (Document) are walked through."""
    found = []
    for child in parent:
        if local_tag(child) == "Folder":
            found.append(child)
        else:
            found.extend(child_folders(child))
    return found


def folder_nodes(root: ElementTree.Element) -> dict[str, ElementTree.Element]:
    """Every Folder by id: its index among its sibling Folders, joined by "/" ("0", "0/2")."""
    nodes: dict[str, ElementTree.Element] = {}

    def walk(parent: ElementTree.Element, prefix: str) -> None:
        for index, folder in enumerate(child_folders(parent)):
            folder_id = f"{prefix}{index}"
            nodes[folder_id] = folder
            walk(folder, f"{folder_id}/")

    walk(root, "")
    return nodes


def folder_tree(source: str | BinaryIO) -> tuple[list[dict], int]:
    """Folder tree with line counts, and the number of lines outside any folder."""
    root = read_kml_root(source)

    def build(parent: ElementTree.Element, prefix: str) -> list[dict]:
        nodes = []
        for index, folder in enumerate(child_folders(parent)):
            folder_id = f"{prefix}{index}"
            nodes.append({
                "id": folder_id,
                "name": folder_name(folder),
                "lines": len(lines_in_folder(folder)),
                "children": build(folder, f"{folder_id}/"),
            })
        return nodes

    tree = build(root, "")
    in_folders = sum(node["lines"] for node in tree)
    return tree, len(lines_in_folder(root)) - in_folders


def lines_in_folder_ids(
    source: str | BinaryIO, ids: list[str]
) -> tuple[list[TitledLine], list[str]]:
    """Lines of the selected folders (a selected child of a selected folder is not counted twice)
    and their names. Raises ValueError for an unknown id."""
    nodes = folder_nodes(read_kml_root(source))
    unknown = [folder_id for folder_id in ids if folder_id not in nodes]
    if unknown:
        raise ValueError(f"unknown folder id {unknown[0]}")
    selected = set(ids)
    lines: list[TitledLine] = []
    names: list[str] = []
    for folder_id in sorted(selected):
        ancestors = {folder_id.rsplit("/", depth)[0] for depth in range(1, folder_id.count("/") + 1)}
        if ancestors & selected:
            continue
        lines.extend(lines_in_folder(nodes[folder_id]))
        names.append(folder_name(nodes[folder_id]))
    return lines, names


def inside_malaysia(coords: list[list[float]]) -> bool:
    for lon, lat in coords:
        if not (MALAYSIA_LON[0] <= lon <= MALAYSIA_LON[1] and MALAYSIA_LAT[0] <= lat <= MALAYSIA_LAT[1]):
            return False
    return True


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


def pair_from_title(title: str) -> tuple[str, str] | None:
    parts = split_nodes(title.strip().upper())
    if parts is None:
        return None
    return parts[0], parts[1]


def end_distance(vertices: list[tuple[float, float]], point: tuple[float, float]) -> float:
    return min(haversine_m(vertices[0], point), haversine_m(vertices[-1], point))


def join_pieces(pieces: list[list[tuple[float, float]]], start_near) -> list[tuple[float, float]]:
    """Greedy chain: first the piece nearest `start_near` (or the first piece), then always the
    remaining piece whose nearer end is closest to the end of the path."""
    remaining = list(pieces)
    if start_near is None:
        first = remaining.pop(0)
    else:
        first = min(remaining, key=lambda piece: end_distance(piece, start_near))
        remaining.remove(first)
        if haversine_m(first[-1], start_near) < haversine_m(first[0], start_near):
            first = first[::-1]
    path = list(first)
    while remaining:
        end = path[-1]
        nearest = min(remaining, key=lambda piece: end_distance(piece, end))
        remaining.remove(nearest)
        if haversine_m(nearest[-1], end) < haversine_m(nearest[0], end):
            nearest = nearest[::-1]
        if nearest[0] == end:
            nearest = nearest[1:]
        path.extend(nearest)
    return path


def point_of(segment, side: str) -> tuple[float, float] | None:
    if segment[f"{side}_lon"] is None or segment[f"{side}_lat"] is None:
        return None
    return (segment[f"{side}_lon"], segment[f"{side}_lat"])


def orient_a_to_b(path: list[tuple[float, float]], site_a) -> list[tuple[float, float]]:
    if site_a is None:
        return path
    if haversine_m(path[0], site_a) > haversine_m(path[-1], site_a):
        return path[::-1]
    return path


def group_by_title(lines: list[TitledLine]) -> tuple[dict, list[dict]]:
    """Pieces per unordered site pair, and one skipped row per distinct bad title."""
    pieces_by_pair: dict[frozenset, list] = {}
    bad_titles: dict[str, int] = {}
    for title, vertices in lines:
        pair = pair_from_title(title)
        if pair is None:
            bad_titles[title] = bad_titles.get(title, 0) + 1
            continue
        pieces_by_pair.setdefault(frozenset(pair), []).append(vertices)
    skipped = []
    for title, count in bad_titles.items():
        reason = f'title "{title}" is not a site pair like AAAA-BBBB'
        if count > 1:
            reason += f" ({count} lines)"
        skipped.append({"segment_id": None, "name": title or "(no title)", "reason": reason})
    return pieces_by_pair, skipped


def compute_shapes(db: Session, lines: list[TitledLine]) -> dict:
    """Shapes for the segments named by line titles. Saves nothing."""
    pieces_by_pair, skipped = group_by_title(lines)
    segments = {}
    for segment in db.execute(text(SEGMENTS_SQL)).mappings():
        segments[frozenset((segment["a_name"].upper(), segment["b_name"].upper()))] = segment
    shaped = []
    for pair, pieces in pieces_by_pair.items():
        segment = segments.get(pair)
        if segment is None:
            first, second = sorted(pair)
            label = f"{first}-{second}"
            skipped.append({"segment_id": None, "name": label, "reason": f"no segment {label} in the dashboard"})
            continue
        name = f"{segment['a_name']} - {segment['b_name']}"
        site_a = point_of(segment, "a")
        path = orient_a_to_b(join_pieces(pieces, site_a), site_a)
        coords = [list(point) for point in path]
        if not inside_malaysia(coords):
            skipped.append({"segment_id": segment["id"], "name": name, "reason": "outside Malaysia"})
            continue
        km = sum(haversine_m(first, second) for first, second in zip(path, path[1:])) / 1000
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
    return {"shaped": shaped, "skipped": skipped}


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
    print_report(len(lines), shaped, result["skipped"])
    return 0


def print_report(line_count: int, shaped: list, skipped: list) -> None:
    print(f"Lines read: {line_count}")
    for item in shaped:
        excel = "none" if item["excel_km"] is None else f"{item['excel_km']:.2f} km"
        print(f"{item['name']}: {item['km']:.2f} km drawn (Excel {excel})")
    for item in skipped:
        print(f"Skipped {item['name']}: {item['reason']}")


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
