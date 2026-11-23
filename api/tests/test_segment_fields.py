"""The shared segment field writer writes nothing when the value is the same."""
from app.ingest.segment_fields import same_value, write_segment_field
from sqlalchemy import text
from test_auth import mkuser


def test_numbers_compare_as_numbers():
    assert same_value("distance_km", "12.000", 12)
    assert same_value("survey_cores", 12, "12")
    assert not same_value("distance_km", "12.000", "12.001")
    assert not same_value("distance_km", None, 12)
    assert same_value("route", "R1", "R1")


def test_same_value_writes_no_history_row(db):
    admin_id = mkuser(db, "boss", "admin")
    for name in ("AAAA", "BBBB"):
        db.execute(text("INSERT INTO sites (name, kind) VALUES (:name, 'site')"), {"name": name})
    segment_id = db.execute(
        text(
            "INSERT INTO segments (site_a_id, site_b_id, distance_km) "
            "SELECT a.id, b.id, 12 FROM sites a, sites b WHERE a.name = 'AAAA' AND b.name = 'BBBB' RETURNING id"
        )
    ).scalar_one()
    assert not write_segment_field(db, admin_id, None, segment_id, "distance_km", "12.000", 12, "note")
    assert write_segment_field(db, admin_id, None, segment_id, "distance_km", "12.000", "13.5", "note")
    query = text("SELECT old_value, new_value FROM data_edits WHERE entity_id = :segment_id")
    edits = db.execute(query, {"segment_id": segment_id}).all()
    assert edits == [("12.000", "13.5")]
