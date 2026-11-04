"""Load sites and segments from one workbook typed by hand, through the same code as the Upload tab.

    docker compose exec api python -m app.load_data --template data/fiber-data.xlsx   # blank Sites/Segments file
    docker compose exec api python -m app.load_data --reservation-template data/reservations.xlsx  # blank Reservation file
    docker compose exec api python -m app.load_data ADMIN data/fiber-data.xlsx        # load either file

Put the file in api/data/ (git-ignored; real data is never committed). ADMIN is an existing admin username
(make one with app.create_admin); every write is attributed to that admin and kept as history.

Sheet "Sites": site_name (4-letter LRD), latitude_in_decimal, longitude_in_decimal, region (optional),
    Type (optional: Trunk, DC, TOC; blank means Trunk).
Sheet "Segments": Link (AAAA-BBBB), Distance (km), Route, Section, Surveyed cores, Total cores.
Sheet "Reservation" (its own file; load sites and segments first): Region (optional: North, Central, South or
    East Coast; an unknown region makes the row Needs review and it is not imported), Nodes (site pair AAAA-BBBB; both sites must exist, the segment is
    matched by the pair), No of core requested (whole number, 1 or more: a count-only reservation, no specific cores),
    Fiber core requestor (the customer; a row without one is rejected), Fiber core request date and Expected CV Ready
    (Excel dates, or text as yyyy-mm-dd; other text makes the row Needs review), Contractor, Remark, SRF,
    Port Info, Fiber monitored Y/N/WIP (Y, N or WIP).
    Loaded like the Upload tab's Reservation workbook: reservations are only added, never changed, a row already
    imported is skipped on a re-run, and nothing is added once "Close reservation import" is closed.
Safe to run again: sites missing from the file are left alone, fields edited in the dashboard are kept,
and a survey count is only filled in where the segment has none yet.
"""
import sys
from typing import Any

import openpyxl
from sqlalchemy import text
from sqlalchemy.orm import Session

from app.db import engine
from app.ingest import reservation_upload as ru
from app.ingest import segment_list as sl
from app.ingest import site_master as sm
from app.ingest.checks import blank, clean
from app.ingest.excel import parse_reservation_workbook
from app.ingest.reservation_import import add_cores
from app.routing.graph import invalidate as invalidate_routes

SITES = ["site_name", "latitude_in_decimal", "longitude_in_decimal", "region", "Type"]
SEGMENTS = ["Link", "Distance", "Route", "Section", "Surveyed cores", "Total cores"]
RESERVATIONS = ["Region", "Nodes", "No of core requested", "Fiber core requestor", "Fiber core request date",
                "Expected CV Ready", "Contractor", "Remark", "SRF", "Port Info", "Fiber monitored Y/N/WIP"]
REASON = "data file load"


def template(path: str) -> None:
    wb = openpyxl.Workbook()
    ws = wb.active
    ws.title = "Sites"  # type: ignore[union-attr]
    ws.append(SITES)  # type: ignore[union-attr]
    wb.create_sheet("Segments").append(SEGMENTS)
    wb.save(path)
    print(f"Blank file written to {path}")


def reservation_template(path: str) -> None:
    wb = openpyxl.Workbook()
    ws = wb.active
    ws.title = "Reservation"  # type: ignore[union-attr]
    ws.append(RESERVATIONS)  # type: ignore[union-attr]
    wb.save(path)
    print(f"Blank file written to {path}")


def _count(v: Any) -> int | None | str:
    """Whole number, None when blank, or the problem text."""
    if blank(v):
        return None
    try:
        n = int(str(v).strip().removesuffix(".0"))
    except ValueError:
        return f"'{v}' is not a whole number"
    return n if n >= 0 else f"'{v}' is negative"


def survey_counts(db: Session, admin_id: int, path: str, filename: str) -> tuple[int, list[str]]:
    """Fill segments.survey_cores / cable_size from the Segments sheet where the dashboard has no value yet."""
    wb = openpyxl.load_workbook(path, read_only=True, data_only=True)
    ws = next((w for w in wb.worksheets if w.title.strip().lower() == "segments"), None)
    if ws is None:
        return 0, []
    rows = ws.iter_rows(values_only=True)
    head = [sm.hkey(h) if not blank(h) else "" for h in next(rows, ())]
    col = {k: head.index(k) for k in ("link", "surveyedcores", "totalcores") if k in head}
    if "link" not in col:
        return 0, []
    done, notes = 0, []
    for n, r in enumerate(rows, 2):
        cell = lambda k: clean(r[col[k]]) if k in col and col[k] < len(r) else None  # noqa: E731
        link = cell("link")
        if blank(link):
            continue
        a, _, b = str(link).strip().partition("-")
        seg = db.execute(text("SELECT s.id, s.survey_cores, s.cable_size FROM segments s JOIN sites x ON x.id = s.site_a_id "
                              "JOIN sites y ON y.id = s.site_b_id WHERE (x.name, y.name) IN ((:a, :b), (:b, :a))"),
                         {"a": a, "b": b}).mappings().first()
        if seg is None:
            continue  # the segment list step already reported why
        for key, field in (("surveyedcores", "survey_cores"), ("totalcores", "cable_size")):
            v = _count(cell(key))
            if isinstance(v, str) or (field == "cable_size" and v == 0):
                notes.append(f"Segments row {n} {link}: {key} {v if isinstance(v, str) else 'must be above 0'}")
                continue
            if v is None or v == seg[field]:
                continue
            if field == "survey_cores" and seg[field] is not None:
                notes.append(f"Segments row {n} {link}: dashboard already has {seg[field]} surveyed cores, file says {v}; kept")
                continue
            if field == "cable_size" and db.execute(text(
                    "SELECT 1 FROM data_edits WHERE entity = 'segment' AND entity_id = :i AND field = 'cable_size' AND reason NOT LIKE :r"),
                    {"i": seg["id"], "r": REASON + "%"}).first():
                continue  # edited in the dashboard
            if field == "survey_cores":
                add_cores(db, seg["id"], v)  # a new segment has no core rows yet
            db.execute(text(f"UPDATE segments SET {field} = :v WHERE id = :i"), {"v": v, "i": seg["id"]})
            db.execute(text("INSERT INTO data_edits (entity, entity_id, field, old_value, new_value, reason, user_id) "
                            "VALUES ('segment', :i, :f, :o, :n, :r, :u)"),
                       {"i": seg["id"], "f": field, "o": None if seg[field] is None else str(seg[field]), "n": str(v),
                        "r": f"{REASON} {filename}", "u": admin_id})
            done += 1
    db.commit()
    return done, notes


def problems(db: Session, upload_id: int) -> list[str]:
    return [f"{s} row {n}: {r}" for s, n, r in db.execute(text(
        "SELECT sheet, row_number, reason FROM upload_rows WHERE upload_id = :u AND status <> 'ready' ORDER BY sheet, row_number"),
        {"u": upload_id})]


def reservation_problems(db: Session, upload_id: int) -> list[str]:
    """Reservation rows carry their review state in row_group; their status column stays 'ready'."""
    rows = db.execute(text(
        "SELECT sheet, row_number, row_group, reason FROM upload_rows WHERE upload_id = :u AND entity = 'row' "
        "AND row_group IN ('needs_review', 'rejected') ORDER BY row_number"), {"u": upload_id})
    return [f"{sheet} row {number} ({group}): {reason}" for sheet, number, group, reason in rows]


def load_reservations(db: Session, admin_id: int, path: str, filename: str) -> None:
    """Stage and confirm the Reservation sheet with the Upload tab's code, so its rules (closed switch,
    already imported, insert-only) apply unchanged."""
    try:
        results, _ignored = parse_reservation_workbook(path)
    except ValueError:
        print("Reservations: none")
        return
    if not results:
        print("Reservations: none")
        return
    # the other sheets of this file are loaded by their own steps, so none are reported as left out
    staged = ru.stage(db, admin_id, filename, results, [])
    try:
        out = ru.confirm(db, admin_id, staged["upload_id"], [])
    except ru.ApplyError as error:
        print(f"Reservations not loaded: {error.message}")
        return
    counts = out["counts"]
    print(f"Reservations: {counts['reservations']} created, {len(out['skipped'])} skipped, "
          f"{out['ignored_reservation_rows']} ignored (import closed), {staged['counts']}")
    for warning in out["warnings"]:
        print("  warning:", warning["message"])
    for item in out["skipped"]:
        print(f"  skipped: Reservation row {item['row_number']}: {item['reason']}")
    for problem in reservation_problems(db, staged["upload_id"]):
        print("  needs review:", problem)


def load(db: Session, admin: str, path: str) -> int:
    admin_id = db.execute(text("SELECT id FROM users WHERE username = :u AND role = 'admin' AND active"), {"u": admin}).scalar()
    if admin_id is None:
        print(f"{admin} is not an active admin. Make one with: python -m app.create_admin {admin}")
        return 1
    name = path.rsplit("/", 1)[-1]
    with open(path, "rb") as f:
        parsed = sm.parse_workbook(f)
    if parsed["sites"].found:
        up = sm.stage(db, admin_id, name, parsed, add_only=True)
        try:
            out = sm.apply_upload(db, admin_id, up["upload_id"], {}, None, [], ["sites"])
            s = out["sheets"]["sites"]
            print(f"Sites: {s}")
        except sm.ApplyError as e:
            print(f"Sites not loaded: {e.message}")
        for p in problems(db, up["upload_id"]):
            print("  needs review:", p)
    with open(path, "rb") as f:
        parsed_seg = sl.parse_workbook(f)
    if parsed_seg.found:
        up = sl.stage(db, admin_id, name, parsed_seg)
        try:
            out = sl.apply_upload(db, admin_id, up["upload_id"])
            print(f"Segments: {out['created']} created, {out['changed']} changed, {out['protected_kept']} dashboard edits kept, "
                  f"{out['skipped']} skipped")
        except sm.ApplyError as e:
            print(f"Segments not loaded: {e.message}")
        for p in problems(db, up["upload_id"]):
            print("  needs review:", p)
    done, notes = survey_counts(db, admin_id, path, name)
    invalidate_routes()
    print(f"Survey counts: {done} set")
    for x in notes:
        print("  kept:", x)
    load_reservations(db, admin_id, path, name)
    return 0


def main(argv: list[str]) -> int:
    if len(argv) == 2 and argv[0] == "--template":
        template(argv[1])
        return 0
    if len(argv) == 2 and argv[0] == "--reservation-template":
        reservation_template(argv[1])
        return 0
    if len(argv) != 2:
        print(__doc__)
        return 2
    with Session(engine) as db:
        return load(db, argv[0], argv[1])


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
