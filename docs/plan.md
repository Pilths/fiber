---
goal: Fiber Dashboard MVP, built in sessions 0 to 12 and following the PRD cut order
version: 1.0
date_created: 2026-10-21
last_updated: 2026-10-21
owner: Fiber Dashboard developer (one person, AI-assisted)
status: 'Planned'
tags: [feature, architecture, mvp]
---

# Introduction

![Status: Planned](https://img.shields.io/badge/status-Planned-blue)

This plan builds the Fiber Dashboard MVP described in `docs/PRD.md`, using the design in `docs/architecture.md`. The deadline is 31 October 2026. There is one phase per build session from `docs/fiber-dashboard-workflow.md`, plus a release phase. The order builds the items the PRD would cut last first, so the cuts (email first, then the real KMZ map, then span and site editing) can be made without breaking anything already built.

The plan is saved at `docs/plan.md`, the path the workflow names, instead of the template's `/plan/` folder.

## 1. Requirements & Constraints

- **REQ-001**: Planners search by customer, span, circuit ID and core, and see a port grid per span with each core's status (PRD story 1).
- **REQ-002**: Planners request cores for a customer with a planned date. A request holds its cores as Requested, approval reserves them, and rejection or withdrawal frees them. The first request submitted wins (PRD story 2).
- **REQ-003**: A reservation is stale 3 months after approval or its latest keep. Stale reservations, release requests, upload conflicts and faulty held cores appear in Needs review and in the header bell count (PRD story 3).
- **REQ-004**: Per span, show calculated loss (distance × 0.3 dB/km), the latest measured loss, deviation in percent and a warning level. A span with no distance shows no calculated loss, never 0 dB (PRD story 4).
- **REQ-005**: Route planning between two segment end sites returns up to 3 options with km, estimated dB, fewest free cores and loss confidence (PRD story 5).
- **REQ-006**: A MapLibre map shows KMZ routes, one per segment, with data center and TOC markers (PRD story 6).
- **REQ-007**: Local accounts with planner and admin roles, forced password change at first login, deactivation instead of deletion (PRD story 7).
- **REQ-008**: Admins upload Excel and KMZ in three steps (Upload, Preview, Confirm). Nothing is saved before Confirm (PRD story 8).
- **REQ-009**: Admins edit core status (Faulty or Available), span details and site details, each with a reason (PRD story 8).
- **REQ-010**: A daily email digest per planner of their stale reservations, and an email to admins on each new request (PRD stories 2 and 3; first cut).
- **SEC-001**: Every write stores the acting `user_id`. Every data edit stores a reason. Nothing is deleted; accounts are deactivated.
- **SEC-002**: Secrets (database password, session secret, SMTP credentials) come from environment variables. `.env` is never committed.
- **SEC-003**: Admin endpoints require the admin role on the server. Hiding them in the UI is not enough.
- **SEC-004**: No request leaves the company network: no external map API, CDN, font host or analytics.
- **SEC-005**: Passwords are hashed with Argon2. Sessions use an httpOnly, SameSite=Lax cookie, Secure outside development.
- **CON-001**: MVP deadline is 31 October 2026, built by one person.
- **CON-002**: Cut order if time runs short: (1) email digest and request emails, (2) real KMZ routes on the map (fall back to the SVG map from the v6 mock), (3) span and site editing. Core status editing always stays.
- **CON-003**: Versions are pinned as listed in `docs/architecture.md`, section 4. TypeScript stays on 6.x.
- **CON-004**: Desktop first. WCAG 2.1 AA, text contrast at least 4.5:1, status and warning levels never shown by colour alone, light and dark themes, keyboard-operable controls and side panels.
- **CON-005**: Two sites have at most one span. Uploads match spans by the site pair in either order, segments by their two end sites, and ports by Port ID.
- **CON-006**: KMZ route names have the form `<site A name> - <site B name>`.
- **CON-007**: The code is developed on a personal laptop, then tested on a work laptop, then on a dev server, then deployed to the production server. The same Docker Compose setup must run unchanged on all four. Anything that differs between machines lives only in `.env`.
- **CON-008**: Source code travels by Outlook email, so only source goes by email: one zip made with `git archive --format=zip -o fiber.zip HEAD` (no `node_modules`, no `.env`, no images, no map tiles). Images are built on each machine from Docker Hub, npm and PyPI, the only approved download sources. Any other source needs an IT ticket.
- **CON-009**: Dependency installs must be reproducible on every machine. Commit `web/package-lock.json`, and an exact Python lock file `api/requirements.lock` generated with `pip freeze` inside the api container. The api Dockerfile installs from the lock file.
- **GUD-001**: Stub first, then real. Each endpoint exists first as a stub returning mock data, the TypeScript client is generated from FastAPI's OpenAPI spec, and the stub is replaced by real logic later.
- **GUD-002**: Delegate per `CLAUDE.md`: Haiku for mechanical work, Sonnet for code and doc edits needing judgment, main chat for decisions and reviewing diffs.
- **GUD-003**: One phase per session. A phase is done only when its completion criteria pass and the diff has been reviewed (workflow Step 8).
- **PAT-001**: Append-only history. Tables `reservation_events`, `measurements` and `data_edits` reject UPDATE and DELETE with a database trigger.
- **PAT-002**: Database constraints over application checks. "First request wins" is the primary key on `core_holds.core_id`.
- **PAT-003**: Derived state over stored flags. Core status, stale reservations, Needs review and the bell count are computed by queries at read time.
- **PAT-004**: One FastAPI app split into modules under `api/app/`: `inventory`, `reservations`, `loss`, `routing`, `ingest`, `auth`, `notify`. Each module has `router.py`, `service.py` and, where needed, `schemas.py`.

## 2. Implementation Steps

Dates assume work every day, including weekends. Session dates are targets, not commitments; the cut checkpoints in Phase 13 decide what moves to v1.1.

### Implementation Phase 1 (Session 0, 21 October): Docker Compose and repo context

- GOAL-001: `docker compose up` starts `db`, `api` and `web`; the web page shows the API health result, and the API reports PostGIS is reachable.

| Task | Description | Completed | Date |
|------|-------------|-----------|------|
| TASK-001 | Create `docker-compose.yml` with three services. `db`: image `postgis/postgis:18-3.6`, volume `pgdata`, healthcheck `pg_isready`, no host port. `api`: build `./api`, port `8000:8000`, `depends_on: db: condition: service_healthy`, env from `.env`, source mounted for reload. `web`: build `./web`, port `5173:5173`, source mounted, `node_modules` in an anonymous volume. | ✅ | 2026-10-21 |
| TASK-002 | Create `.env.example` with `POSTGRES_USER=fiber`, `POSTGRES_PASSWORD=change-me`, `POSTGRES_DB=fiber`, `DATABASE_URL=postgresql+psycopg://fiber:change-me@db:5432/fiber`, `APP_ENV=development`, `SESSION_SECRET=change-me`, `SMTP_HOST=`, `SMTP_PORT=587`, `SMTP_USER=`, `SMTP_PASSWORD=`, `SMTP_FROM=`. Copy it to `.env` locally. | ✅ | 2026-10-21 |
| TASK-003 | Create `.gitignore` covering `.env`, `node_modules/`, `__pycache__/`, `.venv/`, `dist/`, `*:Zone.Identifier`, `test-results/`, `playwright-report/`, and `certs/*.crt` (keep `certs/README.md`). | ✅ | 2026-10-21 |
| TASK-004 | Create `api/pyproject.toml` with the Python pins from `docs/architecture.md`, and `api/Dockerfile` from `python:3.14.8-slim` running `uvicorn app.main:app --host 0.0.0.0 --port 8000 --reload`. | ✅ | 2026-10-21 |
| TASK-005 | Create `api/app/main.py` with `GET /api/health` returning `{"status": "ok", "postgis": "<version>"}` from `SELECT postgis_version()`, and `api/app/db.py` holding the SQLAlchemy engine and a `get_db` dependency. | ✅ | 2026-10-21 |
| TASK-006 | Scaffold `web/` with Vite (React + TypeScript template) and the npm pins from `docs/architecture.md`, TypeScript `6.0.3`. Add Tailwind CSS 4 and initialise shadcn/ui. `web/Dockerfile` from `node:24.22.1-slim`. In `web/vite.config.ts`, proxy `/api` to `http://api:8000`. `web/src/App.tsx` fetches `/api/health` and prints the result. | ✅ | 2026-10-21 |
| TASK-007 | Add the "Rules for CLAUDE.md" from `docs/fiber-dashboard-workflow.md` to `CLAUDE.md`, plus the commands: `docker compose up`, `docker compose exec api pytest`, `docker compose exec api alembic upgrade head`, `npm run gen:api` (in `web/`). | ✅ | 2026-10-21 |
| TASK-008 | After the first pull, replace the `db` image tag with its digest (`postgis/postgis:18-3.6@sha256:...`) and record the PostGIS patch version from `SELECT postgis_full_version()` in `docs/architecture.md`. | ✅ | 2026-10-21 |
| TASK-009 | First commit on branch `main` (rename from `master`). | ✅ | 2026-10-21 |
| TASK-065 | Corporate certificate support (DEP-009). Both Dockerfiles accept an optional CA certificate file `certs/corporate-ca.crt`. The `certs/` folder is git-ignored except a README. If the file is present, add it to the image's trust store and point `PIP_CERT`, `REQUESTS_CA_BUNDLE` and `NODE_EXTRA_CA_CERTS` at it. If it is absent, the build works unchanged. | ✅ | 2026-10-21 |
| TASK-066 | Transfer check. Create the zip with `git archive --format=zip -o fiber.zip HEAD`, email it to the work laptop, unzip, copy `.env.example` to `.env`, run `docker compose up --build`, and confirm the completion criteria below there. | | |

Completion: `docker compose up` shows all three services healthy; `curl localhost:8000/api/health` returns status `ok` with a PostGIS version; `http://localhost:5173` shows the same result. The same criteria pass on the work laptop after the email transfer (TASK-066).

### Implementation Phase 2 (Session 1, 22 October): Schema, Alembic and seed

- GOAL-002: All MVP tables exist through Alembic migrations, the append-only and hold rules are enforced in the database, and the mock data is loaded.

| Task | Description | Completed | Date |
|------|-------------|-----------|------|
| TASK-010 | Initialise Alembic in `api/alembic/` using `DATABASE_URL`. First migration enables extensions `postgis` and `pg_trgm`. | ✅ | 2026-10-21 |
| TASK-011 | Inventory tables: `sites` (id, name unique, kind: site/building/equipment/data_center/toc, geom Point 4326 nullable), `spans` (id, site_a_id, site_b_id, route_type: Bespoke/Trunk/Metro, region: North/Central/South/East Coast, distance_km nullable), unique index on `(LEAST(site_a_id, site_b_id), GREATEST(site_a_id, site_b_id))`, `segments` (id, site_a_id, site_b_id, geom LineString nullable), `segment_spans` (segment_id, span_id, position), `ports` (id, port_id text unique, site_id), `cores` (id, span_id, number, port_a_id, port_b_id, circuit_id nullable, in_use bool from Excel). | ✅ | 2026-10-21 |
| TASK-012 | Planning tables: `users` (id, username unique, display_name, role: planner/admin, password_hash nullable, must_change_password, active), `customers` (id, name, created_by), `reservations` (id, customer_id, planner_id, planned_date, created_at, is_new_customer, imported bool), `reservation_cores` (reservation_id, core_id), `reservation_events` (id, reservation_id, type, user_id, reason nullable, created_at), `core_holds` (core_id primary key, reservation_id). Event types: requested, approved, rejected, withdrawn, kept, release_requested, released, release_declined, corrected. | ✅ | 2026-10-21 |
| TASK-013 | History and operations tables: `measurements` (id, span_id, loss_db, tested_on, upload_id, created_at), `data_edits` (id, entity, entity_id, field, old_value, new_value, reason, user_id, created_at), `uploads` (id, user_id, filename, kind: excel/kmz, status: staged/confirmed/discarded, summary jsonb, created_at, confirmed_at), `upload_rows` (upload_id, group: new/changed/conflict/missing/rejected, entity, payload jsonb, warnings jsonb), `job_runs` (job_name, run_date, primary key on both). | ✅ | 2026-10-21 |
| TASK-014 | Trigger function `forbid_change()` raising an exception on UPDATE or DELETE, attached to `reservation_events`, `measurements` and `data_edits` (PAT-001). | ✅ | 2026-10-21 |
| TASK-015 | View `core_status_v` (core_id, status) with priority: latest `data_edits` core status Faulty, else `in_use` → In use, else approved hold → Reserved, else pending hold → Requested, else Available. | ✅ | 2026-10-21 |
| TASK-016 | Script `api/app/seed.py` loading the mock Excel and creating one planner (`planner1`) and one admin (`admin1`) for the dev header. Run with `docker compose exec api python -m app.seed`. | | |

Completion: `alembic upgrade head` succeeds on an empty database; `alembic downgrade base` then `upgrade head` succeeds; an UPDATE on `reservation_events` fails; a second insert into `core_holds` for the same core fails; the seed script loads the mock data without errors. Then run the second grill against the migrations (workflow).

### Implementation Phase 3 (Session 2, 22 October): Search, span and core endpoints, typed client

- GOAL-003: Read endpoints for search, spans and cores return real data; reservation endpoints exist as stubs; the TypeScript client is generated.

| Task | Description | Completed | Date |
|------|-------------|-----------|------|
| TASK-017 | `api/app/auth/deps.py`: `get_current_user` reads header `X-Dev-User: <username>` only when `APP_ENV=development`, returns 401 otherwise; `require_admin` returns 403 for non-admins. | | |
| TASK-018 | `GET /api/search?q=` matching customer name, span site names, circuit ID and core number (ILIKE plus `pg_trgm` similarity), returning typed results with span ID. | | |
| TASK-019 | `GET /api/spans?region=&route_type=&q=` returning span ID, site A and B names, route type, region, distance, free core count and status mix (count per status). `GET /api/spans/{id}` returning the span plus every core with status, customer, circuit ID, planned date and ports at both ends. | | |
| TASK-020 | `GET /api/customers?q=` and stub `POST /api/customers` returning similar names. Stub `POST /api/reservations` (body: customer_id, planned_date, cores per span) returning a fake request ID. | | |
| TASK-021 | In `web/`, script `gen:api` = `openapi-typescript http://localhost:8000/openapi.json -o src/api/schema.d.ts`, and `web/src/api/client.ts` as a typed fetch wrapper that sends `X-Dev-User` in development. | | |

Completion: pytest covers search by each of the four keys and the span detail shape; `npm run gen:api` produces `schema.d.ts` with no type errors in `npm run build`.

### Implementation Phase 4 (Session 3, 23 October): Span list, port grid, Reserve side panel (UI session)

- GOAL-004: A planner finds a span, sees its port grid, selects available cores and submits a request through the side panel (against the stub).

| Task | Description | Completed | Date |
|------|-------------|-----------|------|
| TASK-022 | App shell in `web/src/`: header with global search, bell count placeholder, light and dark theme toggle (system default), planner and admin navigation. Colour tokens checked for 4.5:1 contrast in both themes. | | |
| TASK-023 | Span list with region and route type filters, labelled by site A and site B, showing free cores and status mix. | | |
| TASK-024 | Port grid component: one cell per core with a pattern or symbol per status (outlined Available, hatched Reserved, crossed Faulty, distinct marks for Requested and In use), text label on hover and focus, arrow-key navigation, Space or Enter to select. Only Available cells are selectable. | | |
| TASK-025 | Core table under the grid: customer, circuit ID, planned date, ports at both ends. | | |
| TASK-026 | Reserve side panel: customer picker with similar-name warning on new names, planned date (`<input type="date">`), counter of cores chosen against cores needed, submit to `POST /api/reservations`, focus trapped while open, Escape closes. | | |
| TASK-027 | Run workflow Step 7 on the port grid: the 30-minute Impeccable trial, `/impeccable audit`, and the Playwright check in `web/e2e/port-grid.spec.ts`. | | |

Completion: Playwright passes for keyboard selection, non-colour status marks and contrast in both themes; the panel submits a request to the stub.

### Implementation Phase 5 (Session 4, 24 October): Approval flow, Needs review, bell count

- GOAL-005: The full reservation lifecycle works on real data, and the first request submitted wins.

| Task | Description | Completed | Date |
|------|-------------|-----------|------|
| TASK-028 | `POST /api/reservations` (real): in one transaction insert the reservation, its cores, a `requested` event and one `core_holds` row per core. On primary-key conflict, roll back and return 409 with the taken core IDs. A route request covers all its spans in one reservation. | | |
| TASK-029 | `POST /api/customers` (real): on a new name, return names with `pg_trgm` similarity ≥ 0.4; the client must resend with `confirm_new=true`; set `is_new_customer` on the reservation. | | |
| TASK-030 | Admin actions: `POST /api/reservations/{id}/approve`, `/reject` (reason required, deletes holds), `/release` (deletes holds), `/decline-release` (reason required), `/correct` (reason required, new event replaces what is shown). An admin may approve their own request only when they are the only active admin. | | |
| TASK-031 | Planner actions: `POST /api/reservations/{id}/withdraw` (own pending only, deletes holds), `/keep` (restarts the stale clock), `/request-release`. | | |
| TASK-032 | `GET /api/reservations?mine=true&status=pending|rejected|approved` for the planner list; `GET /api/approvals` for admins, oldest first with age; `GET /api/needs-review` (stale, release requested, conflict, faulty held core); `GET /api/bell` returning counts. | | |
| TASK-033 | UI: My reservations list with Pending and Rejected filters and visible rejection reasons; admin Approvals list; Needs review list; bell count in the header. | | |

Completion: pytest TEST-001 to TEST-006 pass.

### Implementation Phase 6 (Session 5, 25 October): Minimal login

- GOAL-006: Local sign-in replaces the dev header, and roles are enforced on every endpoint.

| Task | Description | Completed | Date |
|------|-------------|-----------|------|
| TASK-034 | Migration adds `sessions` (id = SHA-256 of token, user_id, created_at, expires_at). `POST /api/auth/login` checks the Argon2 hash and `active`, sets an httpOnly cookie; `POST /api/auth/logout`; `POST /api/auth/change-password`. `get_current_user` reads the cookie; the dev header stays available only when `APP_ENV=development`. | | |
| TASK-035 | When `must_change_password` is true, every endpoint except change-password and logout returns 403 with code `password_change_required`. | | |
| TASK-036 | Admin user management: `POST /api/admin/users` (temporary password, `must_change_password=true`), `/reset-password`, `/deactivate`. No delete endpoint. Deactivation also deletes the user's sessions. | | |
| TASK-037 | UI: login page, forced password change page, admin Users page. | | |

Completion: TEST-007 passes; `APP_ENV=production` rejects `X-Dev-User`.

### Implementation Phase 7 (Session 6, 26 October): Link loss (UI session)

- GOAL-007: Planners see calculated and measured loss per span with warning levels that do not rely on colour.

| Task | Description | Completed | Date |
|------|-------------|-----------|------|
| TASK-038 | `api/app/loss/service.py`: `calculated_loss_db(distance_km)` returns `distance_km * 0.3`, or `None` when distance is missing; `deviation_pct(measured, calculated)`; `warning_level(deviation_pct)` returning green, amber, red or off_scale, with values below calculated counted as green. | | |
| TASK-039 | `GET /api/loss/spans` (calculated, latest measured, difference in dB and percent, level, last test date, measured or calculated-only); `GET /api/loss/coverage` (spans with at least one measurement out of all spans); segment summary with x of y spans measured. | | |
| TASK-040 | UI: the visual form is open. Candidate forms are a Recharts chart, and/or a box of any size holding a scrollable list of spans sorted with the highest warning level first, each showing its deviation percentage. These are options, not limits. Whatever form is chosen: each level has a text label and shape; spans with no distance show "No distance", never 0 dB; coverage figure shown. Run Step 7 checks. | | |

Completion: TEST-008 passes; the loss view passes contrast and non-colour checks in both themes.

### Implementation Phase 8 (Session 7, 27 October): Admin upload

- GOAL-008: An admin uploads Excel and KMZ files, reviews a grouped preview and confirms, and the database updates without duplicates or touching reservations.

| Task | Description | Completed | Date |
|------|-------------|-----------|------|
| TASK-041 | `api/app/ingest/columns.py`: map of Excel column headers to fields, built from the mock Excel headers. `api/app/ingest/excel.py` parses with pandas and openpyxl, cleans values, and returns valid rows and rejected rows with reasons. | | |
| TASK-042 | `api/app/ingest/kmz.py`: open the KMZ with `zipfile`, parse `doc.kml` with `xml.etree.ElementTree`, read each Placemark name as `<site A> - <site B>` and its LineString coordinates. A name that matches no segment or more than one goes to Rejected. | | |
| TASK-043 | `POST /api/admin/uploads` stages rows in `upload_rows` grouped as New, Changed, Conflicts, Not in this file, Rejected. Warnings: duplicate Port ID, a cable that looks listed twice, chained segments with more than one path, reservations missing a customer or date, rows conflicting with a Requested or Reserved core. Fields with a `data_edits` row are Conflicts that keep the dashboard value by default. | | |
| TASK-044 | `GET /api/admin/uploads/{id}` returns the preview. `POST /api/admin/uploads/{id}/confirm` (body: Excel-wins field list, duplicate decisions) applies everything in one transaction: upserts by natural keys, appends measurements, imports reservations as approved only on the first upload, never touches existing reservations, and writes the upload summary. | | |
| TASK-045 | UI: admin upload page with Upload, Preview and Confirm steps; each group expandable with its warnings; ticks for Excel values on conflicts. | | |

Completion: TEST-009 and TEST-010 pass.

### Implementation Phase 9 (Session 8, 28 October): Admin editing

- GOAL-009: Admins correct core status, then span and site details, each with a reason kept in history.

| Task | Description | Completed | Date |
|------|-------------|-----------|------|
| TASK-046 | `POST /api/admin/cores/{id}/status` with `{status: Faulty|Available, reason}` writing a `data_edits` row. A Faulty core with a hold appears in Needs review through the derived query. | | |
| TASK-047 | `POST /api/admin/spans/{id}` (distance, route type, region, site A, site B) and `POST /api/admin/sites/{id}` (name, coordinates), each field change written to `data_edits` with the reason. Third cut: this task moves to v1.1 if Phase 13's checkpoint says so. | | |
| TASK-048 | UI: edit forms in the admin area, reason required, history list per item. | | |

Completion: TEST-011 passes.

### Implementation Phase 10 (Session 9, 28 October): Routing

- GOAL-010: Planners pick two segment end sites and see up to 3 route options.

| Task | Description | Completed | Date |
|------|-------------|-----------|------|
| TASK-049 | `api/app/routing/graph.py`: build a NetworkX `Graph` with sites as nodes and segments as edges (weight = segment km, the sum of its spans). Build at startup and after each confirmed upload or span edit. | | |
| TASK-050 | `GET /api/routes/endpoints` lists segment end sites. `GET /api/routes?from=&to=&cores_needed=` takes the first 3 paths from `shortest_simple_paths`; each option returns segments (with ordered spans, km and free cores), total km, estimated dB (null when any span has no distance), fewest free cores, measured segments out of total, and an insufficient-cores flag. Invalid input returns 422 with a field name. | | |
| TASK-051 | UI: From and To pickers, option list with expandable segments, inline field errors, and Reserve cores from an option opening the side panel with that route's spans. | | |

Completion: TEST-012 passes.

### Implementation Phase 11 (Session 10, 29 October): Map, time-boxed to one day

- GOAL-011: The MapLibre map shows segment routes and site markers from self-hosted assets, or the SVG fallback ships.

| Task | Description | Completed | Date |
|------|-------------|-----------|------|
| TASK-052 | Produce the PMTiles extract for the region bounding box (Southeast Asia, with about 90% of use in Malaysia), capped at zoom 14, plus glyphs and sprites, into `web/public/map/`. Light and dark styles taken from the UI colour tokens. | | |
| TASK-053 | `GET /api/map/segments` and `GET /api/map/sites` returning GeoJSON. Sites without coordinates take the end point of a touching KMZ route; sites with neither are listed but not drawn. | | |
| TASK-054 | Map view with MapLibre: segment lines, data center and TOC markers with distinct shapes, click a segment to list its spans. | | |
| TASK-055 | Fallback, second cut: if TASK-052 to TASK-054 are not working by the end of 29 October, port the SVG map from the v6 mock instead. | | |

Completion: the map loads with no request leaving the network (checked in Playwright with external requests blocked), or the SVG fallback is in place.

### Implementation Phase 12 (Session 11, 30 October): Email and scheduler (first cut)

- GOAL-012: The daily digest and new-request emails send once per day through the SMTP relay, or the phase moves to v1.1.

| Task | Description | Completed | Date |
|------|-------------|-----------|------|
| TASK-056 | `api/app/notify/email.py` using stdlib `smtplib` and `email.message`; does nothing when `SMTP_HOST` is empty. | | |
| TASK-057 | APScheduler job in `api/app/notify/jobs.py`, daily: take PostgreSQL advisory lock, insert into `job_runs` for today (skip on conflict), send each active planner their stale list; stale items of deactivated planners go to all active admins. | | |
| TASK-058 | On each new request, email all active admins (same no-op rule). | | |

Completion: TEST-013 passes. SMTP access is not available yet, so this phase is expected to move to v1.1; the in-app Needs review and bell count already cover the requirement.

### Implementation Phase 13 (30 to 31 October): Cut checkpoints, real data and release

- GOAL-013: The MVP runs on the company server with real exported data, with any cuts made in order.

| Task | Description | Completed | Date |
|------|-------------|-----------|------|
| TASK-059 | Checkpoint, end of 27 October: if Phase 8 is not complete, cut Phase 12 (first cut). | | |
| TASK-060 | Checkpoint, end of 29 October: if the map is not working, ship TASK-055 (second cut). | | |
| TASK-061 | Checkpoint, end of 29 October: if Phases 9 to 10 are not complete, cut TASK-047 (third cut). Core status editing stays. | | |
| TASK-062 | Upload a real Excel export and real KMZ files; fix validation and mapping issues found. This is the gate to ship. | | |
| TASK-063 | Production Compose override `docker-compose.prod.yml`: `APP_ENV=production`, `web` serves the static build, no source mounts, no `--reload`; per CON-007, machine differences stay in `.env`. Deploy to the server confirmed with IT. | | |
| TASK-064 | Manual check in light and dark themes; timed reservation test with 3 planners (target 2 minutes or less). | | |

Completion: real data uploaded without blocking errors; the success criteria in PRD section 1 can be measured.

## 3. Alternatives

- **ALT-001**: Store core status as a column updated by each action. Rejected: it can drift from the event log; the view `core_status_v` derives it instead (PAT-003).
- **ALT-002**: Check core availability in application code before inserting a request. Rejected: two simultaneous requests can both pass; the `core_holds` primary key settles it in the database (PAT-002).
- **ALT-003**: JWT access tokens stored in the browser. Rejected: same-origin SPA, so an httpOnly session cookie is simpler and avoids token storage in JavaScript.
- **ALT-004**: A separate worker container for the daily job. Rejected for the MVP: APScheduler in the API container with an advisory lock and `job_runs` is enough for one job.
- **ALT-005**: A tile server for the basemap. Rejected: PMTiles is read with HTTP range requests from static files.
- **ALT-006**: TypeScript 7.x. Rejected by decision: new native-port major with unproven tooling support.

## 4. Dependencies

- **DEP-001**: Docker Engine 29.8.2 and Docker Compose v5.6.0 in this WSL environment (verified 21 October 2026).
- **DEP-002**: Versions pinned in `docs/architecture.md`, section 4.
- **DEP-003**: The mock Excel and mock KMZ files, needed by TASK-016 and TASK-041. To be provided on 22 October 2026.
- **DEP-004**: The v6 mock, needed by TASK-027 and TASK-055. To be provided on 22 October 2026.
- **DEP-005**: A real Excel export and real KMZ files, needed by TASK-062.
- **DEP-006**: An OpenStreetMap PMTiles source and the region bounding box, needed by TASK-052. The region is Southeast Asia, with about 90% of use in Malaysia.
- **DEP-007**: SMTP relay access and a registered sender address, needed by Phase 12. Expected later.
- **DEP-008**: The production server and its access, confirmed with IT, needed by TASK-063.
- **DEP-009**: Either an IT fix for the PyPI certificate error in the work laptop's WSL (likely corporate TLS inspection), or the corporate CA certificate file for TASK-065.
- **DEP-010**: Docker Engine with the Compose plugin installed on the empty dev server VM (likely an IT ticket), and the VM's CPU architecture (expected x86-64; images must match it).

## 5. Files

- **FILE-001**: `docker-compose.yml`, `docker-compose.prod.yml`, `.env.example`, `.gitignore`: stack definition and configuration.
- **FILE-002**: `CLAUDE.md`: project rules, commands and delegation rule.
- **FILE-003**: `api/pyproject.toml`, `api/Dockerfile`: backend build.
- **FILE-004**: `api/app/main.py`, `api/app/db.py`: app entry point and database session.
- **FILE-005**: `api/alembic/` and `api/alembic/versions/`: migrations.
- **FILE-006**: `api/app/{inventory,reservations,loss,routing,ingest,auth,notify}/`: backend modules (PAT-004).
- **FILE-007**: `api/app/seed.py`: mock data loader.
- **FILE-008**: `api/tests/`: pytest suite against a real PostGIS container.
- **FILE-009**: `web/package.json`, `web/Dockerfile`, `web/vite.config.ts`: frontend build.
- **FILE-010**: `web/src/api/schema.d.ts` (generated), `web/src/api/client.ts`: typed API client.
- **FILE-011**: `web/src/`: React screens and components.
- **FILE-012**: `web/public/map/`: PMTiles, glyphs, sprites and styles.
- **FILE-013**: `web/e2e/`: Playwright tests.

## 6. Testing

All backend tests run with `docker compose exec api pytest` against the PostGIS container, each test in a rolled-back transaction.

- **TEST-001**: Two concurrent `POST /api/reservations` for the same core: exactly one succeeds, the other returns 409 listing the taken core.
- **TEST-002**: Request, then approve: cores show Reserved. Request, then reject without a reason: 422. Reject with a reason: cores Available, reason visible to the planner.
- **TEST-003**: Withdraw own pending request frees cores at once; withdrawing another planner's request returns 403.
- **TEST-004**: Request release, decline without reason (422), decline with reason, request again, release: cores Available, full event history kept.
- **TEST-005**: A reservation approved more than 3 months ago appears in Needs review; after keep it does not; an imported undated reservation counts from its import date.
- **TEST-006**: Admin self-approval is refused while another active admin exists and allowed when the admin is the only one. Correction requires a reason and leaves the original event in history.
- **TEST-007**: Login with a wrong password fails; a deactivated user cannot log in; a new user is forced to change their password; a planner gets 403 on every `/api/admin/` endpoint.
- **TEST-008**: Loss bands: deviation below calculated is green; boundary values at 3%, 7% and 10%; above 10% is off_scale; missing distance gives no calculated loss.
- **TEST-009**: Upload validation: rejected rows with reasons, duplicate Port ID warning, duplicate cable warning, ambiguous segment chain flagged, nothing saved before confirm.
- **TEST-010**: Re-upload: no duplicates, missing rows untouched, protected fields kept unless ticked, measurements appended, reservations never changed, a row marking a held core Faulty sends the reservation to Needs review.
- **TEST-011**: Core status edit without a reason returns 422; with a reason writes `data_edits`; a distance edit changes calculated loss.
- **TEST-012**: Routing on a small fixture graph returns at most 3 options in km order, the correct fewest free cores, null estimated dB when a span has no distance, and the insufficient flag.
- **TEST-013**: The daily job run twice on the same day sends once.
- **TEST-014**: Playwright: port grid keyboard operation, non-colour status marks, 4.5:1 contrast in light and dark themes.

## 7. Risks & Assumptions

- **RISK-001**: Thirteen phases in 11 days for one person. Mitigation: the checkpoints in Phase 13 (TASK-059 to TASK-061).
- **RISK-002**: Real Excel headers differ from the mock. Mitigation: all header mapping lives in `api/app/ingest/columns.py`; TASK-062 runs on real data before release.
- **RISK-003**: First use of PostGIS, MapLibre and PMTiles. Mitigation: one-day time box and the SVG fallback (TASK-055); the workflow's Step 3 spike tests this before the build.
- **RISK-004**: Loss band boundaries are not stated as inclusive or exclusive in the PRD. TEST-008 fixes whichever rule is agreed. Until decided, a value exactly on 3%, 7% or 10% belongs to the lower level.
- **RISK-006**: A Southeast Asia extract capped at zoom 14 may be too large to ship easily between machines. Map tiles cannot travel by email (CON-008), so the PMTiles extract must be downloaded or built on each target machine, which may need its own IT ticket for the download source. Option to decide in the workflow's Step 3 spike: Malaysia at zoom 14 plus the rest of Southeast Asia at a lower zoom.
- **RISK-007**: Outlook may block or strip zip attachments, or attachments above a size limit. Fallback to agree with IT: a shared drive or an internal Git host.
- **ASSUMPTION-001**: The span key is the unordered site pair; Excel may list a span as A to B or B to A.
- **ASSUMPTION-002**: Phase 12 moves to v1.1 because SMTP access comes later.
- **ASSUMPTION-003**: Planned workflow Steps 3 (spike) and 4 (tickets) run before Phase 1 starts, unless skipped by decision.
- **ASSUMPTION-004**: Work continues on weekends (24, 25 and 31 October are weekend days). Confirmed by the owner on 21 October 2026.

## 8. Related Specifications / Further Reading

- `docs/PRD.md`: requirements
- `docs/architecture.md`: architecture and pinned versions
- `docs/fiber-dashboard-workflow.md`: build workflow and session order
- `CLAUDE.md`: project rules and delegation
