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

## Immediate (1-2 weeks), still to do

| # | Change | Benefit | Risk | Complexity | ROI |
|---|---|---|---|---|---|
| 3 | Scheduled `pg_dump` and a written restore drill | The database is the source of truth; this is the only protection against losing the volume | Low | S | Very high |
| 5 | `/api/ready` that compares `alembic_version` to head; keep `/api/health` as liveness | Schema drift fails loudly | Low (keep compose on liveness) | S | High |
| 6 | Migration `0005`: `core_holds(reservation_id)`, `upload_rows(upload_id)`, `reservations(customer_id)`, `(planner_id)`, `(unassigned_segment_id)`, `segments(site_a_id)`, `(site_b_id)`, `route_segments(segment_id)` | Removes scans in `reservation_state_v`, staging reads and map site query | Very low | S | Medium |
| 7 | Sort segment updates by id in the apply loops (`reservation_upload.py`, `segment_list.py`, `site_master/apply.py`) | Removes a lock-order inversion against `create()` | Low | S | Medium |
| 8 | Login throttle per username and address, in process memory | Closes unbounded password guessing | Low (resets on restart, per worker) | S | Medium-high |

## Short term (1-3 months)

| # | Change | Benefit | Risk | Complexity | ROI |
|---|---|---|---|---|---|
| 9 | Production compose profile: built static web, no `--reload`, no bind mounts, non-root `USER`, TLS reverse proxy | Deploy artifact matches production | Medium (must stay one compose family) | M | High |
| 10 | Upload apply: re-check `free_to_reserve` under segment locks at apply time; `SET LOCAL lock_timeout`; map 40P01 and 55P03 to 409 | Closes the preview-to-apply race, bounds blocking | Medium | M | High |
| 11 | More concurrency tests: two `assign`, import apply against `create()` | Locks in items 1 and 10 | Low | M | High |
| 12 | One settings object for env reads | Easier tests, one place for the guards | Low | S | Medium |
| 13 | `segment_kml` reads one segment instead of building the whole map | Removes a known shortcut | Low | S | Medium |
| 14 | Measure the map endpoints with the new slow-request log; cache only if needed | Avoids tuning on a guess | None | S | Medium |
| 15 | Domain exceptions instead of `HTTPException` in services; move `admin_edits` SQL into services as files are touched | Services reusable from CLI and the future scheduler | Medium (many handlers, e2e covers them) | L | Medium |
| 16 | Purge expired `sessions` on login | Stops table growth | Very low | S | Low |
| 17 | Remove unbuilt features from `docs/architecture.md` or mark them planned | Accurate picture | None | S | Low-medium |

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

1. Items 3, 5 to 8 next (all small).
2. Items 9 to 11 together, because the production profile needs the concurrency tests.
3. Hold 14 and 18 until timing data or a worker-count decision exists.
