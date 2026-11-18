"""A request that waits for the reservation lock must decide on the state the winner committed.

The winner is played by the test: it holds the lock, a second request starts and blocks on it, then the winner
writes its event and commits. The loser must see that event.
"""
import io
import time
from concurrent.futures import ThreadPoolExecutor

import pytest
from app import db as app_db
from app.auth.deps import CurrentUser
from app.ingest import reservation_upload as upload
from app.ingest.excel import parse_reservation_workbook
from app.inventory import service as _inventory  # imported first: inventory and reservations import each other
from app.reservations import service
from app.main import BUSY_MESSAGE, app
from fastapi import HTTPException
from fastapi.testclient import TestClient
from sqlalchemy import text
from sqlalchemy.orm import Session
from test_reservation_upload import row, workbook
from test_reservations import build

LOCK_SQL = "SELECT id FROM reservations WHERE id = :rid FOR UPDATE"
EVENT_SQL = "INSERT INTO reservation_events (reservation_id, type, user_id) VALUES (:rid, :kind, :uid)"
DELETE_HOLDS_SQL = "DELETE FROM core_holds WHERE reservation_id = :rid"
WAITING_SQL = "SELECT count(*) FROM pg_stat_activity WHERE pid = :pid AND wait_event_type = 'Lock'"
BACKEND_PID_SQL = "SELECT pg_backend_pid()"
LOCK_SEGMENT_SQL = "SELECT id FROM segments WHERE id = :segment_id FOR UPDATE"
RENAME_SITE_SQL = "UPDATE sites SET name = :new WHERE name = :old"
ADD_COUNT_ONLY_SQL = (
    "INSERT INTO reservations (customer_id, planner_id, unassigned_cores, unassigned_segment_id) "
    "VALUES (:customer_id, :planner_id, :cores, :segment_id) RETURNING id"
)
HELD_CORES_SQL = "SELECT count(*) FROM core_holds"
DISTINCT_HELD_CORES_SQL = "SELECT count(DISTINCT core_id) FROM core_holds"
IMPORTED_COUNT_SQL = "SELECT coalesce(sum(unassigned_cores), 0) FROM reservations WHERE imported"


def wait_until_the_loser_waits_for_a_lock(engine, loser_pid):
    """Waits for the loser's own backend, so another waiter in the database cannot end the wait early."""
    for _ in range(200):
        with engine.connect() as conn:
            if conn.execute(text(WAITING_SQL), {"pid": loser_pid}).scalar_one() > 0:
                return
        time.sleep(0.05)
    raise AssertionError("the second request never waited for the lock")


def user_of(user_id, role):
    return CurrentUser(id=user_id, username=role, display_name=role, role=role)


def play_race(engine, hold, finish, loser_action):
    """The winner holds a lock (hold), the loser starts and blocks on it, then the winner finishes and commits.

    Returns (HTTP status the loser got, what it returned); the status is 200 when it succeeded.
    """
    loser_pid = []

    def loser():
        with Session(engine) as session:
            loser_pid.append(session.execute(text(BACKEND_PID_SQL)).scalar_one())
            try:
                return 200, loser_action(session)
            except HTTPException as error:
                return error.status_code, None

    with ThreadPoolExecutor(1) as pool, Session(engine) as winner:
        hold(winner)
        future = pool.submit(loser)
        while not loser_pid:
            time.sleep(0.01)
        wait_until_the_loser_waits_for_a_lock(engine, loser_pid[0])
        finish(winner)
        winner.commit()
        return future.result(timeout=10)


def run_race(engine, reservation_id, winner_kind, winner_user_id, delete_holds, loser_action):
    """Returns the HTTP status the loser got (200 when it succeeded)."""
    params = {"rid": reservation_id, "kind": winner_kind, "uid": winner_user_id}

    def hold(winner):
        winner.execute(text(LOCK_SQL), params)

    def finish(winner):
        winner.execute(text(EVENT_SQL), params)
        if delete_holds:
            winner.execute(text(DELETE_HOLDS_SQL), params)

    return play_race(engine, hold, finish, loser_action)[0]


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
    try:
        w, reservation_id = make_pending_reservation(engine)
        admin = user_of(w["admin1"], "admin")
        status = run_race(engine, reservation_id, "withdrawn", w["planner1"], True,
                          lambda session: service.approve(session, admin, reservation_id))
        assert status == 409
        assert event_types(engine, reservation_id) == ["requested", "withdrawn"]
    finally:
        clean_up(engine)


def test_second_approve_is_refused_not_repeated(engine):
    try:
        w, reservation_id = make_pending_reservation(engine)
        admin = user_of(w["admin2"], "admin")
        status = run_race(engine, reservation_id, "approved", w["admin1"], False,
                          lambda session: service.approve(session, admin, reservation_id))
        assert status == 409
        assert event_types(engine, reservation_id) == ["requested", "approved"]
    finally:
        clean_up(engine)


# ---- count-only reservations: assign, and the upload against the dashboard ---------------------------------------

def make_count_only_reservation(engine, w, cores):
    with engine.begin() as conn:
        reservation_id = conn.execute(text(ADD_COUNT_ONLY_SQL), {
            "customer_id": w["cust"], "planner_id": w["planner1"], "cores": cores, "segment_id": w["s1"],
        }).scalar_one()
        for kind in ("requested", "approved"):
            conn.execute(text(EVENT_SQL), {"rid": reservation_id, "kind": kind, "uid": w["admin1"]})
    return reservation_id


def winner_assigns(admin, reservation_id, core_ids):
    """What assign() does after it has the reservation lock, written out so the winner can pause on the lock."""

    def hold(winner):
        service._lock(winner, reservation_id)

    def finish(winner):
        service._hold(winner, reservation_id, core_ids)
        event_id = service._event(winner, reservation_id, "assigned", admin)
        service._record_cores(winner, service.INSERT_ASSIGN_CORE_SQL, event_id, core_ids)

    return hold, finish


@pytest.mark.parametrize(("loser_cores", "expected_status", "expected_held"), [
    ([3, 4], 409, 2),  # only 1 unassigned core is left after the winner
    ([2], 409, 2),  # a core the winner already took
    ([3], 200, 3),  # fits in what is left
])
def test_two_assigns_never_give_more_cores_than_requested(engine, loser_cores, expected_status, expected_held):
    try:
        with engine.begin() as conn:
            w = build(conn)
        admin = user_of(w["admin1"], "admin")
        reservation_id = make_count_only_reservation(engine, w, 3)
        hold, finish = winner_assigns(admin, reservation_id, [w["c1"][1], w["c1"][2]])
        loser_core_ids = [w["c1"][number] for number in loser_cores]
        status, _ = play_race(engine, hold, finish,
                              lambda session: service.assign(session, user_of(w["admin2"], "admin"),
                                                             reservation_id, loser_core_ids))
        assert status == expected_status
        with engine.connect() as conn:
            assert conn.execute(text(HELD_CORES_SQL)).scalar_one() == expected_held
            assert conn.execute(text(DISTINCT_HELD_CORES_SQL)).scalar_one() == expected_held
    finally:
        clean_up(engine)


def make_world_with_one_free_core(engine):
    """Segment AABB-BBCC has 6 verified cores; 5 are held, so its Free count is 1. Returns the world."""
    with engine.begin() as conn:
        w = build(conn)
        conn.execute(text(RENAME_SITE_SQL), {"old": "A", "new": "AABB"})
        conn.execute(text(RENAME_SITE_SQL), {"old": "B", "new": "BBCC"})
    planner = user_of(w["planner1"], "planner")
    with Session(engine) as session:
        service.create(session, planner, w["cust"], None, [w["c1"][number] for number in range(1, 6)])
    return w


def stage_one_core_upload(engine, w):
    data = workbook(row(count=1, cores=None, survey=None, km=None))
    results, ignored = parse_reservation_workbook(io.BytesIO(data))
    with Session(engine) as session:
        return upload.stage(session, w["admin1"], "race.xlsx", results, ignored)["upload_id"]


def test_dashboard_booking_wins_then_the_upload_places_nothing(engine):
    try:
        w = make_world_with_one_free_core(engine)
        upload_id = stage_one_core_upload(engine, w)
        planner = user_of(w["planner2"], "planner")

        def hold(winner):
            service.lock_segments(winner, {w["s1"]})

        def finish(winner):
            service.create(winner, planner, w["cust2"], None, [w["c1"][6]])

        status, result = play_race(engine, hold, finish,
                                   lambda session: upload.confirm(session, w["admin1"], upload_id, []))
        assert status == 200
        assert result["counts"]["reservations"] == 0
        assert [skipped["row_number"] for skipped in result["skipped"]] == [2]
        assert upload.NO_ROOM_TEXT in result["skipped"][0]["reason"]
        with engine.connect() as conn:
            assert conn.execute(text(HELD_CORES_SQL)).scalar_one() == 6
            assert conn.execute(text(IMPORTED_COUNT_SQL)).scalar_one() == 0
    finally:
        clean_up(engine)


def test_upload_wins_then_the_dashboard_booking_is_refused(engine):
    try:
        w = make_world_with_one_free_core(engine)
        upload_id = stage_one_core_upload(engine, w)
        planner = user_of(w["planner2"], "planner")

        def hold(winner):
            service.lock_segments(winner, {w["s1"]})

        def finish(winner):
            upload.confirm(winner, w["admin1"], upload_id, [])

        status, _ = play_race(engine, hold, finish,
                              lambda session: service.create(session, planner, w["cust2"], None, [w["c1"][6]]))
        assert status == 409
        with engine.connect() as conn:
            assert conn.execute(text(HELD_CORES_SQL)).scalar_one() == 5
            assert conn.execute(text(IMPORTED_COUNT_SQL)).scalar_one() == 1
    finally:
        clean_up(engine)


def test_a_request_stuck_on_a_lock_gets_409_not_a_hang(engine, monkeypatch):
    monkeypatch.setattr(app_db, "LOCK_TIMEOUT", "300ms")  # the real value is slower than a test needs

    def real_session():
        with Session(engine) as session:
            yield session

    app.dependency_overrides[app_db.get_db] = real_session
    try:
        with engine.begin() as conn:
            w = build(conn)
        with engine.connect() as holder:
            holder.execute(text(LOCK_SEGMENT_SQL), {"segment_id": w["s1"]})
            started = time.monotonic()
            response = TestClient(app).post(
                "/api/reservations",
                json={"customer_id": w["cust"], "cores": [w["c1"][1]]},
                headers={"X-Dev-User": "planner1"},
            )
            waited = time.monotonic() - started
            holder.rollback()
        assert response.status_code == 409
        assert response.json() == {"detail": BUSY_MESSAGE}
        assert waited < 5
    finally:
        app.dependency_overrides.clear()
        clean_up(engine)
