"""Load sites and segments from one workbook typed by hand, through the same code as the Upload tab.

    docker compose exec api python -m app.load_data --template data/fiber-data.xlsx   # blank Sites/Segments file
    docker compose exec api python -m app.load_data --reservation-template data/reservations.xlsx
        # blank Reservation file
    docker compose exec api python -m app.load_data ADMIN data/fiber-data.xlsx        # load either file

Put the file in api/data/ (git-ignored; real data is never committed). ADMIN is an existing admin username
(make one with app.create_admin); every write is attributed to that admin and kept as history.

Sheet "Sites": site_name (any length, no '-'), latitude_in_decimal, longitude_in_decimal, region (optional),
    Type (optional: Trunk, DC, TOC; blank means Trunk).
Sheet "Segments": Link (AAAA-BBBB), Distance (km), Route, Section, Verified cores (old files with
    "Surveyed cores" still load), Total cores.
Sheet "Reservation" (its own file; load sites and segments first): Region (optional: North, Central, South or
    East Coast; an unknown region makes the row Needs review and it is not imported), Nodes (site pair AAAA-BBBB;
    both sites must exist, the segment is matched by the pair), No of core requested (whole number,
    1 or more: a count-only
    reservation, no specific cores),
    Fiber core requestor (the customer; a row without one is rejected), Fiber core request date and Expected CV Ready
    (Excel dates, or text as yyyy-mm-dd; other text makes the row Needs review), Contractor, Remark, SRF,
    Port Info, Fiber monitored Y/N/WIP (Y, N or WIP).
    Loaded like the Upload tab's Reservation workbook: reservations are only added, never changed, a row already
    imported is skipped on a re-run, and nothing is added once "Close reservation import" is closed.
Segments go through the Upload tab's Segment list code, Verified cores and Total cores included (blank never clears
a value; a count cannot go below the core rows that already exist). The command exits 1 when any row is Needs review
or Rejected or any change is blocked; Ready rows still load.
Safe to run again: sites missing from the file are left alone and fields edited in the dashboard are kept.
"""
import sys

import openpyxl
from sqlalchemy import text
from sqlalchemy.orm import Session

from app.db import engine
from app.ingest import reservation_upload as ru
from app.ingest import segment_list as sl
from app.ingest import site_master as sm
from app.ingest.excel import parse_reservation_workbook
from app.routing.graph import invalidate as invalidate_routes

SELECT_UPLOAD_PROBLEMS = """
    SELECT sheet, row_number, status, row_group, reason FROM upload_rows
    WHERE upload_id = :u
      AND (status <> 'ready' OR (entity = 'row' AND row_group IN ('needs_review', 'rejected')))
    ORDER BY sheet, row_number
"""
SELECT_ACTIVE_ADMIN = "SELECT id FROM users WHERE username = :u AND role = 'admin' AND active"

SITES = ["site_name", "latitude_in_decimal", "longitude_in_decimal", "region", "Type"]
SEGMENTS = ["Link", "Distance", "Route", "Section", "Verified cores", "Total cores"]
RESERVATIONS = ["Region", "Nodes", "No of core requested", "Fiber core requestor", "Fiber core request date",
                "Expected CV Ready", "Contractor", "Remark", "SRF", "Port Info", "Fiber monitored Y/N/WIP"]


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


def problems(db: Session, upload_id: int) -> list[str]:
    """Rows that need a look. Most rows keep that in status; Reservation rows keep it in row_group."""
    rows = db.execute(text(SELECT_UPLOAD_PROBLEMS), {"u": upload_id})
    return [f"{sheet} row {number} ({status if status != 'ready' else group}): {reason}"
            for sheet, number, status, group, reason in rows]


def print_problems(db: Session, upload_id: int) -> int:
    found = problems(db, upload_id)
    for problem in found:
        print("  needs review:", problem)
    return len(found)


def load_reservations(db: Session, admin_id: int, path: str, filename: str) -> int:
    """Stage and confirm the Reservation sheet with the Upload tab's code, so its rules (closed switch,
    already imported, insert-only) apply unchanged. Returns how many rows need review."""
    try:
        results, _ignored = parse_reservation_workbook(path)
    except ValueError:
        print("Reservations: none")
        return 0
    if not results:
        print("Reservations: none")
        return 0
    # the other sheets of this file are loaded by their own steps, so none are reported as left out
    staged = ru.stage(db, admin_id, filename, results, [])
    try:
        out = ru.confirm(db, admin_id, staged["upload_id"], [])
    except ru.ApplyError as error:
        print(f"Reservations not loaded: {error.message}")
        return 1
    counts = out["counts"]
    print(f"Reservations: {counts['reservations']} created, {len(out['skipped'])} skipped, "
          f"{out['ignored_reservation_rows']} ignored (import closed), {staged['counts']}")
    for warning in out["warnings"]:
        print("  warning:", warning["message"])
    for item in out["skipped"]:
        print(f"  skipped: Reservation row {item['row_number']}: {item['reason']}")
    return print_problems(db, staged["upload_id"])


def load(db: Session, admin: str, path: str) -> int:
    admin_id = db.execute(text(SELECT_ACTIVE_ADMIN), {"u": admin}).scalar()
    if admin_id is None:
        print(f"{admin} is not an active admin. Make one with: python -m app.create_admin {admin}")
        return 1
    name = path.rsplit("/", 1)[-1]
    problem_count = 0
    with open(path, "rb") as f:
        parsed = sm.parse_workbook(f)
    if parsed["sites"].found:
        up = sm.stage(db, admin_id, name, parsed, add_only=True)
        try:
            out = sm.apply_upload(db, admin_id, up["upload_id"], {}, None, ["sites"])
            s = out["sheets"]["sites"]
            print(f"Sites: {s}")
        except sm.ApplyError as e:
            print(f"Sites not loaded: {e.message}")
        problem_count += print_problems(db, up["upload_id"])
    with open(path, "rb") as f:
        parsed_seg = sl.parse_workbook(f)
    if parsed_seg.found:
        up = sl.stage(db, admin_id, name, parsed_seg)
        try:
            out = sl.apply_upload(db, admin_id, up["upload_id"])
            print(
                f"Segments: {out['created']} created, {out['changed']} changed, "
                f"{out['protected_kept']} dashboard edits kept, {out['blocked']} blocked, {out['skipped']} skipped"
            )
            for blocked in out["blocked_changes"]:
                print("  blocked:", blocked)
            problem_count += out["blocked"]
        except sm.ApplyError as e:
            print(f"Segments not loaded: {e.message}")
        problem_count += print_problems(db, up["upload_id"])
    invalidate_routes()
    problem_count += load_reservations(db, admin_id, path, name)
    if problem_count:
        return 1
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
