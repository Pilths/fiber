# Optimization roadmap

Written 17 November 2026 from the architecture reviews of branch `dev` (architecture baseline, risk review, PostgreSQL and
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

Not covered by a test yet: two concurrent `assign` calls on one count-only reservation. They go through the same `_lock`,
so the fix applies, but only approve/withdraw and approve/approve are proven.

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

Left alone on purpose: `SESSION_SECRET` is in `.env.example` but nothing reads it (sessions are random tokens hashed in
the `sessions` table). The guard does not check it, so it does not force a value nobody uses. Decide later whether to
delete the variable.

Still open from the risk review: no TLS proxy in `docker-compose.yml`, containers run as root with dev servers
(item 9 below).

### 4. Logging (done)

- `api/app/observability.py`: `configure_logging()` (level from `LOG_LEVEL`, default INFO) and a request middleware.
  It logs 409 conflicts at INFO, requests of one second or more at WARNING, 5xx at ERROR, and unhandled exceptions with
  the traceback. It logs the path, never the query string (search text). `/api/health` is skipped.
- `logged_apply()` logs start, end with seconds, or failure for the Excel, segment list, site master and KMZ applies.
- Failed logins log a WARNING with the username and client address (`app.auth` logger). Passwords are never logged.

This is also the data for roadmap item 14: the slow-request lines show whether the map endpoints need work.

### 3, 5 to 13, 15 to 17. Done 18 and 19 November 2026 (branch `dev`, synced to `main`)

| # | Change | Commit |
|---|---|---|
| 3 | `scripts/backup-db.sh` (pg_dump to `backups/`, keeps 14, cron line in its header) and `scripts/restore-check.sh` (restore drill into a separate database). Copying `backups/` off the machine is still a manual step. | `7e4a349` |
| 5 | `GET /api/ready` returns 503 when `alembic_version` is not the head; `/api/health` stays liveness | `7e4a349` |
| 6 | Migration `0005`: indexes on 16 foreign-key columns (the 8 above plus `reservation_cores`, `release_cores`, `assign_cores` (core_id), `cores` (port_a_id, port_b_id), `reservation_events(user_id)`, `routes` (site_a_id, site_b_id)) | `7e4a349` |
| 7 | Reservation workbook and segment list applies update segments in id order. Site master apply touches no segments. | `7e4a349` |
| 8 | Login throttle: 5 failures per username, 20 per address, in 15 minutes, in process memory | `7e4a349` |
| 9 | Production stack on `main`: db and api only, web built in a Node stage and served by FastAPI, no reload or source mounts, non-root user, `restart: unless-stopped`. No TLS reverse proxy (owner decision, 18 Nov): plain HTTP with `COOKIE_SECURE=0`. | `c25db35`, `ac5245e` on `main` |
| 10 | Reservation workbook confirm locks its segments with `create()`'s lock (id order) and re-checks Free under it; a row that no longer fits is skipped. `lock_timeout` 5 s in `_lock`, `create()` and every upload apply; 55P03 and 40P01 answer 409. | `db47cd9` |
| 11 | Race tests: two `assign`, workbook confirm against `create()` in both orders, lock timeout. 8 race tests, stable on repeated runs. | `db47cd9` |
| 12 | Every environment variable is read through a function in `environment.py`; no other module reads `os.environ` | `c1b8fc7` |
| 13 | `segment_kml` reads its segment and that segment's routes only, not the whole map | `c1b8fc7` |
| 16 | A successful login deletes expired `sessions` rows | `c1b8fc7` |
| 17 | `docs/architecture.md` matches the code: planned features marked, two compose setups, lock timeout, throttle, logging, lint; pins checked | `c1b8fc7` |
| 15 | Services raise `ServiceError` (`api/app/errors.py`: NotFound, Conflict, Forbidden, Invalid) instead of `HTTPException`; one handler keeps the same JSON. `admin_edits` SQL not moved (only when those files are next touched). | `5f54c3a` |

## Immediate (1-2 weeks), still to do

Nothing left: all done (above).

## Short term (1-3 months)

| # | Change | Benefit | Risk | Complexity | ROI |
|---|---|---|---|---|---|
| 14 | Measure the map endpoints with the new slow-request log; cache only if needed | Avoids tuning on a guess | None | S | Medium |

## Long term (6-12 months)

| # | Change | Benefit | Risk | Complexity | ROI |
|---|---|---|---|---|---|
| 18 | Routing graph cache shared across workers (version row or `LISTEN/NOTIFY`) | Correct routes with more than one worker | Medium | M | Only if you add workers |
| 19 | Scheduler for the stale digest and email as one separate process | Builds the planned feature without running it once per worker | Medium (SMTP access undecided) | M | Medium |
| 20 | Split `ingest/reservation_upload.py` like `ingest/site_master/` | Smaller units | Low | M | Low-medium |
| 21 | Retire legacy seed paths after production goes live | Less dead code | Low | S | Low |
| 22 | Drop `segments.region` when nothing reads it | Removes an unused column | Low | S | Low |
| 23 | Archive old `upload_rows` and `reservation_events` | Storage and query control | Conflicts with "nothing is deleted"; owner decides | L | Low until row counts say so |

## Over-engineering for now

Microservices; Redis, Celery or a queue for the graph cache or uploads; materialised views or CQRS for core status;
partitioning events or staging rows; async SQLAlchemy; SERIALIZABLE isolation; PostGIS tuning without a measured
problem (the GiST index on `sites.geom` is unused by reads, no spatial predicate exists); Kubernetes or Helm; SSO;
a repository or DDD layer; rate-limit infrastructure beyond item 8.

## Order of work

1. Done: items 3, 5 to 13, 15 to 17.
2. Next: 14 once production has real traffic; 20 (split reservation_upload.py) when that file next changes.
3. Hold 14 and 18 until timing data or a worker-count decision exists.
