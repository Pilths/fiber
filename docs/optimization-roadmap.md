# Optimization roadmap

Last verified: 2026-11-26

Written 17 November 2026, status updated 20 November 2026 from the architecture reviews of branch `dev` (architecture baseline, risk review, PostgreSQL and
PostGIS review, FastAPI review). Complexity: S is under a day, M a few days, L weeks.

## Done

### 1. Reservation lock then read (done)

Problem: `_lock` in `api/app/reservations/service.py` locked the reservation row and read its state in one statement.
A request that waited for the lock kept the snapshot from before the wait, so it decided on state from before the winner
committed. `reservations` is append-only, so the locked row never changed and Postgres did not re-read it. Result:
a withdrawn or rejected reservation could be approved afterwards, and approve or keep could be recorded twice.

Change: `LOCK_RESERVATION_SQL` now only locks the row. `READ_RESERVATION_SQL` reads the state in a second statement, which
takes a fresh snapshot after the lock.

Proof: `api/tests/test_reservation_races.py` plays the winner by hand, starts the second request, waits until it is
blocked on the lock, then lets the winner commit. Both tests failed before the change (loser got 200) and pass after.

Two concurrent `assign` calls are covered by `test_two_assigns_never_give_more_cores_than_requested`.

### 2. Dev header, cookie flag, startup guard (done)

Problem: `X-Dev-User` logged in as any user whenever `APP_ENV=development`, which is the `.env.example` default. The
cookie was `Secure` only when `APP_ENV=production`, and the stack has no TLS proxy, so production had to choose between
a broken login and the bypass.

Change, in `api/app/environment.py`:

- `dev_header_allowed()` needs `APP_ENV=development` and `ALLOW_DEV_HEADER=1`.
- `cookie_secure()` follows `COOKIE_SECURE=1|0` when set, otherwise `APP_ENV=production` as before.
- `check_startup_environment()` runs when `app.main` is imported. Outside `APP_ENV=development` it refuses to start if
  `ALLOW_DEV_HEADER=1` is set, or `POSTGRES_PASSWORD` or `DATABASE_URL` is empty or still contains `change-me`.
  An unset `APP_ENV` counts as not development.

Tests: `api/tests/test_environment.py`. `api/tests/conftest.py` sets `ALLOW_DEV_HEADER=1` itself so tests do not
depend on a local `.env`.

Action for each machine: add `ALLOW_DEV_HEADER=1` to your `.env` if you call the API with an `X-Dev-User` header
(curl, scripts). The web app signs in with the login form and does not need it. `.env.example` has the line.

`SESSION_SECRET` was deleted from `.env.example` (owner decision, 24 November 2026): nothing read it, sessions are
random tokens hashed in the `sessions` table.

From the risk review: containers ran as root. Item 9b is done on `main` (`USER fiber` in `api/Dockerfile`); `dev` still runs as root. The missing TLS proxy is an owner decision
(plain HTTP, 18 November 2026).

### 4. Logging (done)

- `api/app/observability.py`: `configure_logging()` (level from `LOG_LEVEL`, default INFO) and a request middleware.
  It logs 409 conflicts at INFO, requests of one second or more at WARNING, 5xx at ERROR, and unhandled exceptions with
  the traceback. It logs the path, never the query string (search text). `/api/health` is skipped.
- `logged_apply()` logs start, end with seconds, or failure for the Excel, segment list, site master and KMZ applies.
- Failed logins log a WARNING with the username and client address (`app.auth` logger). Passwords are never logged.

This is also the data for roadmap item 14: the slow-request lines show whether the map endpoints need work.

### Items 3 and 5 to 17 (done, checked against code on 20 November 2026)

| # | Change | Where it lives |
|---|---|---|
| 3 | Scheduled `pg_dump` and restore drill | `scripts/backup-db.sh`, `scripts/restore-check.sh` |
| 5 | `/api/ready` compares `alembic_version` to head; `/api/health` stays liveness | `api/app/main.py`, `api/tests/test_ready.py` |
| 6 | Foreign-key indexes | migration `0005_foreign_key_indexes.py` |
| 7 | Segment updates sorted by id in the apply loops | `_segment_id_order` in `segment_list.py` and `reservation_upload.py` |
| 8 | Login throttle per username and address | `api/tests/test_login_throttle.py` |
| 9 | Production profile: `main` runs `db` and `api`, FastAPI serves the built web app, no reload, no source mounts. TLS proxy dropped by owner decision (18 November 2026). Non-root `USER` is done on `main` only (see 9b) | CLAUDE.md "Production", `docker-compose.yml` per branch |
| 10 | Upload apply re-checks Free under segment locks; `lock_timeout`; lock errors map to 409 | `set_lock_timeout` in `app/db.py`, used by `ingest/uploads.py` and `site_master/apply.py` |
| 11 | More concurrency tests | `api/tests/test_reservation_races.py`, commit `db47cd9` |
| 12 | Env reads in one place | `api/app/environment.py`, commit `c1b8fc7` |
| 13 | `segment_kml` reads one segment | `api/app/map/service.py` |
| 15 | Services raise domain errors; `HTTPException` only in routers | commit `5f54c3a`, `api/tests/test_service_errors.py` |
| 16 | Expired sessions purged on login | `DELETE_EXPIRED_SESSIONS` in `api/app/auth/router.py` |
| 17 | Unbuilt features marked "planned, not built" in `docs/architecture.md` | `docs/architecture.md` |

## Open

Short term:

| # | Change | Benefit | Risk | Complexity | ROI |
|---|---|---|---|---|---|
| 9b | Non-root `USER` in `api/Dockerfile`: done on `main` (`USER fiber`); the `dev` Dockerfile still has no `USER` line | Containers stop running as root | Low (bind-mount ownership on dev) | S | Medium |
| 14 | Measure the map endpoints with the slow-request log; cache only if needed | Avoids tuning on a guess | None | S | Medium |

## Long term (6-12 months), all open

| # | Change | Benefit | Risk | Complexity | ROI |
|---|---|---|---|---|---|
| 18 | Routing graph cache shared across workers (version row or `LISTEN/NOTIFY`) | Correct routes with more than one worker | Medium | M | Only if you add workers |
| 19 | Scheduler for the stale digest and email as one separate process | Builds the planned feature without running it once per worker | Medium (SMTP access undecided) | M | Medium |
| 20 | Split `ingest/reservation_upload.py` like `ingest/site_master/` | Smaller units | Low | M | Low-medium |
| 21 | Retire legacy seed paths after production goes live | Less dead code | Low | S | Low |
| 22 | Drop `segments.region` (still read by `app/models.py` and `ingest/checks.py` `map_region`, so first move those) | Removes an unused column | Low | S | Low |
| 23 | Archive old `upload_rows` and `reservation_events` | Storage and query control | Conflicts with "nothing is deleted"; owner decides | L | Low until row counts say so |

## Over-engineering for now

Microservices; Redis, Celery or a queue for the graph cache or uploads; materialised views or CQRS for core status;
partitioning events or staging rows; async SQLAlchemy; SERIALIZABLE isolation; PostGIS tuning without a measured
problem (the GiST index on `sites.geom` is unused by reads, no spatial predicate exists); Kubernetes or Helm; SSO;
a repository or DDD layer; rate-limit infrastructure beyond item 8.

## Order of work

1. Item 9b (non-root `USER`): done on `main`; `dev` still runs as root. If `dev` gets it, check that bind-mounted source and the `backups/` folder still write.
2. Item 14 once the slow-request log has a week of data; item 18 only if more than one worker is planned.
3. Item 19 when SMTP access is decided. Items 20 to 23 after production goes live.
