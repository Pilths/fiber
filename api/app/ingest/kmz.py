"""KMZ route lines: read a KMZ, match its lines to segments, preview, apply.

Used by the Upload tab (kmz_router.py) and by the command `python -m app.load_kmz` (load_kmz.py).
Only the lines of one KML folder are read (default "propose route"). Lines are matched to segments by their
title AAAA-BBBB (two site names); pieces with the same title are joined into one line. Segments are never created.

Other elements (points, lines, areas) are read per folder into groups (see kmz_groups.py for what happens to them).
"""
import io
import json
import math
import zipfile
from typing import BinaryIO
from xml.etree import ElementTree

from sqlalchemy import text
from sqlalchemy.orm import Session

from app.ingest.checks import split_nodes
from app.admin_edits.history import log_edits_for_user
from app.ingest import kmz_groups
from app.ingest.uploads import ApplyError, finish_upload, insert_upload, lock_staged_upload

MAX_KML_BYTES = 50 * 1024 * 1024  # unpacked size of the KML inside the KMZ
DEFAULT_FOLDER = "propose route"
TOO_LARGE_TEXT = "the KML inside is larger than 50 MB"
EARTH_RADIUS_M = 6_371_000
MALAYSIA_LON = (99.5, 119.5)
MALAYSIA_LAT = (0.8, 7.5)

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
OLD_SHAPE_SQL = "SELECT ST_AsGeoJSON(geom) FROM routes WHERE id = :route_id AND geom IS NOT NULL"
INSERT_ROUTE_SQL = """
INSERT INTO routes (site_a_id, site_b_id, geom)
VALUES (:site_a_id, :site_b_id, ST_SetSRID(ST_GeomFromGeoJSON(:geojson), 4326)) RETURNING id
"""
INSERT_ROUTE_SEGMENT_SQL = """
INSERT INTO route_segments (route_id, segment_id, position) VALUES (:route_id, :segment_id, 1)
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
            if archive.getinfo(chosen).file_size > MAX_KML_BYTES:
                raise ValueError(TOO_LARGE_TEXT)
            with archive.open(chosen) as kml_file:
                kml_bytes = kml_file.read(MAX_KML_BYTES + 1)  # the size in the header can lie
            if len(kml_bytes) > MAX_KML_BYTES:
                raise ValueError(TOO_LARGE_TEXT)
            return ElementTree.fromstring(kml_bytes)
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
                **subtree_counts(folder),
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


def subtree_counts(folder: ElementTree.Element) -> dict[str, int]:
    """Areas and points anywhere under the folder, child folders included (same meaning as "lines")."""
    counts = {"areas": 0, "points": 0}
    for placemark in folder.iter():
        if local_tag(placemark) != "Placemark":
            continue
        shapes = placemark_shapes(placemark)
        counts["areas"] += len(shapes["area"])
        counts["points"] += len(shapes["point"])
    return counts


def coordinates_text(parent: ElementTree.Element) -> str:
    for node in parent.iter():
        if local_tag(node) == "coordinates":
            return node.text or ""
    return ""


def closed_ring(vertices: list[tuple[float, float]]) -> list[list[float]] | None:
    """A ring needs 4 vertices with the first repeated at the end; an open ring is closed. None if too short."""
    if len(vertices) < 3:
        return None
    if vertices[0] != vertices[-1]:
        vertices = vertices + [vertices[0]]
    if len(vertices) < 4:
        return None
    return [list(vertex) for vertex in vertices]


def polygon_rings(polygon: ElementTree.Element) -> list[list[list[float]]]:
    """Outer ring first, then the holes. Empty when the outer ring is not usable."""
    outer = None
    holes = []
    for boundary in polygon:
        tag = local_tag(boundary)
        if tag not in ("outerBoundaryIs", "innerBoundaryIs"):
            continue
        ring = closed_ring(parse_coordinates(coordinates_text(boundary)))
        if ring is None:
            continue
        if tag == "outerBoundaryIs":
            outer = ring
        else:
            holes.append(ring)
    if outer is None:
        return []
    return [outer] + holes


def collect_shapes(parent: ElementTree.Element, shapes: dict[str, list]) -> None:
    for child in parent:
        tag = local_tag(child)
        if tag == "Point":
            vertices = parse_coordinates(coordinates_text(child))
            if vertices:
                shapes["point"].append(list(vertices[0]))
        elif tag == "LineString":
            vertices = parse_coordinates(coordinates_text(child))
            if len(vertices) >= 2:
                shapes["line"].append([list(vertex) for vertex in vertices])
        elif tag == "LinearRing":
            ring = closed_ring(parse_coordinates(coordinates_text(child)))
            if ring is not None:
                shapes["area"].append([ring])
        elif tag == "Polygon":
            rings = polygon_rings(child)
            if rings:
                shapes["area"].append(rings)
        elif tag == "MultiGeometry":
            collect_shapes(child, shapes)


def placemark_shapes(placemark: ElementTree.Element) -> dict[str, list]:
    """Parts of one Placemark by kind: point = [lon, lat], line = vertices, area = [outer ring, *holes]."""
    shapes: dict[str, list] = {"point": [], "line": [], "area": []}
    collect_shapes(placemark, shapes)
    return shapes


def geojson_of(kind: str, parts: list) -> dict:
    names = {"point": "Point", "line": "LineString", "area": "Polygon"}
    if len(parts) == 1:
        return {"type": names[kind], "coordinates": parts[0]}
    return {"type": f"Multi{names[kind]}", "coordinates": parts}


def kml_colour(value: str) -> tuple[str, float] | None:
    """KML colour aabbggrr to ("#rrggbb", opacity 0..1)."""
    value = value.strip()
    if len(value) != 8:
        return None
    try:
        alpha, blue, green, red = (int(value[index:index + 2], 16) for index in (0, 2, 4, 6))
    except ValueError:
        return None
    return f"#{red:02x}{green:02x}{blue:02x}", round(alpha / 255, 2)


def child_text(parent: ElementTree.Element, tag: str) -> str | None:
    for child in parent:
        if local_tag(child) == tag:
            return (child.text or "").strip()
    return None


def style_from(style: ElementTree.Element) -> dict:
    """Only the keys the Style sets: line_colour, line_opacity, line_width, fill_colour, fill_opacity, fill, outline."""
    result: dict = {}
    for part in style:
        tag = local_tag(part)
        colour = kml_colour(child_text(part, "color") or "")
        if tag == "LineStyle":
            if colour is not None:
                result["line_colour"], result["line_opacity"] = colour
            width = child_text(part, "width")
            if width:
                result["line_width"] = float(width)
        elif tag == "PolyStyle":
            if colour is not None:
                result["fill_colour"], result["fill_opacity"] = colour
            for flag in ("fill", "outline"):
                flag_text = child_text(part, flag)
                if flag_text:
                    result[flag] = flag_text == "1"
    return result


def parse_styles(root: ElementTree.Element) -> dict[str, dict]:
    """Style by id. A StyleMap gets the style of its 'normal' pair."""
    styles: dict[str, dict] = {}
    normal_urls: dict[str, str] = {}
    for node in root.iter():
        node_id = node.get("id")
        if not node_id:
            continue
        tag = local_tag(node)
        if tag == "Style":
            styles[node_id] = style_from(node)
        elif tag == "StyleMap":
            for pair in node:
                if local_tag(pair) == "Pair" and child_text(pair, "key") == "normal":
                    normal_urls[node_id] = child_text(pair, "styleUrl") or ""
    for map_id, url in normal_urls.items():
        styles[map_id] = styles.get(url.rsplit("#", 1)[-1], {})
    return styles


def placemark_style(placemark: ElementTree.Element, styles: dict[str, dict]) -> dict:
    for child in placemark:
        if local_tag(child) == "Style":
            return style_from(child)
    url = child_text(placemark, "styleUrl")
    if url:
        return styles.get(url.rsplit("#", 1)[-1], {})
    return {}


def direct_placemarks(parent: ElementTree.Element) -> list[ElementTree.Element]:
    """Placemarks of a folder, also inside wrappers that are not Folders. Child Folders are not entered."""
    found = []
    for child in parent:
        tag = local_tag(child)
        if tag == "Placemark":
            found.append(child)
        elif tag != "Folder":
            found.extend(direct_placemarks(child))
    return found


def elements_in_folder(folder: ElementTree.Element, styles: dict[str, dict]) -> list[dict]:
    """The folder's own elements: {name, kind, geometry (GeoJSON dict), kmz_style}. A MultiGeometry gives one
    element per kind (several parts of a kind become one Multi* geometry). Altitude is dropped."""
    elements = []
    for placemark in direct_placemarks(folder):
        shapes = placemark_shapes(placemark)
        style = placemark_style(placemark, styles)
        for kind in ("point", "line", "area"):
            if shapes[kind]:
                elements.append({
                    "name": placemark_title(placemark),
                    "kind": kind,
                    "geometry": geojson_of(kind, shapes[kind]),
                    "kmz_style": style,
                })
    return elements


def flat_coordinates(coordinates) -> list[list[float]]:
    if coordinates and isinstance(coordinates[0], (int, float)):
        return [coordinates]
    flat = []
    for part in coordinates:
        flat.extend(flat_coordinates(part))
    return flat


def part_count(geometry: dict) -> int:
    if geometry["type"].startswith("Multi"):
        return len(geometry["coordinates"])
    return 1


def groups_in_folders(source: str | BinaryIO, folder_ids: list[str], route_pairs: set[frozenset]) -> list[dict]:
    """One group per selected folder and per folder below it, with its own elements. Lines titled with a site
    pair in `route_pairs` are route lines and are left out. A folder with no element left gives no group."""
    root = read_kml_root(source)
    nodes = folder_nodes(root)
    selected = set(folder_ids)
    styles = parse_styles(root)
    groups = []
    for folder_id, folder in nodes.items():
        parts = folder_id.split("/")
        chain = ["/".join(parts[:count]) for count in range(1, len(parts) + 1)]
        if not selected & set(chain):
            continue
        elements = []
        for element in elements_in_folder(folder, styles):
            pair = pair_from_title(element["name"])
            if element["kind"] == "line" and pair is not None and frozenset(pair) in route_pairs:
                continue
            elements.append(element)
        if not elements:
            continue
        counts = {"lines": 0, "areas": 0, "points": 0}
        outside = False
        for element in elements:
            counts[element["kind"] + "s"] += part_count(element["geometry"])
            if not inside_malaysia(flat_coordinates(element["geometry"]["coordinates"])):
                outside = True
        groups.append({
            "key": folder_id,
            "name": folder_name(folder),
            "folder_path": " / ".join(folder_name(nodes[prefix]) for prefix in chain),
            "counts": counts,
            "elements": elements,
            "outside_malaysia": outside,
        })
    return groups


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


def route_pairs_of(db: Session) -> set[frozenset]:
    """Site-name pairs (upper case) of every segment: a line titled with one of them is a route line."""
    pairs = set()
    for segment in db.execute(text(SEGMENTS_SQL)).mappings():
        pairs.add(frozenset((segment["a_name"].upper(), segment["b_name"].upper())))
    return pairs


def stage_preview(
    db: Session, admin_id: int, filename: str, data: bytes, folder: str, folder_ids: list[str]
) -> tuple[int, dict]:
    """Read the KMZ, compute the shapes and groups and store the preview in an uploads row.
    Groups are read only for selected folder ids. Raises ValueError for a bad file."""
    groups: list[dict] = []
    if folder_ids:
        lines, selected_names = lines_in_folder_ids(io.BytesIO(data), folder_ids)
        folder = ", ".join(selected_names)
        folders_found = selected_names
        raw_groups = groups_in_folders(io.BytesIO(data), folder_ids, route_pairs_of(db))
        groups = kmz_groups.describe_groups(db, raw_groups)
    else:
        lines, folders_found = parse_lines(io.BytesIO(data), folder)
    result = {"shaped": [], "skipped": []}
    block_reason = None
    if lines:
        result = compute_shapes(db, lines)
    elif not groups:
        found = ", ".join(folders_found) or "none"
        block_reason = f"No lines in folder '{folder}'. Folders in the file: {found}"
        if folder_ids:
            block_reason = "No lines in the selected folders."
    summary = {
        "filename": filename,
        "folder": folder,
        "folders_found": folders_found,
        "lines": len(lines),
        "block_reason": block_reason,
        "groups": groups,
        **result,
    }
    upload_id = insert_upload(db, admin_id, filename, "kmz", summary)
    db.commit()
    return upload_id, summary


def save_shape_logged(db: Session, admin_id: int, upload_id: int, segment, coords: list[list[float]]) -> None:
    """save_shape, and when it replaces a line the old line (GeoJSON text) goes to data_edits."""
    route_id = db.execute(text(OWN_ROUTE_SQL), {"segment_id": segment["id"]}).scalar()
    old_line = None
    if route_id is not None:
        old_line = db.execute(text(OLD_SHAPE_SQL), {"route_id": route_id}).scalar()
    save_shape(db, segment, coords)
    if old_line is not None:
        edit = ("route_line", old_line, f"kmz upload #{upload_id}")
        log_edits_for_user(db, admin_id, "segment", segment["id"], [edit], "", upload_id)


def apply_upload(
    db: Session,
    admin_id: int,
    upload_id: int,
    route_segment_ids: list[int] | None = None,
    group_choices: list[dict] | None = None,
) -> dict:
    """Save the previewed route lines (all, or only `route_segment_ids`) and the groups the admin chose.
    Returns {"shaped": n, "groups_saved": n, "clusters_created": n}."""
    upload = lock_staged_upload(db, upload_id, "kmz", "Already applied or discarded")
    summary = upload["summary"]
    choices = group_choices or []
    if summary["block_reason"]:
        raise ApplyError(409, summary["block_reason"])
    shaped = summary["shaped"]
    if route_segment_ids is not None:
        shaped = [item for item in shaped if item["segment_id"] in route_segment_ids]
    chosen_groups = kmz_groups.check_choices(db, summary.get("groups", []), choices)
    if not shaped and not chosen_groups:
        raise ApplyError(409, "Nothing to apply")
    saved = 0
    for item in shaped:
        segment = db.execute(text(SEGMENT_BY_ID_SQL), {"segment_id": item["segment_id"]}).mappings().first()
        if segment is None:
            continue
        save_shape_logged(db, admin_id, upload_id, segment, item["coords"])
        saved += 1
    groups_saved, clusters_created = kmz_groups.save_groups(db, admin_id, upload_id, chosen_groups)
    finish_upload(db, upload_id)
    db.commit()
    return {"shaped": saved, "groups_saved": groups_saved, "clusters_created": clusters_created}
