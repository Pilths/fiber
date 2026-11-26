"""KMZ route lines stored as drawn: each line is assigned to a segment by the admin. No joining, no cutting, no km.

A route line is a kmz_groups row with route = true (on a segment) holding one 'line' kmz_elements row. A segment may
have several. The preview lists every line with a suggestion from its title; suggest_by_location adds suggestions
from where the line ends lie. Nothing here is saved before apply.
"""
import json

from sqlalchemy import text
from sqlalchemy.orm import Session

from app.admin_edits.history import bool_text, log_edits_for_user
from app.errors import Invalid
from app.ingest.kmz_groups import INSERT_ELEMENT_SQL, target_must_exist
from app.ingest.kmz_segment_routes import line_statuses

NEAR_METRES = 200
# The segment whose two sites both lie within :near metres of the two line ends (either way round); the smaller
# summed distance wins.
NEAREST_SEGMENT_SQL = """
WITH ends AS (
    SELECT ST_SetSRID(ST_MakePoint(:first_lon, :first_lat), 4326)::geography AS first_end,
           ST_SetSRID(ST_MakePoint(:last_lon, :last_lat), 4326)::geography AS last_end
), distances AS (
    SELECT s.id,
           ST_Distance(a.geom::geography, e.first_end) AS a_first, ST_Distance(b.geom::geography, e.last_end) AS b_last,
           ST_Distance(a.geom::geography, e.last_end) AS a_last, ST_Distance(b.geom::geography, e.first_end) AS b_first
    FROM segments s JOIN sites a ON a.id = s.site_a_id JOIN sites b ON b.id = s.site_b_id, ends e
), totals AS (
    SELECT id, LEAST(
        CASE WHEN a_first <= :near AND b_last <= :near THEN a_first + b_last END,
        CASE WHEN a_last <= :near AND b_first <= :near THEN a_last + b_first END) AS total
    FROM distances
)
SELECT id FROM totals WHERE total IS NOT NULL ORDER BY total, id LIMIT 1
"""
# How far each site of a segment lies from the nearer line end (the better of the two pairings), and the segment's
# Excel distance. With :segment_id null every segment competes; :near limits each end distance.
END_DISTANCES_SQL = """
WITH ends AS (
    SELECT ST_SetSRID(ST_MakePoint(:first_lon, :first_lat), 4326)::geography AS first_end,
           ST_SetSRID(ST_MakePoint(:last_lon, :last_lat), 4326)::geography AS last_end
), distances AS (
    SELECT s.id, s.distance_km,
           ST_Distance(a.geom::geography, e.first_end) AS a_first, ST_Distance(b.geom::geography, e.last_end) AS b_last,
           ST_Distance(a.geom::geography, e.last_end) AS a_last, ST_Distance(b.geom::geography, e.first_end) AS b_first
    FROM segments s JOIN sites a ON a.id = s.site_a_id JOIN sites b ON b.id = s.site_b_id, ends e
    WHERE CAST(:segment_id AS integer) IS NULL OR s.id = :segment_id
), paired AS (
    SELECT id, distance_km,
           CASE WHEN a_first + b_last <= a_last + b_first THEN a_first ELSE a_last END AS a_metres,
           CASE WHEN a_first + b_last <= a_last + b_first THEN b_last ELSE b_first END AS b_metres
    FROM distances
)
SELECT id, distance_km, a_metres, b_metres FROM paired
WHERE a_metres <= :near AND b_metres <= :near ORDER BY a_metres + b_metres, id LIMIT 1
"""
CLOSEST_METRES = 1000
KM_DIFFERS_SHARE = 0.1
NO_LIMIT_METRES = 1e12
INSERT_ROUTE_GROUP_SQL = """
INSERT INTO kmz_groups (upload_id, name, folder_path, segment_id, route, colour_mode, created_by)
VALUES (:upload_id, :name, :folder_path, :segment_id, true, 'theme', :user_id)
RETURNING id
"""
# A new import replaces the segment's route lines: the earlier ones are hidden (never deleted).
HIDE_OLD_ROUTE_GROUPS_SQL = """
UPDATE kmz_groups SET hidden_at = now(), hidden_by = :user_id
WHERE segment_id = :segment_id AND route AND hidden_at IS NULL
RETURNING id
"""


def line_ends(geometry: dict) -> tuple[list[float], list[float]]:
    """First and last vertex of a LineString, or of a MultiLineString read part after part."""
    coordinates = geometry["coordinates"]
    if geometry["type"] == "MultiLineString":
        return coordinates[0][0], coordinates[-1][-1]
    return coordinates[0], coordinates[-1]


def geometry_key(geometry: dict) -> str:
    """The shape rounded to about 10 cm, to tell the same line drawn in two folders."""
    return json.dumps(geometry["coordinates"], default=lambda value: round(value, 6))


def add_evidence(db: Session, route_lines: list[dict]) -> None:
    """Adds to each line (in place): end distances and km against the segment it is aimed at (its title segment, else
    a closest suggestion), 'km_differs', 'same' (as the KMZ routes card reads it) and 'duplicate' (the same shape
    already seen earlier in the file). Lines with no segment but a folder suggestion already carry closest_*."""
    seen_shapes = set()
    for line in route_lines:
        line.setdefault("closest_segment_id", None)
        line.setdefault("closest_by", None)
        shape = geometry_key(line["geometry"])
        line["duplicate"] = shape in seen_shapes
        seen_shapes.add(shape)
        first_end, last_end = line_ends(line["geometry"])
        parameters = {
            "first_lon": first_end[0], "first_lat": first_end[1], "last_lon": last_end[0], "last_lat": last_end[1],
            "segment_id": line["suggested_segment_id"] or line["closest_segment_id"], "near": NO_LIMIT_METRES,
        }
        if parameters["segment_id"] is None:
            parameters["near"] = CLOSEST_METRES
        found = db.execute(text(END_DISTANCES_SQL), parameters).mappings().first()
        line.update(end_a_m=None, end_b_m=None, km=None, excel_km=None, km_differs=False, same=False)
        if found is None:
            continue
        segment_id = found["id"]
        if line["suggested_segment_id"] is None and line["closest_segment_id"] is None:
            line["closest_segment_id"] = segment_id
            line["closest_by"] = "location"
        compared = line_statuses(db, segment_id, [{"key": line["key"], "geometry": line["geometry"]}])[0]
        excel_km = None if found["distance_km"] is None else float(found["distance_km"])
        line.update(end_a_m=round(found["a_metres"]), end_b_m=round(found["b_metres"]), km=compared["distance_km"],
                    excel_km=excel_km, same=compared["status"] == "same")
        if excel_km:
            line["km_differs"] = abs(compared["distance_km"] - excel_km) / excel_km > KM_DIFFERS_SHARE


def suggest_by_location(db: Session, route_lines: list[dict]) -> list[dict]:
    """[{key, segment_id, suggested_by: 'location'}] for the lines that have a segment. Saves nothing."""
    suggestions = []
    for line in route_lines:
        first_end, last_end = line_ends(line["geometry"])
        parameters = {
            "first_lon": first_end[0], "first_lat": first_end[1],
            "last_lon": last_end[0], "last_lat": last_end[1],
            "near": NEAR_METRES,
        }
        segment_id = db.execute(text(NEAREST_SEGMENT_SQL), parameters).scalar()
        if segment_id is not None:
            suggestions.append({"key": line["key"], "segment_id": segment_id, "suggested_by": "location"})
    return suggestions


def check_route_lines(db: Session, staged_lines: list[dict], choices: list[dict]) -> list[dict]:
    """Validate the admin's {key, segment_id} picks (422 on an unknown key or segment, or a line listed twice).
    Returns each pick with its staged line."""
    by_key = {line["key"]: line for line in staged_lines}
    seen_keys = set()
    to_save = []
    for choice in choices:
        line = by_key.get(choice["key"])
        if line is None:
            raise Invalid(f"unknown route line {choice['key']}")
        if choice["key"] in seen_keys:
            raise Invalid(f"route line {choice['key']} listed twice")
        seen_keys.add(choice["key"])
        target_must_exist(db, "segment", choice["segment_id"])
        to_save.append({"segment_id": choice["segment_id"], "line": line})
    return to_save


def hide_old_route_groups(db: Session, admin_id: int, upload_id: int, segment_id: int) -> None:
    parameters = {"user_id": admin_id, "segment_id": segment_id}
    hidden_ids = db.execute(text(HIDE_OLD_ROUTE_GROUPS_SQL), parameters).scalars().all()
    for group_id in hidden_ids:
        edit = ("hidden", bool_text(False), bool_text(True))
        log_edits_for_user(db, admin_id, "kmz_group", group_id, [edit], "", upload_id)


def drop_same_and_hide_old(db: Session, admin_id: int, upload_id: int, to_save: list[dict]) -> list[dict]:
    """Per-segment path: a line equal to a stored route is not saved again; the earlier routes are hidden only when
    a saved line replaces them."""
    statuses = {}
    for pick in to_save:
        found = line_statuses(db, pick["segment_id"], [pick["line"]])[0]
        statuses[pick["line"]["key"]] = found["status"]
    replaced = {pick["segment_id"] for pick in to_save if statuses[pick["line"]["key"]] == "replaces route"}
    for segment_id in sorted(replaced):
        hide_old_route_groups(db, admin_id, upload_id, segment_id)
    return [pick for pick in to_save if statuses[pick["line"]["key"]] != "same"]


def save_route_lines(
    db: Session, admin_id: int, upload_id: int, to_save: list[dict]
) -> int:
    """One route group with one line element per pick, as drawn. Returns how many lines were saved.
    A line equal to a stored route ("same") is never saved again; the earlier routes are hidden only when a saved
    line replaces them."""
    to_save = drop_same_and_hide_old(db, admin_id, upload_id, to_save)
    for pick in to_save:
        line = pick["line"]
        parameters = {
            "upload_id": upload_id,
            "name": line["name"],
            "folder_path": line["folder_path"],
            "segment_id": pick["segment_id"],
            "user_id": admin_id,
        }
        group_id = db.execute(text(INSERT_ROUTE_GROUP_SQL), parameters).scalar_one()
        db.execute(text(INSERT_ELEMENT_SQL), {
            "group_id": group_id,
            "name": line["name"],
            "kind": "line",
            "geometry": json.dumps(line["geometry"]),
            "style": json.dumps(line["kmz_style"]),
        })
        edit = ("created", None, f"route line, segment {pick['segment_id']}")
        log_edits_for_user(db, admin_id, "kmz_group", group_id, [edit], "", upload_id)
    return len(to_save)
