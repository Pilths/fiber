"""Dev only (TASK-084): give two consecutive dev spans A-B, B-C a drawn curved shape. Run: python -m app.seed_dev_shape"""
import json
import os
import sys

from sqlalchemy import text
from sqlalchemy.orm import Session

from app.db import engine

PAIR_SQL = """
SELECT s1.id AS s1, s2.id AS s2, s1.site_a_id AS a1, s1.site_b_id AS b1, s2.site_a_id AS a2, s2.site_b_id AS b2
FROM spans s1 JOIN spans s2 ON s2.id > s1.id
 AND (s1.site_a_id IN (s2.site_a_id, s2.site_b_id) OR s1.site_b_id IN (s2.site_a_id, s2.site_b_id))
WHERE NOT EXISTS (SELECT 1 FROM sites x WHERE x.geom IS NULL AND x.id IN (s1.site_a_id, s1.site_b_id, s2.site_a_id, s2.site_b_id))
ORDER BY s1.id, s2.id LIMIT 1
"""


def main() -> None:
    if os.environ.get("APP_ENV") != "development":
        sys.exit("refusing: APP_ENV is not development")
    with Session(engine) as db:
        r = db.execute(text(PAIR_SQL)).mappings().first()
        if r is None:
            sys.exit("no two consecutive spans with coordinates on all three sites")
        shared = ({r["a1"], r["b1"]} & {r["a2"], r["b2"]}).pop()
        a = (({r["a1"], r["b1"]}) - {shared}).pop()
        c = (({r["a2"], r["b2"]}) - {shared}).pop()
        pt = {i: db.execute(text("SELECT ST_X(geom), ST_Y(geom) FROM sites WHERE id = :i"), {"i": i}).one() for i in (a, shared, c)}
        (ax, ay), (bx, by), (cx, cy) = pt[a], pt[shared], pt[c]
        # bend each leg sideways (perpendicular offset, 12% of leg length) with 3 vertices per leg; passes exactly through B
        def leg(x0: float, y0: float, x1: float, y1: float) -> list[list[float]]:
            dx, dy = x1 - x0, y1 - y0
            return [[x0 + dx * t - dy * k * 0.12, y0 + dy * t + dx * k * 0.12]
                    for t, k in ((0.25, 0.6), (0.5, 1.0), (0.75, 0.6))]
        coords = [[ax, ay], *leg(ax, ay, bx, by), [bx, by], *leg(bx, by, cx, cy), [cx, cy]]
        assert all(99.5 <= x <= 119.5 and 0.8 <= y <= 7.5 for x, y in coords), "shape outside Malaysia bbox"
        geom = json.dumps({"type": "LineString", "coordinates": coords})
        seg = db.execute(text("SELECT g.id FROM segments g JOIN segment_spans p1 ON p1.segment_id = g.id AND p1.span_id = :s1 "
                              "JOIN segment_spans p2 ON p2.segment_id = g.id AND p2.span_id = :s2 AND p2.position = p1.position + 1"),
                         {"s1": r["s1"], "s2": r["s2"]}).scalar()
        if seg is None:
            seg = db.execute(text("INSERT INTO segments (site_a_id, site_b_id) VALUES (:a, :c) RETURNING id"), {"a": a, "c": c}).scalar_one()
            for pos, sid in enumerate((r["s1"], r["s2"]), start=1):
                db.execute(text("INSERT INTO segment_spans (segment_id, span_id, position) VALUES (:g, :s, :p)"), {"g": seg, "s": sid, "p": pos})
        db.execute(text("UPDATE segments SET geom = ST_SetSRID(ST_GeomFromGeoJSON(:g), 4326) WHERE id = :i"), {"g": geom, "i": seg})
        db.commit()
        print(f"segment {seg}: spans {r['s1']} and {r['s2']} shaped ({len(coords)} vertices)")


if __name__ == "__main__":
    main()
