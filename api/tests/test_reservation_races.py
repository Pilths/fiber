"""A request that waits for the reservation lock must decide on the state the winner committed.

The winner is played by the test: it holds the lock, a second request starts and blocks on it, then the winner
writes its event and commits. The loser must see that event.
"""
import time
from concurrent.futures import ThreadPoolExecutor

from app.auth.deps import CurrentUser
from app.inventory import service as _inventory  # imported first: inventory and reservations import each other
from app.reservations import service
from fastapi import HTTPException
from sqlalchemy import text
from sqlalchemy.orm import Session
from test_reservations import build

LOCK_SQL = "SELECT id FROM reservations WHERE id = :rid FOR UPDATE"
EVENT_SQL = "INSERT INTO reservation_events (reservation_id, type, user_id) VALUES (:rid, :kind, :uid)"
DELETE_HOLDS_SQL = "DELETE FROM core_holds WHERE reservation_id = :rid"
WAITING_SQL = "SELECT count(*) FROM pg_stat_activity WHERE datname = current_database() AND wait_event_type = 'Lock'"


def wait_until_a_request_waits_for_a_lock(engine):
    for _ in range(100):
        with engine.connect() as conn:
            if conn.execute(text(WAITING_SQL)).scalar_one() > 0:
                return
        time.sleep(0.05)
    raise AssertionError("the second request never waited for the lock")


def user_of(user_id, role):
    return CurrentUser(id=user_id, username=role, display_name=role, role=role)


def run_race(engine, reservation_id, winner_kind, winner_user_id, delete_holds, loser_action):
    """Returns the HTTP status the loser got (200 when it succeeded)."""

    def loser():
        with Session(engine) as session:
            try:
                loser_action(session)
            except HTTPException as error:
                return error.status_code
        return 200

    with ThreadPoolExecutor(1) as pool, engine.connect() as winner:
        params = {"rid": reservation_id, "kind": winner_kind, "uid": winner_user_id}
        winner.execute(text(LOCK_SQL), params)
        future = pool.submit(loser)
        wait_until_a_request_waits_for_a_lock(engine)
        winner.execute(text(EVENT_SQL), params)
        if delete_holds:
            winner.execute(text(DELETE_HOLDS_SQL), params)
        winner.commit()
        return future.result(timeout=10)


def make_pending_reservation(engine):
    with engine.begin() as conn:
        w = build(conn)
    planner = user_of(w["planner1"], "planner")
    with Session(engine) as session:
        reservation = service.create(session, planner, w["cust"], None, [w["c1"][1]])
    return w, reservation.id


def clean_up(engine):
    with engine.begin() as conn:
        conn.execute(text("TRUNCATE users, sites, customers CASCADE"))


def event_types(engine, reservation_id):
    with engine.connect() as conn:
        rows = conn.execute(text("SELECT type FROM reservation_events WHERE reservation_id = :rid ORDER BY id"),
                            {"rid": reservation_id})
        return [row[0] for row in rows]


def test_approve_after_a_withdraw_is_refused(engine):
    w, reservation_id = make_pending_reservation(engine)
    admin = user_of(w["admin1"], "admin")
    try:
        status = run_race(engine, reservation_id, "withdrawn", w["planner1"], True,
                          lambda session: service.approve(session, admin, reservation_id))
        assert status == 409
        assert event_types(engine, reservation_id) == ["requested", "withdrawn"]
    finally:
        clean_up(engine)


def test_second_approve_is_refused_not_repeated(engine):
    w, reservation_id = make_pending_reservation(engine)
    admin = user_of(w["admin2"], "admin")
    try:
        status = run_race(engine, reservation_id, "approved", w["admin1"], False,
                          lambda session: service.approve(session, admin, reservation_id))
        assert status == 409
        assert event_types(engine, reservation_id) == ["requested", "approved"]
    finally:
        clean_up(engine)
