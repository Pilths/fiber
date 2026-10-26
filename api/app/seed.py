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
from app.ingest.reservation_import import Skip, place_reservation


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

    def add_reservation(r: RowResult) -> None:
        p = r.parsed
        if p["site_a"] not in site or p["site_b"] not in site:
            raise Skip("site not loaded")
        place_reservation(db, counts, p, site, user["planner1"], user["admin1"])

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
