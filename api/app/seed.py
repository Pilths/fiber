"""Load the Ready rows of a sample workbook. Run: python -m app.seed <file>"""
import json
import os
import sys
from typing import Any

from argon2 import PasswordHasher
from sqlalchemy import text
from sqlalchemy.orm import Session

from app.db import engine
from app.ingest.excel import RowResult, parse_workbook


class Skip(Exception):
    pass


def load(db: Any, path: str) -> tuple[dict[str, int], list[str]]:
    """Insert into a Session or Connection (caller commits). Returns counts and skipped-row lines."""
    def one(sql: str, **p: Any) -> Any:
        return db.execute(text(sql), p).scalar_one_or_none()

    def ins(sql: str, **p: Any) -> None:
        db.execute(text(sql), p)

    if one("SELECT count(*) FROM sites"):
        sys.exit("sites table is not empty; refusing to seed")
    user = {}
    dev_hash = PasswordHasher().hash(os.environ.get("DEV_PASSWORD", "dev-password-123"))  # dev users only
    for u, role in [("planner1", "planner"), ("admin1", "admin")]:
        ins("INSERT INTO users (username, display_name, role, password_hash, must_change_password) "
            "VALUES (:u, :u, :r, :h, false) ON CONFLICT (username) DO NOTHING", u=u, r=role, h=dev_hash)
        user[u] = one("SELECT id FROM users WHERE username = :u", u=u)

    rows = parse_workbook(path)
    counts = dict.fromkeys(["sites", "data_centers", "spans", "customers", "reservations", "cores", "ports"], 0)
    skipped = [f"{r.sheet} row {r.row_number} [{r.status}]: {r.reason}" for r in rows if r.status != "ready"]
    site: dict[str, int] = {}

    def add_site(r: RowResult) -> None:
        p = r.parsed
        lrd = site.get(p["lrd"]) if p.get("lrd") else None
        if p.get("lrd") and lrd is None:
            raise Skip(f"LRD site {p['lrd']} not loaded")
        site[p["name"]] = one(
            "INSERT INTO sites (name, kind, geom, details, lrd_site_id) VALUES "
            "(:n, :k, ST_SetSRID(ST_MakePoint(:lon, :lat), 4326), CAST(:d AS jsonb), :l) RETURNING id",
            n=p["name"], k=p["kind"], lon=p["lon"], lat=p["lat"], d=json.dumps(p["details"]), l=lrd)
        counts["data_centers" if p["kind"] == "data_center" else "sites"] += 1

    def port(label: str, site_id: int) -> int:
        n = one("INSERT INTO ports (port_id, site_id) VALUES (:p, :s) ON CONFLICT (port_id) DO NOTHING RETURNING id",
                p=label, s=site_id)
        if n is None:
            return one("SELECT id FROM ports WHERE port_id = :p", p=label)
        counts["ports"] += 1
        return n

    def add_reservation(r: RowResult) -> None:
        p = r.parsed
        a, b = site.get(p["site_a"]), site.get(p["site_b"])
        if a is None or b is None:
            raise Skip("site not loaded")
        span = db.execute(text("SELECT id, site_a_id FROM spans WHERE LEAST(site_a_id, site_b_id) = LEAST(:a, :b) "
                               "AND GREATEST(site_a_id, site_b_id) = GREATEST(:a, :b)"), {"a": a, "b": b}).first()
        span_created = span is None
        if span is None:
            span = (one("INSERT INTO spans (site_a_id, site_b_id, region, distance_km, survey_cores) "
                        "VALUES (:a, :b, :g, :d, :c) RETURNING id", a=a, b=b, g=p["region"], d=p["distance_km"],
                        c=p["survey_cores"]), a)
            counts["spans"] += 1
        span_id, span_a = span
        if span_created and p["survey_cores"]:  # surveyed capacity: cores 1..N, ports filled in below
            for num in range(1, p["survey_cores"] + 1):
                ins("INSERT INTO cores (span_id, number) VALUES (:s, :n)", s=span_id, n=num)
            counts["cores"] += p["survey_cores"]
        core_ids = []
        labels = {site[code]: lbls for code, lbls in p.get("ports") or []}  # none for a count-only row
        span_b = b if span_a == a else a
        for la, lb in zip(labels.get(span_a, []), labels.get(span_b, [])):
            pa, pb = port(la, span_a), port(lb, span_b)
            core = one("SELECT id FROM cores WHERE span_id = :s AND port_a_id = :a AND port_b_id = :b", s=span_id, a=pa, b=pb)
            if core is None:  # next portless surveyed core in number order, else a new one
                core = one("SELECT id FROM cores WHERE span_id = :s AND port_a_id IS NULL AND port_b_id IS NULL "
                           "ORDER BY number LIMIT 1", s=span_id)
                if core is None:
                    core = one("INSERT INTO cores (span_id, number, port_a_id, port_b_id) VALUES "
                               "(:s, (SELECT coalesce(max(number), 0) + 1 FROM cores WHERE span_id = :s), :a, :b) RETURNING id",
                               s=span_id, a=pa, b=pb)
                    counts["cores"] += 1
                else:
                    ins("UPDATE cores SET port_a_id = :a, port_b_id = :b WHERE id = :c", a=pa, b=pb, c=core)
            elif one("SELECT core_id FROM core_holds WHERE core_id = :c", c=core):
                raise Skip("core already held")
            core_ids.append(core)
        cust = one("SELECT id FROM customers WHERE lower(name) = lower(:n)", n=p["customer"])
        if cust is None:
            cust = one("INSERT INTO customers (name, created_by) VALUES (:n, :u) RETURNING id", n=p["customer"], u=user["planner1"])
            counts["customers"] += 1
        res = one("INSERT INTO reservations (customer_id, planner_id, planned_date, imported, group_label, additional, "
                  "cv_ready_date, contractor, remark, port_info_raw, monitoring_code, fiber_monitored, "
                  "unassigned_cores, unassigned_span_id) VALUES "
                  "(:c, :u, :pd, true, :gl, :ad, :cv, :ct, :rm, :pi, :mc, :fm, :uc, :us) RETURNING id",
                  c=cust, u=user["planner1"], pd=p["planned_date"], gl=p["group_label"], ad=p["additional"],
                  cv=p["cv_ready_date"], ct=p["contractor"], rm=p["remark"], pi=p["port_info_raw"],
                  mc=p["monitoring_code"], fm=p["fiber_monitored"],
                  uc=p["unassigned_cores"], us=span_id if p["unassigned_cores"] else None)
        ins("INSERT INTO reservation_events (reservation_id, type, user_id) VALUES (:r, 'requested', :u)", r=res, u=user["planner1"])
        ins("INSERT INTO reservation_events (reservation_id, type, user_id) VALUES (:r, 'approved', :u)", r=res, u=user["admin1"])
        for core in core_ids:
            ins("INSERT INTO reservation_cores (reservation_id, core_id) VALUES (:r, :c)", r=res, c=core)
            ins("INSERT INTO core_holds (core_id, reservation_id) VALUES (:c, :r)", c=core, r=res)
        counts["reservations"] += 1

    for r in rows:  # parse_workbook orders sheets: sites, DCs, reservations
        if r.status != "ready":
            continue
        before = dict(counts)
        try:
            with db.begin_nested():  # a skipped row rolls back only itself
                (add_reservation if r.sheet == "Reservation" else add_site)(r)
        except Skip as e:
            counts.update(before)
            skipped.append(f"{r.sheet} row {r.row_number} [skipped]: {e}")
    return counts, skipped


def main() -> None:
    if len(sys.argv) != 2:
        sys.exit("usage: python -m app.seed <file>")
    with Session(engine) as db:
        counts, skipped = load(db, sys.argv[1])
        db.commit()
    print("loaded:", ", ".join(f"{k} {v}" for k, v in counts.items()))
    print(f"skipped {len(skipped)}:")
    for s in skipped:
        print(" ", s)


if __name__ == "__main__":
    main()
