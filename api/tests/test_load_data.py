"""load_data command: one hand-typed workbook loads sites, segments and survey counts; a second run changes nothing."""
import openpyxl
from sqlalchemy.orm import Session
from test_auth import mkuser

from app import load_data as ld


def run(monkeypatch, db, tmp_path, sites, segments):
    wb = openpyxl.Workbook()
    ws = wb.create_sheet("Sites")
    for r in [ld.SITES, *sites]:
        ws.append(r)
    ws = wb.create_sheet("Segments")
    for r in [ld.SEGMENTS, *segments]:
        ws.append(r)
    path = tmp_path / "data.xlsx"
    wb.save(path)
    monkeypatch.setattr(ld, "Session", lambda _engine: Session(bind=db))
    return ld.main(["boss1", str(path)])


def test_loads_sites_segments_and_counts_then_reruns_cleanly(db, monkeypatch, tmp_path, capsys):
    mkuser(db, "boss1", "admin")
    sites = [["AAAA", 3.1, 101.6, None], ["BBBB", 3.2, 101.7, None], ["CCCC", 0, 0, None]]
    segs = [["AAAA-BBBB", 32.5, "R1", None, "Trunk", 24, 144], ["AAAA-CCCC", 5, None, None, None, 12, None]]
    assert run(monkeypatch, db, tmp_path, sites, segs) == 0
    out = capsys.readouterr().out
    assert "CCCC" in out and "needs review" in out  # bad coordinates and unknown site are reported, not guessed
    seg = db.exec_driver_sql("SELECT s.distance_km, s.route_type, s.survey_cores, s.cable_size, "
                             "(SELECT count(*) FROM cores c WHERE c.segment_id = s.id) FROM segments s").all()
    assert [(str(d), t, sc, cs, n) for d, t, sc, cs, n in seg] == [("32.500", "Trunk", 24, 144, 24)]
    assert db.exec_driver_sql("SELECT count(*) FROM data_edits WHERE reason LIKE 'data file load%%'").scalar() == 1  # survey count
    # second run with a different survey count keeps the first one
    segs[0][5] = 48
    assert run(monkeypatch, db, tmp_path, sites, segs[:1]) == 0
    assert "already has 24" in capsys.readouterr().out
    assert db.exec_driver_sql("SELECT survey_cores FROM segments").scalar() == 24


def test_unknown_admin_and_template(db, monkeypatch, tmp_path):
    assert run(monkeypatch, db, tmp_path, [], []) == 1
    p = tmp_path / "t.xlsx"
    assert ld.main(["--template", str(p)]) == 0
    assert [c.value for c in openpyxl.load_workbook(p)["Segments"][1]] == ld.SEGMENTS
