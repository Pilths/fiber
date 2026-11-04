"""Map GeoJSON. Straight segment lines; segments of a route with a stored geom get their own part of the shaped line.

Shaped parts are cut in Python (not PostGIS): the chain is tiny and cutting at the vertex closest to the
junction site keeps every vertex of the drawn shape and needs no extra SQL. ponytail: closest vertex, not closest
point on the line; fine for a hand-drawn shape that passes through the site, revisit if KMZ shapes drift.
"""
import json
from xml.sax.saxutils import escape
import math
from typing import Any

from sqlalchemy import text
from sqlalchemy.orm import Session

from app.inventory.service import list_segments

SEGMENT_GEO_SQL = """
SELECT s.id, s.site_a_id, s.site_b_id, ST_X(a.geom) AS ax, ST_Y(a.geom) AS ay, ST_X(b.geom) AS bx, ST_Y(b.geom) AS by,
       a.name AS an, b.name AS bn
FROM segments s JOIN sites a ON a.id = s.site_a_id JOIN sites b ON b.id = s.site_b_id
"""
ROUTE_SQL = """
SELECT g.id, ST_AsGeoJSON(g.geom) AS geom, array_agg(gs.segment_id ORDER BY gs.position) AS segment_ids
FROM routes g JOIN route_segments gs ON gs.route_id = g.id
WHERE g.geom IS NOT NULL GROUP BY g.id ORDER BY g.id
"""
SITE_SQL = """
SELECT s.id, s.name, s.kind, s.lrd_site_id, s.details->>'region' AS region,
       ST_X(s.geom) AS x, ST_Y(s.geom) AS y, l.name AS lname, ST_X(l.geom) AS lx, ST_Y(l.geom) AS ly
FROM sites s LEFT JOIN sites l ON l.id = s.lrd_site_id
WHERE s.active AND EXISTS (SELECT 1 FROM segments p WHERE p.site_a_id = s.id OR p.site_b_id = s.id)
ORDER BY s.id
"""


def _ok(x: float | None, y: float | None) -> bool:
    return x is not None and y is not None and math.isfinite(x) and math.isfinite(y) and -180 <= x <= 180 and -90 <= y <= 90


def _chip(free: int, surveyed: bool) -> str:
    return "not_surveyed" if not surveyed else "ok" if free >= 10 else "low" if free >= 1 else "full"


def _shaped_parts(line: list[list[float]], segments: list[dict[str, Any]]) -> dict[int, list[list[float]]]:
    """Cut `line` at the vertex closest to each junction site; {segment_id: coords oriented site A -> site B}."""
    if len(segments) < 1 or len(line) < 2:
        return {}
    # travel order of sites along the route
    first = segments[0]
    if len(segments) > 1:
        nxt = segments[1]
        start = first["site_b_id"] if first["site_a_id"] in (nxt["site_a_id"], nxt["site_b_id"]) else first["site_a_id"]
    else:
        start = first["site_a_id"]
    order, cur = [], start
    for s in segments:
        if cur not in (s["site_a_id"], s["site_b_id"]):
            return {}  # broken chain: leave straight
        end = s["site_b_id"] if cur == s["site_a_id"] else s["site_a_id"]
        order.append((s, cur, end))
        cur = end
    xy = {}
    for s in segments:
        xy[s["site_a_id"]], xy[s["site_b_id"]] = (s["ax"], s["ay"]), (s["bx"], s["by"])
    cuts = [0]
    for _, _, end in order[:-1]:
        px, py = xy[end]
        i = min(range(len(line)), key=lambda k: (line[k][0] - px) ** 2 + (line[k][1] - py) ** 2)
        cuts.append(max(i, cuts[-1]))
    cuts.append(len(line) - 1)
    out = {}
    for n, (s, frm, to) in enumerate(order):
        part = [list(xy[frm])] + [list(p) for p in line[cuts[n] + 1:cuts[n + 1]]] + [list(xy[to])]
        out[s["id"]] = part if frm == s["site_a_id"] else part[::-1]
    return out


def map_segments(db: Session) -> dict[str, Any]:
    geo = {r["id"]: dict(r) for r in db.execute(text(SEGMENT_GEO_SQL)).mappings()}
    shaped: dict[int, tuple[int, list[list[float]]]] = {}
    for seg in db.execute(text(ROUTE_SQL)).mappings():
        ids = [i for i in seg["segment_ids"] if i in geo]
        if len(ids) != len(seg["segment_ids"]) or not all(_ok(geo[i]["ax"], geo[i]["ay"]) and _ok(geo[i]["bx"], geo[i]["by"]) for i in ids):
            continue
        for sid, coords in _shaped_parts(json.loads(seg["geom"])["coordinates"], [geo[i] for i in ids]).items():
            shaped[sid] = (seg["id"], coords)
    feats, not_drawn = [], []
    for s in list_segments(db, None, None, None):
        g, name = geo[s["id"]], f"{s['site_a']} - {s['site_b']}"
        bad = [n for n, x, y in ((g["an"], g["ax"], g["ay"]), (g["bn"], g["bx"], g["by"])) if not _ok(x, y)]
        if bad:
            not_drawn.append({"segment_id": s["id"], "name": name, "reason": "no valid coordinates for " + ", ".join(bad)})
            continue
        seg_id, coords = shaped.get(s["id"], (None, None))
        surveyed = s["survey_cores"] is not None
        props = {"segment_id": s["id"], "name": name, "site_a_id": g["site_a_id"], "site_b_id": g["site_b_id"],
                 "route_type": s["route_type"], "route": s["route"], "region": s["region"],
                 "site_a_kind": s["site_a_kind"], "site_b_kind": s["site_b_kind"], "distance_km": s["distance_km"],
                 "free_to_reserve": s["free_to_reserve"], "surveyed": surveyed, "fiber_cut": s["fiber_cut"],
                 "chip": _chip(s["free_to_reserve"], surveyed), "route_id": seg_id}
        if coords:
            props["shaped"] = True
        feats.append({"type": "Feature", "properties": props, "geometry": {
            "type": "LineString", "coordinates": coords or [[g["ax"], g["ay"]], [g["bx"], g["by"]]]}})
    return {"type": "FeatureCollection", "features": feats, "not_drawn": not_drawn}


def map_sites(db: Session) -> dict[str, Any]:
    feats, not_drawn = [], []
    for r in db.execute(text(SITE_SQL)).mappings():
        props = {"site_id": r["id"], "name": r["name"], "kind": r["kind"], "lrd_site_id": r["lrd_site_id"], "region": r["region"]}
        x, y = r["x"], r["y"]
        if not _ok(x, y):
            if r["kind"] == "data_center" and _ok(r["lx"], r["ly"]):
                x, y, props["location_from_site"] = r["lx"], r["ly"], r["lname"]
            else:
                not_drawn.append({"site_id": r["id"], "name": r["name"], "reason": "no valid coordinates"})
                continue
        feats.append({"type": "Feature", "properties": props, "geometry": {"type": "Point", "coordinates": [x, y]}})
    return {"type": "FeatureCollection", "features": feats, "not_drawn": not_drawn}


SEGMENT_SITES_SQL = """
SELECT a.name AS site_a, b.name AS site_b
FROM segments s JOIN sites a ON a.id = s.site_a_id JOIN sites b ON b.id = s.site_b_id
WHERE s.id = :segment_id
"""


def _kml_point(name: str, lon: float, lat: float) -> str:
    return (f"<Placemark><name>{escape(name)}</name>"
            f"<Point><coordinates>{lon},{lat},0</coordinates></Point></Placemark>")


def segment_kml(db: Session, segment_id: int) -> tuple[str, str] | None:
    """(file name, KML text) of one segment: its line as drawn on the map plus its two sites; None if not drawn."""
    sites = db.execute(text(SEGMENT_SITES_SQL), {"segment_id": segment_id}).mappings().first()
    if sites is None:
        return None
    # ponytail: builds the whole map to pick one line; fine for a few hundred segments
    features = map_segments(db)["features"]
    feature = next((f for f in features if f["properties"]["segment_id"] == segment_id), None)
    if feature is None:
        return None
    coords = feature["geometry"]["coordinates"]
    name = f"{sites['site_a']} - {sites['site_b']}"
    line_text = " ".join(f"{lon},{lat},0" for lon, lat in coords)
    kml = (
        '<?xml version="1.0" encoding="UTF-8"?>\n'
        '<kml xmlns="http://www.opengis.net/kml/2.2"><Document>'
        f"<name>{escape(name)}</name>"
        "<Style id=\"line\"><LineStyle><color>ff0000ff</color><width>4</width></LineStyle></Style>"
        f"<Placemark><name>{escape(name)}</name><styleUrl>#line</styleUrl>"
        f"<LineString><tessellate>1</tessellate><coordinates>{line_text}</coordinates></LineString></Placemark>"
        + _kml_point(sites["site_a"], *coords[0])
        + _kml_point(sites["site_b"], *coords[-1])
        + "</Document></kml>"
    )
    return name, kml
