"""Synthetic dev data (interim, until the real seed from the mock Excel). Run: python -m app.seed_dev"""
import os
import random
import sys
from typing import Any

from argon2 import PasswordHasher
from sqlalchemy import text
from sqlalchemy.orm import Session

from app.db import engine

# code, name, kind, (lon, lat) or None
SITES = [
    ("KL", "DEV Kuala Lumpur DC", "data_center", (101.6869, 3.1390)),
    ("CJ", "DEV Cyberjaya DC", "data_center", (101.6500, 2.9213)),
    ("BJ", "DEV Bukit Jalil TOC", "toc", (101.6990, 3.0580)),
    ("IPH", "DEV Ipoh Exchange", "site", (101.0901, 4.5975)),
    ("PEN", "DEV Penang Tower", "building", (100.3327, 5.4164)),
    ("KTN", "DEV Kuantan Hut", "site", None),
]
# site A, site B, route_type, region, distance_km, loss factor vs distance*0.3 (None = no measurements)
SPANS: list[tuple[str, str, str, str, float | None, float | None]] = [
    ("KL", "CJ", "Metro", "Central", 32.5, 1.0),
    ("CJ", "BJ", "Metro", "Central", 18.2, 1.05),
    ("KL", "BJ", "Metro", "Central", 12.0, 1.3),
    ("KL", "IPH", "Trunk", "North", 205.0, 0.95),
    ("IPH", "PEN", "Trunk", "North", 120.4, 1.15),
    ("KL", "KTN", "Trunk", "East Coast", 290.0, 1.0),
    ("BJ", "KTN", "Metro", "East Coast", None, None),
]
CORES = 24


def run(db: Session) -> None:
    def one(sql: str, **p: Any) -> int:
        return db.execute(text(sql), p).scalar_one()

    def ins(sql: str, **p: Any) -> None:
        db.execute(text(sql), p)

    dev_hash = PasswordHasher().hash(os.environ.get("DEV_PASSWORD", "dev-password-123"))  # development only
    user = {
        u: one("INSERT INTO users (username, display_name, role, password_hash, must_change_password) "
               "VALUES (:u, :d, :r, :h, false) RETURNING id", u=u, d=f"DEV {u}", r=r, h=dev_hash)
        for u, r in [("planner1", "planner"), ("planner2", "planner"), ("admin1", "admin"), ("admin2", "admin")]
    }

    site: dict[str, int] = {}
    for code, name, kind, lonlat in SITES:
        geom = "ST_SetSRID(ST_MakePoint(:lon, :lat), 4326)" if lonlat else "NULL"
        lon, lat = lonlat or (None, None)
        site[code] = one(f"INSERT INTO sites (name, kind, geom) VALUES (:n, :k, {geom}) RETURNING id",
                         n=name, k=kind, lon=lon, lat=lat)

    rng = random.Random(1)
    span: list[int] = []
    cores: dict[int, dict[int, int]] = {}  # span id -> core number -> core id
    for n, (a, b, route, region, km, factor) in enumerate(SPANS, start=1):
        sid = one("INSERT INTO spans (site_a_id, site_b_id, route_type, region, distance_km, survey_cores) "
                  "VALUES (:a, :b, :r, :g, :d, :n) RETURNING id", a=site[a], b=site[b], r=route, g=region, d=km, n=CORES)
        span.append(sid)
        cores[sid] = {}
        for num in range(1, CORES + 1):
            ports = [one("INSERT INTO ports (port_id, site_id) VALUES (:p, :s) RETURNING id",
                         p=f"{code}-{sid}-{end}-{num:02d}", s=site[code])
                     for code, end in ((a, "A"), (b, "B"))]
            # cores 10-13 in use with a circuit, 14 has a circuit but is not in use
            circuit = f"CKT-{1000 + n * 10 + num - 9}" if 10 <= num <= 14 and n <= 5 else None
            cores[sid][num] = one(
                "INSERT INTO cores (span_id, number, port_a_id, port_b_id, circuit_id, in_use) "
                "VALUES (:s, :n, :pa, :pb, :c, :u) RETURNING id",
                s=sid, n=num, pa=ports[0], pb=ports[1], c=circuit, u=circuit is not None and num != 14)
        if km is not None and factor is not None:
            for _ in range(3):
                ins("INSERT INTO measurements (span_id, loss_db, tested_on) "
                    "VALUES (:s, :l, current_date - :d)",
                    s=sid, l=round(km * 0.3 * factor * rng.uniform(0.97, 1.03), 3), d=rng.randint(1, 300))

    # segments: a long route (several spans) and a short one
    for sites_ab, spans_in in [(("KL", "PEN"), [span[3], span[4]]), (("KL", "BJ"), [span[2]])]:
        seg = one("INSERT INTO segments (site_a_id, site_b_id, geom) VALUES (:a, :b, NULL) RETURNING id",
                  a=site[sites_ab[0]], b=site[sites_ab[1]])
        for pos, sid in enumerate(spans_in, start=1):
            ins("INSERT INTO segment_spans (segment_id, span_id, position) VALUES (:g, :s, :p)",
                g=seg, s=sid, p=pos)

    cust = [one("INSERT INTO customers (name, created_by) VALUES (:n, :u) RETURNING id", n=n, u=user["planner1"])
            for n in ("DEV Telco Alpha", "DEV Telco Beta", "DEV Bank Gamma")]

    def reserve(customer: int, planner: str, span_id: int, nums: list[int], approver: str | None) -> None:
        res = one("INSERT INTO reservations (customer_id, planner_id, planned_date) "
                  "VALUES (:c, :u, current_date + 30) RETURNING id", c=customer, u=user[planner])
        ins("INSERT INTO reservation_events (reservation_id, type, user_id) VALUES (:r, 'requested', :u)",
            r=res, u=user[planner])
        if approver:
            ins("INSERT INTO reservation_events (reservation_id, type, user_id) VALUES (:r, 'approved', :u)",
                r=res, u=user[approver])
        for num in nums:
            ins("INSERT INTO reservation_cores (reservation_id, core_id) VALUES (:r, :c)", r=res, c=cores[span_id][num])
            ins("INSERT INTO core_holds (core_id, reservation_id) VALUES (:c, :r)", c=cores[span_id][num], r=res)

    reserve(cust[0], "planner1", span[0], [1, 2], "admin1")
    reserve(cust[1], "planner2", span[3], [1, 2], None)

    # count-only reservation, as an Excel import makes it: 3 cores wanted on CJ-BJ, ports not assigned yet
    res = one("INSERT INTO reservations (customer_id, planner_id, imported, unassigned_cores, unassigned_span_id) "
              "VALUES (:c, :u, true, 3, :s) RETURNING id", c=cust[2], u=user["planner1"], s=span[1])
    for who, kind in (("planner1", "requested"), ("admin1", "approved")):
        ins("INSERT INTO reservation_events (reservation_id, type, user_id) VALUES (:r, :t, :u)",
            r=res, t=kind, u=user[who])


def main() -> None:
    with Session(engine) as db:
        if db.execute(text("SELECT count(*) FROM sites")).scalar_one():
            print("sites table is not empty; refusing to seed", file=sys.stderr)
            sys.exit(1)
        run(db)
        db.commit()
    print("dev seed inserted")


if __name__ == "__main__":
    main()
