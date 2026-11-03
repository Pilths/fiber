"""Dev only: more DEV sites and segments so routes have alternatives, plus road-shaped lines for DEV segments.
Run: python -m app.seed_dev_network. Idempotent. Reads app/dev_road_shapes.json (OSRM, fetched once; no network here)."""
import json
import os
import sys
from pathlib import Path
from typing import Any

from sqlalchemy import text
from sqlalchemy.orm import Session

from app.db import engine
from app.seed_dev import CORES, SEGMENTS as OLD_SEGMENTS, SITES as OLD_SITES

SHAPES = Path(__file__).with_name("dev_road_shapes.json")
# name, kind, (lon, lat)
SITES = [
    ("DEV Butterworth Hut", "site", (100.3640, 5.3990)),
    ("DEV Taiping Hut", "site", (100.7333, 4.8500)),
    ("DEV Teluk Intan Hut", "site", (101.0200, 4.0250)),
    ("DEV Tanjung Malim Hut", "site", (101.5200, 3.6800)),
    ("DEV Klang Hut", "site", (101.4450, 3.0449)),
    ("DEV Seremban Hut", "site", (101.9380, 2.7259)),
    ("DEV Melaka Hut", "site", (102.2501, 2.1896)),
    ("DEV Kajang Hut", "site", (101.7900, 2.9935)),
]
KL, CJ, IPH, PEN = "DEV Kuala Lumpur DC", "DEV Cyberjaya DC", "DEV Ipoh Exchange", "DEV Penang Tower"
BW, TP, TI, TM, KG, SB, ML, KJ = (s[0] for s in SITES)
DEV_TRUNK_ROUTES_SQL = """
UPDATE segments s SET route = CASE WHEN s.region = 'South' THEN 'R3' ELSE 'R1' END
FROM sites a, sites b
WHERE a.id = s.site_a_id AND b.id = s.site_b_id AND a.name LIKE 'DEV %' AND b.name LIKE 'DEV %'
  AND s.route_type = 'Trunk' AND s.route IS NULL
"""
# site A, site B, route_type, region, cable_size
SEGMENTS = [
    (PEN, BW, "Metro", "North", 48), (BW, TP, "Trunk", "North", 144), (TP, IPH, "Trunk", "North", 144),
    (IPH, TI, "Trunk", "North", 144), (TI, KG, "Trunk", "Central", 144), (KG, KL, "Metro", "Central", 48),
    (IPH, TM, "Trunk", "North", 144), (TM, KL, "Trunk", "Central", 144), (KL, KJ, "Metro", "Central", 48),
    (KJ, SB, "Trunk", "South", 144), (CJ, SB, "Trunk", "South", 144), (SB, ML, "Trunk", "South", 144),
    (KG, CJ, "Metro", "Central", 48), (BW, IPH, "Trunk", "North", 144),
]


def shape_pairs() -> list[tuple[str, str]]:
    """Every DEV segment (old and new) whose two sites have coordinates, as (name A, name B)."""
    xy = {n: ll for _, n, _, ll in OLD_SITES if ll} | {n: ll for n, _, ll in SITES}
    code = {c: n for c, n, _, _ in OLD_SITES}
    pairs = [(code[a], code[b]) for a, b, *_ in OLD_SEGMENTS] + [(a, b) for a, b, *_ in SEGMENTS]
    return [(a, b) for a, b in pairs if a in xy and b in xy]


def main() -> None:
    if os.environ.get("APP_ENV") != "development":
        sys.exit("refusing: APP_ENV is not development")
    shapes: dict[str, Any] = json.loads(SHAPES.read_text())
    with Session(engine) as db:
        def one(sql: str, **p: Any) -> int | None:
            return db.execute(text(sql), p).scalar()

        admin = one("SELECT id FROM users WHERE username = 'admin1'")
        if admin is None:
            sys.exit("admin1 not found; run app.seed_dev first")
        site = {n: i for i, n in db.execute(text("SELECT id, name FROM sites WHERE name LIKE 'DEV %'"))}
        added_sites = added_segments = 0
        for name, kind, (lon, lat) in SITES:
            if name not in site:
                site[name] = one("INSERT INTO sites (name, kind, geom) VALUES (:n, :k, ST_SetSRID(ST_MakePoint(:x, :y), 4326)) RETURNING id",
                                 n=name, k=kind, x=lon, y=lat)
                added_sites += 1
        seg: dict[tuple[str, str], int] = {}
        for n, (a, b, route, region, cable) in enumerate(SEGMENTS):
            sid = one("SELECT id FROM segments WHERE site_a_id IN (:a, :b) AND site_b_id IN (:a, :b)", a=site[a], b=site[b])
            if sid is None:
                km = shapes[f"{a}|{b}"]["km"]
                sid = one("INSERT INTO segments (site_a_id, site_b_id, route_type, region, distance_km, survey_cores, cable_size) "
                          "VALUES (:a, :b, :r, :g, :d, :n, :c) RETURNING id", a=site[a], b=site[b], r=route, g=region, d=km, n=CORES, c=cable)
                for num in range(1, CORES + 1):
                    ports = [one("INSERT INTO ports (port_id, site_id) VALUES (:p, :s) RETURNING id",
                                 p=f"{name[4:8].upper()}-{sid}-{end}-{num:02d}", s=site[name])
                             for name, end in ((a, "A"), (b, "B"))]
                    db.execute(text("INSERT INTO cores (segment_id, number, port_a_id, port_b_id) VALUES (:s, :n, :pa, :pb)"),
                               {"s": sid, "n": num, "pa": ports[0], "pb": ports[1]})
                added_segments += 1
            seg[(a, b)] = sid
        # one road-shaped route per DEV segment: the map cuts the line per segment
        shaped = 0
        for a, b in shape_pairs():
            key = f"{a}|{b}"
            sid = one("SELECT id FROM segments WHERE site_a_id IN (:a, :b) AND site_b_id IN (:a, :b)", a=site[a], b=site[b])
            if key not in shapes or sid is None:
                continue
            if one("SELECT 1 FROM routes g JOIN route_segments p ON p.route_id = g.id AND p.segment_id = :s "
                   "WHERE g.geom IS NOT NULL AND NOT EXISTS (SELECT 1 FROM route_segments q WHERE q.route_id = g.id AND q.segment_id <> :s)", s=sid):
                continue
            coords = shapes[key]["coords"]
            assert all(99.5 <= x <= 119.5 and 0.8 <= y <= 7.5 for x, y in coords), f"{key}: shape outside Malaysia bbox"
            rid = one("INSERT INTO routes (site_a_id, site_b_id, geom) VALUES (:a, :b, ST_SetSRID(ST_GeomFromGeoJSON(:g), 4326)) RETURNING id",
                      a=site[a], b=site[b], g=json.dumps({"type": "LineString", "coordinates": coords}))
            db.execute(text("INSERT INTO route_segments (route_id, segment_id, position) VALUES (:r, :s, 1)"), {"r": rid, "s": sid})
            shaped += 1
        # DEV trunk route labels: R1 up north and central, R3 down south. Only fills a blank route.
        db.execute(text(DEV_TRUNK_ROUTES_SQL))
        db.commit()
    print(f"sites added {added_sites}, segments added {added_segments}, shaped routes added {shaped}")


if __name__ == "__main__":
    main()
