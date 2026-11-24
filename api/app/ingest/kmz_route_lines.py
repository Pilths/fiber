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


def save_route_lines(db: Session, admin_id: int, upload_id: int, to_save: list[dict]) -> int:
    """One route group with one line element per pick, as drawn. Returns how many lines were saved.
    The segment's earlier route lines are hidden first, so the new import replaces them."""
    segment_ids = sorted({pick["segment_id"] for pick in to_save})
    for segment_id in segment_ids:
        hide_old_route_groups(db, admin_id, upload_id, segment_id)
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
