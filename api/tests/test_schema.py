import pytest
from alembic import command
from sqlalchemy import text
from sqlalchemy.exc import DBAPIError, IntegrityError

from conftest import alembic_cfg


def one(db, sql, **p):
    return db.execute(text(sql), p).scalar_one()


@pytest.fixture
def ids(db):
    """A user, three sites, a span, a core and a reservation."""
    u = one(db, "INSERT INTO users (username, display_name, role) VALUES ('u','U','admin') RETURNING id")
    a, b, c = (one(db, "INSERT INTO sites (name, kind) VALUES (:n,'site') RETURNING id", n=n) for n in "ABC")
    span = one(db, "INSERT INTO spans (site_a_id, site_b_id) VALUES (:a,:b) RETURNING id", a=a, b=b)
    core = one(db, "INSERT INTO cores (span_id, number) VALUES (:s,1) RETURNING id", s=span)
    cust = one(db, "INSERT INTO customers (name) VALUES ('X') RETURNING id")
    res = one(db, "INSERT INTO reservations (customer_id, planner_id) VALUES (:c,:u) RETURNING id", c=cust, u=u)
    return dict(user=u, a=a, b=b, span=span, core=core, res=res)


def test_migration_roundtrip(engine):
    cfg = alembic_cfg()
    command.downgrade(cfg, "base")
    command.upgrade(cfg, "head")


@pytest.mark.parametrize("table", ["reservation_events", "measurements", "data_edits"])
@pytest.mark.parametrize("op", ["UPDATE {t} SET created_at = now()", "DELETE FROM {t}"])
def test_append_only(db, ids, table, op):
    i = ids
    db.execute(text({
        "reservation_events": "INSERT INTO reservation_events (reservation_id, type, user_id) VALUES (:res,'requested',:user)",
        "measurements": "INSERT INTO measurements (span_id, loss_db) VALUES (:span, 1.5)",
        "data_edits": "INSERT INTO data_edits (entity, entity_id, field, reason, user_id) VALUES ('core',1,'f','r',:user)",
    }[table]), i)
    with pytest.raises(DBAPIError, match="append-only"):
        db.execute(text(op.format(t=table)))


def test_second_hold_fails(db, ids):
    sql = "INSERT INTO core_holds (core_id, reservation_id) VALUES (:core, :res)"
    db.execute(text(sql), ids)
    with pytest.raises(IntegrityError):
        db.execute(text(sql), ids)


def test_reversed_span_fails(db, ids):
    with pytest.raises(IntegrityError):
        db.execute(text("INSERT INTO spans (site_a_id, site_b_id) VALUES (:b,:a)"), ids)


def test_blank_reason_fails(db, ids):
    with pytest.raises(IntegrityError):
        db.execute(text("INSERT INTO data_edits (entity, entity_id, field, reason, user_id) "
                        "VALUES ('core',1,'status','  ',:user)"), ids)


def status(db, core):
    return one(db, "SELECT status FROM core_status_v WHERE core_id = :c", c=core)


def event(db, i, kind):
    db.execute(text("INSERT INTO reservation_events (reservation_id, type, user_id) VALUES (:res,:k,:user)"),
               {**i, "k": kind})


def edit(db, i, value):
    db.execute(text("INSERT INTO data_edits (entity, entity_id, field, new_value, reason, user_id) "
                    "VALUES ('core',:core,'status',:v,'r',:user)"), {**i, "v": value})


def test_status_flow(db, ids):
    assert status(db, ids["core"]) == "Available"
    db.execute(text("INSERT INTO core_holds (core_id, reservation_id) VALUES (:core, :res)"), ids)
    event(db, ids, "requested")
    assert status(db, ids["core"]) == "Requested"
    event(db, ids, "approved")
    assert status(db, ids["core"]) == "Reserved"
    db.execute(text("UPDATE cores SET in_use = true WHERE id = :core"), ids)
    assert status(db, ids["core"]) == "In use"
    edit(db, ids, "Faulty")
    assert status(db, ids["core"]) == "Faulty"
    edit(db, ids, "Available")
    assert status(db, ids["core"]) == "In use"  # fault cleared, in_use still true
    db.execute(text("UPDATE cores SET in_use = false WHERE id = :core"), ids)
    db.execute(text("DELETE FROM core_holds"))
    assert status(db, ids["core"]) == "Available"
