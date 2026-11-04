"""load_data command: one hand-typed workbook loads sites, segments and survey counts; a second run changes nothing."""
import openpyxl
from sqlalchemy.orm import Session
from test_auth import mkuser

from app import load_data as ld
from app.ingest.reservation_upload import close_import


def run(monkeypatch, db, tmp_path, sites, segments, reservations=None):
    wb = openpyxl.Workbook()
    ws = wb.create_sheet("Sites")
    for r in [ld.SITES, *sites]:
        ws.append(r)
    ws = wb.create_sheet("Segments")
    for r in [ld.SEGMENTS, *segments]:
        ws.append(r)
    if reservations is not None:
        ws = wb.create_sheet("Reservation")
        for r in [ld.RESERVATIONS, *reservations]:
            ws.append(r)
    path = tmp_path / "data.xlsx"
    wb.save(path)
    monkeypatch.setattr(ld, "Session", lambda _engine: Session(bind=db))
    return ld.main(["boss1", str(path)])


def test_loads_sites_segments_and_counts_then_reruns_cleanly(db, monkeypatch, tmp_path, capsys):
    mkuser(db, "boss1", "admin")
    sites = [["AAAA", 3.1, 101.6, None], ["BBBB", 3.2, 101.7, None], ["CCCC", 0, 0, None]]
    segs = [["AAAA-BBBB", 32.5, "R1", None, 24, 144], ["AAAA-CCCC", 5, None, None, 12, None]]
    assert run(monkeypatch, db, tmp_path, sites, segs) == 0
    out = capsys.readouterr().out
    assert "CCCC" in out and "needs review" in out  # bad coordinates and unknown site are reported, not guessed
    seg = db.exec_driver_sql("SELECT s.distance_km, s.survey_cores, s.cable_size, "
                             "(SELECT count(*) FROM cores c WHERE c.segment_id = s.id) FROM segments s").all()
    assert [(str(d), sc, cs, n) for d, sc, cs, n in seg] == [("32.500", 24, 144, 24)]
    assert db.exec_driver_sql("SELECT count(*) FROM data_edits WHERE reason LIKE 'data file load%%'").scalar() == 1  # survey count
    # second run with a different survey count keeps the first one
    segs[0][4] = 48
    assert run(monkeypatch, db, tmp_path, sites, segs[:1]) == 0
    assert "already has 24" in capsys.readouterr().out
    assert db.exec_driver_sql("SELECT survey_cores FROM segments").scalar() == 24


def test_unknown_admin_and_template(db, monkeypatch, tmp_path):
    assert run(monkeypatch, db, tmp_path, [], []) == 1
    p = tmp_path / "t.xlsx"
    assert ld.main(["--template", str(p)]) == 0
    wb = openpyxl.load_workbook(p)
    assert wb.sheetnames == ["Sites", "Segments", "Reservation"]
    assert [c.value for c in wb["Sites"][1]] == ld.SITES
    assert [c.value for c in wb["Segments"][1]] == ld.SEGMENTS
    assert [c.value for c in wb["Reservation"][1]] == [
        "Region", "Nodes", "No of core requested", "Fiber core requestor", "Fiber core request date",
        "Expected CV Ready", "Contractor", "Remark", "SRF", "Port Info", "Fiber monitored Y/N/WIP"]


def test_invisible_characters_from_copied_cells_are_ignored(db, monkeypatch, tmp_path):
    mkuser(db, "boss1", "admin")
    zw, nb = "​", " "
    sites = [["AAAA" + zw, f"3.1{zw}", f"{nb}101.6", None], ["BBBB", "3.2", f"101.7{zw}", None]]
    segs = [[f"AAAA-BBBB{zw}", f"32.5{zw}", None, None, f"24{zw}", None]]
    assert run(monkeypatch, db, tmp_path, sites, segs) == 0
    assert db.exec_driver_sql("SELECT count(*) FROM sites WHERE name IN ('AAAA', 'BBBB') AND geom IS NOT NULL").scalar() == 2
    assert db.exec_driver_sql("SELECT survey_cores FROM segments").scalar() == 24
    raw = db.exec_driver_sql("SELECT raw->>'latitude_in_decimal' FROM upload_rows WHERE raw->>'site_name' LIKE 'AAAA%%'").scalar()
    assert raw == f"3.1{zw}"  # raw cell kept exactly as read


SITES = [["AAAA", 3.1, 101.6, None], ["BBBB", 3.2, 101.7, None]]
SEGS = [["AAAA-BBBB", 32.5, "R1", None, 24, 144]]
GOOD = ["South", "AAAA-BBBB", 3, "Acme", "2026-02-01", None, None, None, "SRF-1", None, "Y"]
NO_CUSTOMER = ["South", "AAAA-BBBB", 2, None, None, None, None, None, None, None, None]


def reservations(db):
    return db.exec_driver_sql("SELECT unassigned_cores, planner_id FROM reservations").all()


def test_reservation_sheet_loads_once_and_reports_rejected_row(db, monkeypatch, tmp_path, capsys):
    admin = mkuser(db, "boss1", "admin")
    rows = [GOOD, NO_CUSTOMER]
    assert run(monkeypatch, db, tmp_path, SITES, SEGS, rows) == 0
    out = capsys.readouterr().out
    assert "Reservations: 1 created" in out
    assert "Reservation row 3 (rejected): blank requestor" in out
    assert [n for n, _ in reservations(db)] == [3]
    assert db.exec_driver_sql("SELECT count(*) FROM reservation_cores").scalar() == 0
    assert run(monkeypatch, db, tmp_path, SITES, SEGS, rows) == 0  # re-run
    assert len(reservations(db)) == 1
    assert "Reservations: 0 created" in capsys.readouterr().out
    assert reservations(db)[0][1] == admin


def test_closed_import_ignores_reservation_rows(db, monkeypatch, tmp_path, capsys):
    admin_id = mkuser(db, "boss1", "admin")
    close_import(Session(bind=db), admin_id, "test")
    assert run(monkeypatch, db, tmp_path, SITES, SEGS, [GOOD]) == 0
    assert "import is closed" in capsys.readouterr().out
    assert reservations(db) == []


def test_no_reservation_rows_creates_no_upload(db, monkeypatch, tmp_path, capsys):
    mkuser(db, "boss1", "admin")
    assert run(monkeypatch, db, tmp_path, SITES, SEGS, []) == 0
    assert "Reservations: none" in capsys.readouterr().out
    assert db.exec_driver_sql("SELECT count(*) FROM uploads WHERE filename = 'data.xlsx' AND summary ? 'ignored_sheets'").scalar() == 0


def test_reservation_row_without_region_needs_review(db, monkeypatch, tmp_path, capsys):
    mkuser(db, "boss1", "admin")
    assert run(monkeypatch, db, tmp_path, SITES, SEGS, [[None, *GOOD[1:]]]) == 0
    assert "Reservation row 2 (needs_review): " in capsys.readouterr().out
    assert reservations(db) == []
