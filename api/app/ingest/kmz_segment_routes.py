"""Route lines of one segment: the stored list, and how a staged line compares with it (same / replaces route / new).

Used by the per-segment "KMZ routes" card. A route line is a kmz_groups row with route = true; hidden ones are skipped.
"""
import json

from sqlalchemy import text
from sqlalchemy.orm import Session

STORED_ROUTES_SQL = """
SELECT g.id, g.folder_path, g.name, u.filename,
       (sum(ST_Length(e.geom::geography)) / 1000) AS distance_km,
       (COALESCE(u.created_at, g.created_at) AT TIME ZONE 'Asia/Kuala_Lumpur')::date AS uploaded
FROM kmz_groups g
JOIN uploads u ON u.id = g.upload_id
JOIN kmz_elements e ON e.group_id = g.id AND e.kind = 'line'
WHERE g.segment_id = :segment_id AND g.route AND g.hidden_at IS NULL
GROUP BY g.id, u.id
ORDER BY g.id
"""
STORED_SHAPES_SQL = """
SELECT ST_AsGeoJSON(e.geom) FROM kmz_elements e JOIN kmz_groups g ON g.id = e.group_id
WHERE g.segment_id = :segment_id AND g.route AND g.hidden_at IS NULL AND e.kind = 'line'
ORDER BY g.id, e.id
"""
# One staged line against the segment's visible routes: its km, and whether a stored line has the same shape.
LINE_COMPARE_SQL = """
WITH staged AS (SELECT ST_SetSRID(ST_GeomFromGeoJSON(:geometry), 4326) AS geom)
SELECT ST_Length(staged.geom::geography) / 1000 AS distance_km,
       EXISTS (
           SELECT 1 FROM kmz_elements e JOIN kmz_groups g ON g.id = e.group_id
           WHERE g.segment_id = :segment_id AND g.route AND g.hidden_at IS NULL AND e.kind = 'line'
           AND ST_Equals(ST_SnapToGrid(e.geom, 1e-6), ST_SnapToGrid(staged.geom, 1e-6))
       ) AS same
FROM staged
"""


def stored_routes(db: Session, segment_id: int) -> list[dict]:
    rows = db.execute(text(STORED_ROUTES_SQL), {"segment_id": segment_id}).mappings()
    return [{**row, "distance_km": round(float(row["distance_km"]), 1)} for row in rows]


def stored_shapes(db: Session, segment_id: int) -> list[dict]:
    return [json.loads(shape) for shape in db.execute(text(STORED_SHAPES_SQL), {"segment_id": segment_id}).scalars()]


def line_statuses(db: Session, segment_id: int, staged_lines: list[dict]) -> list[dict]:
    """[{key, distance_km, status}] for each staged line. 'same' = shape equal to a stored route of the segment,
    'replaces route' = the segment already has routes, 'new' = it has none."""
    has_routes = len(stored_shapes(db, segment_id)) > 0
    found = []
    for line in staged_lines:
        parameters = {"segment_id": segment_id, "geometry": json.dumps(line["geometry"])}
        row = db.execute(text(LINE_COMPARE_SQL), parameters).mappings().one()
        status = "new"
        if row["same"]:
            status = "same"
        elif has_routes:
            status = "replaces route"
        found.append({"key": line["key"], "distance_km": round(float(row["distance_km"]), 1), "status": status})
    return found
