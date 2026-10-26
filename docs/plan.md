---
goal: Fiber Dashboard MVP, built in sessions 0 to 12 and following the PRD cut order
version: 1.0
date_created: 2026-10-21
last_updated: 2026-10-26
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
- **REQ-002**: Planners request cores for a customer (required, in the app and in the Excel) with a planned date. A request holds its cores as Requested, approval reserves them, and rejection or withdrawal frees them. The first request submitted wins (PRD story 2).
- **REQ-003**: A reservation is stale 3 months after approval or its latest keep. Stale reservations, release requests, upload conflicts and faulty held cores appear in the Action needed list (tagged Stale), shown as the Action needed count badge on My reservations and the amber waiting count on the Approvals tab (PRD story 3).
- **REQ-004**: Per span, show calculated loss (distance × 0.3 dB/km), the latest measured loss, deviation in percent and a warning level. A span with no distance shows no calculated loss, never 0 dB. Loss shows in the bottom section of the map page: a loss line under the route ribbon (per span, plus route total) and a "Loss" block below the held table for a single span (PRD story 4).
- **REQ-005**: Route planning between any two sites runs over spans and returns up to 3 options, ranked by Optimise for (shortest distance, default, or most free cores; options without enough cores last; a "Best match" tag), with km, estimated dB, fewest free cores and loss confidence (measured spans out of spans on the path) (PRD story 5).
- **REQ-006**: A MapLibre map draws each span as a straight line over the self-hosted basemap (data center square, other site diamond, line weight by route type, free-cores chip). KMZ shapes are not in the MVP; one mock route with a drawn shape (two spans between three sites) proves the shape path. Real KMZ import is Later (PRD story 6).
- **REQ-007**: Local accounts with planner and admin roles, forced password change at first login, deactivation instead of deletion (PRD story 7).
- **REQ-008**: Admins upload Excel in three steps (Upload, Preview, Confirm). The Reservation workbook and the site master workbook are separate uploads, each found by its sheets' headers. Nothing is saved before Confirm. KMZ upload is Later (PRD story 8).
- **REQ-009**: Admins edit core status (Faulty or Available), span details and site details, each with a reason (PRD story 8).
- **REQ-010**: A daily email digest per planner of their stale reservations, and an email to admins on each new request (PRD stories 2 and 3; first cut).
- **REQ-011**: Release is not deletion. A release adds a `released` event and frees only the `core_holds` rows. A release request chooses which cores of a route reservation to free; the rest stays reserved, and releasing all cores ends the reservation. Table `release_cores` records the cores each release event covers (PRD stories 2 and 3).
- **REQ-012**: The sample workbook (`Sample/Sample Excel Structure.xlsx`) imports through layered parsing (in real use the Reservation workbook and the site master workbook are separate files; the sites and DC sheets are found by headers, see REQ-018): every row is kept raw in staging with sheet name and row number and gets a status (Ready, Needs review, Rejected) with a reason. Reservation, Site Location (sites sheet) and DC List (DC sheet) are imported; Monitoring is not (v1.1 or later). Port Info, Contractor and Remark are stored raw. Rules per column are in PRD section 4, "Sample Excel workbook" (PRD story 8).
- **REQ-013**: A standalone `excel_check` command reports bad coordinates, unknown sites, malformed or unpairable port ranges, blank requestors, unknown region spellings and duplicate site names. The upload preview reuses the same check functions.
- **REQ-014**: Surveyed capacity. A span shows one core cell per surveyed core (`spans.survey_cores`), numbered 1 to the count; cable size (`spans.cable_size`, default 144) is info only; a line shows "N cores not surveyed"; a span with no count cannot be booked until an admin enters one with a reason (PRD story 1).
- **REQ-015**: Count-only reservations. An Excel row with a core count and no Core assignment imports as Ready with `unassigned_cores = N`. Free to reserve = Available cells minus remaining unassigned cores of active reservations on the span; booking more returns 409. An admin `assign` action adds specific cores later (PRD stories 2 and 8).
- **REQ-016**: One main page. The map page is the home and holds the whole span workflow; no left sidebar; the old Spans and Routes pages are merged into it. Top bar: logo mark, tabs Map, My reservations, Approvals (admin only, amber waiting count) and Upload (admin only), global search over customer, circuit, core, span and site, and the account menu with Sign out and, for admins, Users (opens the users screen). The map card sits left with the Find card and the Inspector (tabs Cores live; Site and Services disabled, "Later") on the right, and a full-width section under them follows the selection: "Cores of <span>" with the chosen bar and the "Held on this span" table, or the route ribbon with a loss line and a per-span table. A short "Loss" block follows the held table for a single span. The selection is written to the URL hash (`#span=`, `#route=`). Search and lists reach every span and route if the map or tiles fail (PRD Design decisions).
- **REQ-017**: Route planner and ribbon. From, To, Optimise for (Shortest distance or Most free cores) and Cores needed per span give up to 3 options. A route reservation takes N cores per span, assigned from the first free cores on each span by default. The 2D route ribbon marks the bottleneck, shows a span with too few free cores as "short" and disables Reserve with a sentence naming it. A per-span override is Later.
- **REQ-018**: Site master upload, replace-file model. Its own workbook, separate from the Reservation workbook, with two sheets (LRD sites and DC list), each found by its headers, ignoring case and spacing. The upload goes to staging and is compared with the database per sheet as Added, Changed, Missing from the file (marked inactive, never deleted) and Problem. The admin reviews a preview (counts first, filters) and applies; the applied file is the "current file", and previous uploads are kept for comparison (no undo in the MVP). Whole-file checks block that sheet only (empty, headers missing, duplicate keys, 10% or more fewer rows, with admin override). Sites key on site_name, DCs on "DC Name / Link"; "possible rename" is flagged for the admin. Empty, "TBA", "N/A", "NA", "-" and "TBC" are blank.
- **REQ-019**: A DC row links to its LRD site and does not create a new place. Its own lat/long is used when valid, else the linked site's, labelled "location from site <LRD>"; with neither valid it is Needs review and not drawn. A site with invalid coordinates is Needs review and not drawn, but spans and routing still work for it.
- **SEC-001**: Every write stores the acting `user_id`. Every data edit stores a reason. Nothing is deleted; accounts are deactivated.
- **SEC-002**: Secrets (database password, session secret, SMTP credentials) come from environment variables. `.env` is never committed.
- **SEC-003**: Admin endpoints require the admin role on the server. Hiding them in the UI is not enough.
- **SEC-004**: No request leaves the company network: no external map API, CDN, font host or analytics.
- **SEC-005**: Passwords are hashed with Argon2. Sessions use an httpOnly, SameSite=Lax cookie, Secure outside development.
- **CON-001**: MVP deadline is 31 October 2026, built by one person.
- **CON-002**: Cut order if time runs short: (1) email digest and request emails, (2) the MapLibre basemap (fall back to a plain SVG map of sites and straight span lines, without a basemap), (3) span and site editing. Core status editing always stays.
- **CON-003**: Versions are pinned as listed in `docs/architecture.md`, section 4. TypeScript stays on 6.x.
- **CON-004**: Desktop only. WCAG 2.1 AA, text contrast at least 4.5:1 and non-text at least 3:1, status and warning levels never shown by colour alone, light theme only (dark is Later), keyboard-operable controls and panels.
- **CON-005**: Two sites have at most one span. Uploads match spans by the site pair in either order, segments by their two end sites, and ports by Port ID. Several segments may share the same two end sites (RISK-008).
- **CON-006**: For real KMZ import (Later), KMZ route names have the form `<site A name> - <site B name>`. A name may match more than one segment (RISK-008).
- **CON-007**: The code is developed on a personal laptop, then tested on a work laptop, then on a dev server, then deployed to the production server. The same Docker Compose setup must run unchanged on all four. Anything that differs between machines lives only in `.env`.
- **CON-008**: Source code travels by Outlook email, so only source goes by email: one zip made with `git archive --format=zip -o fiber.zip HEAD` (no `node_modules`, no `.env`, no images, no map tiles). Images are built on each machine from Docker Hub, npm and PyPI, the only approved download sources. Any other source needs an IT ticket.
- **CON-009**: Dependency installs must be reproducible on every machine. Commit `web/package-lock.json`, and an exact Python lock file `api/requirements.lock` generated with `pip freeze` inside the api container. The api Dockerfile installs from the lock file.
- **CON-010**: All date logic (the 3-month stale rule, the daily digest's "today") and date display use Asia/Kuala_Lumpur. Timestamps are stored in UTC (`timestamptz`).
- **CON-011**: Regions are North, Central, South and East Coast. New values come by migration when real data shows them; a region spelling variant is mapped, and an unknown region is a Needs review row in the upload report. Site names are unique across all regions, and many sites can share a region.
- **CON-012**: Real data files (real Excel exports, KMZ files, customer names) must not be committed. Whether the sample in `Sample/` is committed or ignored is the owner's call; `.gitignore` is not changed by this plan.
- **CON-013**: "Nodes" is only an Excel column name in the parser. No table, column, class or doc uses it as a domain term; a Nodes value is a site pair that becomes a span.
- **CON-014**: Minimum width 1200px; check 1280, 1440 and 1920. No mobile or tablet layouts.
- **CON-015**: Style tokens from the v4 mock: fonts Geist and Geist Mono (circuit IDs only), self-hosted (SEC-004); ground #f2f4f7; white cards, 1px border #e2e5ea, radius 8px, no shadows, 16px gutters, 20px padding; type scale 32/40/16/12px; tabular numerals; semantic colour only (blue #1d5fbf, green #1a7f4b, amber #b45309 on #fff7ed, red #b42318 on #fef3f2, slate, dark ink); status is symbol, pattern and word, never colour alone; text at least 11px.
- **GUD-001**: Stub first, then real. Each endpoint exists first as a stub returning mock data, the TypeScript client is generated from FastAPI's OpenAPI spec, and the stub is replaced by real logic later.
- **GUD-002**: Delegate per `CLAUDE.md`: Haiku for mechanical work, Sonnet for code and doc edits needing judgment, main chat for decisions and reviewing diffs.
- **GUD-003**: One phase per session. A phase is done only when its completion criteria pass and the diff has been reviewed (workflow Step 8).
- **PAT-001**: Append-only history. Tables `reservation_events`, `measurements` and `data_edits` reject UPDATE and DELETE with a database trigger. Migration 0002 (TASK-067) adds the same trigger to `reservations` and `reservation_cores`. `unassigned_cores` is set at insert; the remaining count is derived from 'assigned' events.
- **PAT-002**: Database constraints over application checks. "First request wins" is the primary key on `core_holds.core_id`.
- **PAT-003**: Derived state over stored flags. Core status, stale reservations, the Action needed list and the bell count are computed by queries at read time.
- **GUD-004**: UI and design work goes to Opus 5.5 or Fable subagents, per `CLAUDE.md`. Rejected designs: the Impeccable theme (navy and teal), decorative tube ring icons, a span list in the left navigation.
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
| TASK-016 | Script `api/app/seed.py` loading the sample workbook format (sheets Reservation, Site Location and DC List; Monitoring is skipped) through the same parser as the upload (TASK-041), not a separate loader, and creating one planner (`planner1`) and one admin (`admin1`) for the dev header. Run with `docker compose exec api python -m app.seed`. Needs migration 0003 (TASK-068) and the sheet parsers of TASK-041 first. | | |
| TASK-067 | Migration 0002: correction fields on reservation_events, append-only triggers on reservations and reservation_cores, release_cores table, measurement test_method and field_team, segment end-site index no longer unique | ✅ | 2026-10-22 |
| TASK-068 | Migration 0003 for the sample workbook. `sites`: `details` jsonb, kind already allows 'data_center', `lrd_site_id` (nullable link to the LRD site a DC connects through). `spans`: `survey_cores` int nullable. `reservations`: `group_label`, `additional` bool, `cv_ready_date`, `contractor`, `remark`, `port_info_raw`, `monitoring_code`, `fiber_monitored` (Y, N or WIP), all nullable and all set at INSERT, so none needs an UPDATE and the `forbid_change` trigger on `reservations` is respected. `upload_rows`: `sheet`, `row_number`, `status` (ready/needs_review/rejected), `reason`, `raw` jsonb; group adds 'needs_review'. Indexes: GiST on site location, pg_trgm GIN on site names, btree on `cores.span_id`. Test: upgrade, downgrade and upgrade again; an UPDATE on `reservations` still fails. | | |

Completion: `alembic upgrade head` succeeds on an empty database; `alembic downgrade base` then `upgrade head` succeeds; an UPDATE on `reservation_events` fails; a second insert into `core_holds` for the same core fails; migration 0002 (TASK-067) applies and an UPDATE on `reservations` fails; migration 0003 (TASK-068) applies and an UPDATE on `reservations` still fails; the seed script loads the sample workbook without errors. Then run the second grill against the migrations (workflow).

### Implementation Phase 3 (Session 2, 22 October): Search, span and core endpoints, typed client

- GOAL-003: Read endpoints for search, spans and cores return real data; reservation endpoints exist as stubs; the TypeScript client is generated.

| Task | Description | Completed | Date |
|------|-------------|-----------|------|
| TASK-017 | `api/app/auth/deps.py`: `get_current_user` reads header `X-Dev-User: <username>` only when `APP_ENV=development`, returns 401 otherwise; `require_admin` returns 403 for non-admins. | ✅ | 2026-10-22 |
| TASK-018 | `GET /api/search?q=` matching customer name, span site names, circuit ID and core number (ILIKE plus `pg_trgm` similarity), returning typed results with span ID. | ✅ | 2026-10-22 |
| TASK-019 | `GET /api/spans?region=&route_type=&q=` returning span ID, site A and B names, route type, region, distance, free core count and status mix (count per status). `GET /api/spans/{id}` returning the span plus every core with status, customer, circuit ID, planned date and ports at both ends. | ✅ | 2026-10-22 |
| TASK-020 | `GET /api/customers?q=` and stub `POST /api/customers` returning similar names. Stub `POST /api/reservations` (body: customer_id, planned_date, cores per span) returning a fake request ID. | ✅ | 2026-10-22 |
| TASK-021 | In `web/`, script `gen:api` = `openapi-typescript http://localhost:8000/openapi.json -o src/api/schema.d.ts`, and `web/src/api/client.ts` as a typed fetch wrapper that sends `X-Dev-User` in development. | ✅ | 2026-10-22 |

Completion: pytest covers search by each of the four keys and the span detail shape; `npm run gen:api` produces `schema.d.ts` with no type errors in `npm run build`.

### Implementation Phase 4 (Session 3, 23 October): Span list, port grid, Reserve side panel (UI session)

- GOAL-004: A planner finds a span, sees its port grid, selects available cores and submits a request through the side panel (against the stub).

| Task | Description | Completed | Date |
|------|-------------|-----------|------|
| TASK-022 | App shell in `web/src/`: header with global search, bell count placeholder, light and dark theme toggle (system default), planner and admin navigation. Colour tokens checked for 4.5:1 contrast in both themes. Superseded by TASK-073 (no theme toggle, no sidebar). | ✅ | 2026-10-24 |
| TASK-023 | Span list with region and route type filters, labelled by site A and site B, showing free cores and status mix. | ✅ | 2026-10-24 |
| TASK-024 | Port grid component: one cell per surveyed core (numbered 1 to `survey_cores`), 12 cells per row (one fibre tube per row, so 144 cores is 12 rows), a line "N cores not surveyed" for the rest, and a pattern or symbol per status (outlined Available, hatched Reserved, crossed Faulty, distinct marks for Requested and In use), text label on hover and focus, arrow-key navigation, Space or Enter to select. Only Available cells are selectable. | ✅ | 2026-10-24 |
| TASK-025 | Core table under the grid: customer, circuit ID, planned date, ports at both ends. | ✅ | 2026-10-24 |
| TASK-026 | Reserve side panel: customer picker with similar-name warning on new names, planned date (`<input type="date">`), counter of cores chosen against cores needed, a warning that blocks submission without a customer, submit to `POST /api/reservations`, focus trapped while open, Escape closes. Superseded by the chosen bar in TASK-075. | ✅ | 2026-10-24 |
| TASK-027 | Run workflow Step 7 on the port grid: the 30-minute Impeccable trial using the new mockups (DEP-004) and the PRD acceptance criteria, `/impeccable audit`, and the Playwright check in `web/e2e/port-grid.spec.ts`. | | |

Completion: Playwright passes for keyboard selection, non-colour status marks and contrast; the panel submits a request to the stub. The page structure is reworked into the one-page map layout in Phase 11 (TASK-073 to TASK-079).

### Implementation Phase 5 (Session 4, 24 October): Approval flow, Action needed list, bell count

- GOAL-005: The full reservation lifecycle works on real data, and the first request submitted wins.

| Task | Description | Completed | Date |
|------|-------------|-----------|------|
| TASK-028 | `POST /api/reservations` (real): `customer_id` is required (422 without it). In one transaction insert the reservation, its cores, a `requested` event and one `core_holds` row per core. On primary-key conflict, roll back and return 409 with the taken core IDs. A route request covers all its spans in one reservation. | ✅ | 2026-10-24 |
| TASK-029 | `POST /api/customers` (real): on a new name, return names with `pg_trgm` similarity ≥ 0.4; the client must resend with `confirm_new=true`; set `is_new_customer` on the reservation. | ✅ | 2026-10-24 |
| TASK-030 | Admin actions: `POST /api/reservations/{id}/approve`, `/reject` (reason required, deletes holds), `/release` (body: the cores to free, which must be covered by a release request or chosen by the admin; adds a `released` event and `release_cores` rows, deletes the holds of those cores only; the reservation ends when all its cores are released), `/decline-release` (reason required), `/correct` (reason required; approved reservations only, that is its latest event is approved, kept, release_requested, release_declined or corrected, else 409; changes customer and planned date only, and a request to change cores is refused; saved as a `corrected` event that replaces what is shown, old values stay in history). An admin may approve their own request only when they are the only active admin. | ✅ | 2026-10-24 |
| TASK-031 | Planner actions: `POST /api/reservations/{id}/withdraw` (own pending only, deletes holds), `/keep` (restarts the stale clock), `/request-release` (body: the cores of the reservation to free; the rest stays reserved; recorded in `release_cores`). | ✅ | 2026-10-24 |
| TASK-032 | `GET /api/reservations?mine=true&status=pending|rejected|approved` for the planner list; `GET /api/approvals` for admins, oldest first with age; `GET /api/needs-review` (the Action needed list: stale, release requested, conflict, faulty held core); `GET /api/bell` returning counts. | ✅ | 2026-10-24 |
| TASK-070 | Migration 0004: `spans.cable_size` int not null default 144, `reservations.unassigned_cores` int not null default 0 (set at insert, so the `forbid_change` trigger is respected), `reservations.unassigned_span_id`, event type 'assigned', views `reservation_state_v` and `reservation_unassigned_v`, and a fix to `core_status_v` so cores kept after a partial release stay Reserved. Test: upgrade, downgrade and upgrade again; an UPDATE on `reservations` still fails. | ✅ | 2026-10-24 |
| TASK-071 | Capacity API. Span detail returns one core per surveyed core, `survey_cores`, `cable_size`, `not_surveyed_cores`, `unassigned_reserved` and `free_to_reserve`; a span with null `survey_cores` is flagged not surveyed. Every booking path (`POST /api/reservations`, import) refuses more than free to reserve with 409, and refuses a not surveyed span. | ✅ | 2026-10-24 |
| TASK-072 | `POST /api/reservations/{id}/assign` (admin only; body: cores per span, each Available and not above the remaining unassigned count). In one transaction insert `reservation_cores`, `core_holds` and an 'assigned' event; remaining unassigned is `unassigned_cores` minus the reservation's `reservation_cores` rows. Release of a count-only reservation frees its remaining unassigned count. | ✅ | 2026-10-24 |
| TASK-033 | UI: My reservations list with Pending and Rejected filters and visible rejection reasons; admin Approvals list; Action needed list; bell count in the header. | ✅ | 2026-10-24 |

Completion: pytest TEST-001 to TEST-006 and TEST-018 pass.

### Implementation Phase 6 (Session 5, 25 October): Minimal login

- GOAL-006: Local sign-in replaces the dev header, and roles are enforced on every endpoint.

| Task | Description | Completed | Date |
|------|-------------|-----------|------|
| TASK-034 | Migration adds `sessions` (id = SHA-256 of token, user_id, created_at, expires_at). `POST /api/auth/login` checks the Argon2 hash and `active`, sets an httpOnly cookie; `POST /api/auth/logout`; `POST /api/auth/change-password`. `get_current_user` reads the cookie; the dev header stays available only when `APP_ENV=development`. | ✅ | 2026-10-26 |
| TASK-035 | When `must_change_password` is true, every endpoint except change-password and logout returns 403 with code `password_change_required`. | ✅ | 2026-10-26 |
| TASK-036 | Admin user management: `POST /api/admin/users` (temporary password, `must_change_password=true`), `/reset-password`, `/deactivate`. No delete endpoint. Deactivation also deletes the user's sessions. | ✅ | 2026-10-26 |
| TASK-037 | UI: login page, forced password change page, admin Users page, reached from a "Users" item in the account menu (admin only). | ✅ | 2026-10-26 |
Completion: TEST-007 passes; `APP_ENV=production` rejects `X-Dev-User`.

### Implementation Phase 7 (Session 6, 26 October): Link loss (UI session)

- GOAL-007: Planners see calculated and measured loss per span with warning levels that do not rely on colour.

| Task | Description | Completed | Date |
|------|-------------|-----------|------|
| TASK-038 | `api/app/loss/service.py`: `calculated_loss_db(distance_km)` returns `distance_km * 0.3`, or `None` when distance is missing; `deviation_pct(measured, calculated)`; `warning_level(deviation_pct)` returning green, amber, red or off_scale, with values below calculated counted as green. | ✅ | 2026-10-26 |
| TASK-039 | `GET /api/loss/spans` (calculated, latest measured, difference in dB and percent, level, last test date, test method, field team, measured or calculated-only); `GET /api/loss/coverage` (spans with at least one measurement out of all spans); segment summary with x of y spans measured. | ✅ | 2026-10-26 |
| TASK-040 | UI: the visual form is open. Candidate forms are a Recharts chart, and/or a list of spans sorted with the highest warning level first, each showing its deviation percentage. These are options, not limits. Placement: in the bottom section of the map page, a loss line or column under the route ribbon (per span, plus the route total) and a "Loss" block below the held table for a single span (calculated and measured where available); exact placement is decided in the mock. Whatever form is chosen: every span in the loss list is visible, none hidden or cut off; each level has a text label and shape; spans with no distance show "No distance", never 0 dB; coverage figure shown. Run Step 7 checks. | | |

Completion: TEST-008 passes; the loss view passes contrast and non-colour checks. Loss is shown in the bottom section of the map page, not in an Inspector tab (see TASK-040).

### Implementation Phase 8 (Session 7, 27 October): Admin upload

- GOAL-008: An admin uploads Excel files (the Reservation workbook and the site master workbook, separately), reviews a grouped preview and confirms, and the database updates without duplicates or touching reservations.

| Task | Description | Completed | Date |
|------|-------------|-----------|------|
| TASK-041 | `api/app/ingest/columns.py`: map of Excel column headers to fields, built from the sample workbook headers (Reservation header row 1; the sites sheet and the DC sheet are found by their headers, not their name or header row, see TASK-081). `api/app/ingest/excel.py` parses with pandas and openpyxl in layers: keep every row raw with sheet name and row number, then add parsed fields (forward-fill merged Region and title rows, region spelling map, Nodes split and span match with the "(additional core)" suffix, port range pairing, requestor to customer, details jsonb for Site Location and DC List; Core Secured to `spans.survey_cores`; a blank Core assignment with a count is a Ready count-only reservation with `unassigned_cores = N`, and a blank assignment with a blank count is Needs review). Returns rows with a status (Ready, Needs review, Rejected) and a reason. A parser failure marks the row Needs review and never stops the import. The Monitoring sheet is skipped. Port Info is stored raw (parsing it is a later nice-to-have). | ✅ | 2026-10-26 |
| TASK-069 | Shared checks and the standalone checker. `api/app/ingest/checks.py` holds the check functions: coordinate box (about latitude -11 to 21, longitude 92 to 141), unknown site code, region spelling map, port range pairing, blank requestor, duplicate site names. `api/app/ingest/excel_check.py` is the command `docker compose exec api python -m app.ingest.excel_check <file>`: it reads a workbook, prints a report (bad coordinates, unknown sites, malformed or unpairable port ranges, blank requestors, unknown region spellings, duplicate site names) and writes nothing to the database. The upload preview (TASK-043) calls the same functions: one rule set, two entry points. | | |
| TASK-042 | Later, not MVP (real KMZ import). `api/app/ingest/kmz.py`: open the KMZ with `zipfile`, parse `doc.kml` with `xml.etree.ElementTree`, read each Placemark name as `<site A> - <site B>` and its LineString coordinates. A name that matches no segment or more than one goes to Rejected. | | |
| TASK-043 | `POST /api/admin/uploads` stages every row raw in `upload_rows` (with sheet, row number, status and reason) grouped as New, Changed, Conflicts, Not in this file, Needs review, Rejected, plus a Reservations group listing the reservation rows that will be imported. Staging first checks the reservation import switch (a `data_edits` row with entity 'system', entity_id 0, field 'reservation_import', new_value 'closed'). If it is closed, reservation rows are ignored, left out of the Reservations group and listed as one warning. Warnings: duplicate Port ID, a cable that looks listed twice, chained segments with more than one path, rows conflicting with a Requested or Reserved core. A reservation row without a customer goes to Rejected and is not imported. A count-only reservation row (count, no Core assignment) is Ready, appears in the Reservations group and is imported with `unassigned_cores = N`, but only up to free to reserve on its span (above that it is Needs review). A row with an unknown region, an unknown site code, a malformed or unpairable port range, or coordinates outside the Southeast Asia box goes to Needs review and is not imported until the admin fixes it with a reason or the Excel is cleaned and uploaded again. Row checks call the shared functions in `api/app/ingest/checks.py` (TASK-069). A reservation row without a reserved date still imports, with the import date as the start of its stale clock and a warning. A reservation row whose core is already held is skipped. Fields with a `data_edits` row are Conflicts that keep the dashboard value by default. Site master files (a separate workbook from the Reservation workbook) use the replace-file groups of TASK-082 instead; the upload kind is recognised by the sheets' headers. | ✅ | 2026-10-26 |
| TASK-044 | `GET /api/admin/uploads/{id}` returns the preview. `POST /api/admin/uploads/{id}/confirm` (body: Excel-wins field list, duplicate decisions) applies everything in one transaction: upserts by natural keys, appends measurements, imports reservation rows as approved (skipping rows whose core is already held, and importing none once the switch is closed; the check is repeated at confirm), never touches existing reservations, and writes the upload summary. `POST /api/admin/reservation-import/close` (body: reason, admin only) writes the closing `data_edits` row with the user and reason; it is refused if already closed and there is no reopen. | ✅ | 2026-10-26 |
| TASK-045 | UI: admin upload page with Upload, Preview and Confirm steps; each group expandable with its warnings; ticks for Excel values on conflicts; the Reservations group is shown on its own. A one-time, optional "Close reservation import" button asks for a reason, and once closed it shows as closed with no way back. The site master preview is TASK-083. | ✅ | 2026-10-26 |
| TASK-080 | Migration 0006: `sites.active` bool not null default true; upload kind adds 'site_master'. Test: upgrade, downgrade and upgrade again; an UPDATE on `reservations` still fails. | ✅ | 2026-10-26 |
| TASK-081 | Site master parsers in `api/app/ingest/` for the site master workbook (its own file, not the Reservation workbook): find the sites sheet (site_name + latitude_in_decimal + longitude_in_decimal) and the DC sheet ("DC Name / Link" + LRD) by headers, ignoring case and spacing; if none matches, block that part with a message naming the expected headers. Treat empty, "TBA", "N/A", "NA", "-" and "TBC" as blank. A DC row sets `lrd_site_id` from LRD and does not create a place; its location is its own lat/long if valid, else the linked site's ("location from site <LRD>"), else Needs review and not drawn. A site with invalid coordinates is Needs review and not drawn; spans and routing still work. Per-row checks from TASK-069 apply. | ✅ | 2026-10-26 |
| TASK-082 | Site master diff and apply. Stage rows in `upload_rows` (nothing else written). Per sheet compare with the database: Added, Changed, Missing from the file, Problem. Keys: `site_name` for sites, "DC Name / Link" for DCs. Whole-file checks block that sheet only: empty, headers missing, duplicate keys, 10% or more fewer rows than the database (admin override with a confirmation); a failing DC sheet does not block a good sites sheet. Flag "possible rename" (a DC missing and a new DC with the same LRD and coordinates). Fields with a `data_edits` row show "edited in dashboard, file differs" and keep the dashboard value. Apply in one transaction: insert Added; update Changed with a `data_edits` row per field (reason: the upload); set Missing inactive unless a span or reservation uses the site (then keep active and warn). The latest applied upload is the "current file" (name, date, user, row counts); earlier uploads stay for comparison. | ✅ | 2026-10-26 |
| TASK-083 | UI: site master upload and preview. Summary counts first, filters Added, Changed, Missing and Problem (about 36,000 rows, so paged or virtual list), blocked-sheet messages, override confirmation, "possible rename" decision, Apply, and the current file panel. Previous uploads are listed for comparison; there is no undo or rollback button in the MVP. | ✅ | 2026-10-26 |
Completion: TEST-009, TEST-010 and TEST-019 pass.

### Implementation Phase 9 (Session 8, 28 October): Admin editing

- GOAL-009: Admins correct core status, then span and site details, each with a reason kept in history.

| Task | Description | Completed | Date |
|------|-------------|-----------|------|
| TASK-046 | `POST /api/admin/cores/{id}/status` with `{status: Faulty|Available, reason}` writing a `data_edits` row. A Faulty core with a hold appears in the Action needed list through the derived query. | ✅ | 2026-10-26 |
| TASK-047 | `POST /api/admin/spans/{id}` (distance, route type, region, site A, site B, survey count, cable size) and `POST /api/admin/sites/{id}` (name, coordinates), each field change written to `data_edits` with the reason. Third cut: this task moves to v1.1 if Phase 13's checkpoint says so. | ✅ | 2026-10-26 |
| TASK-048 | UI: edit forms in the admin area, reason required, history list per item. | ✅ | 2026-10-26 |
Completion: TEST-011 passes.

### Implementation Phase 10 (Session 9, 28 October): Routing

- GOAL-010: Planners pick any two sites and see up to 3 route options.

| Task | Description | Completed | Date |
|------|-------------|-----------|------|
| TASK-049 | `api/app/routing/graph.py`: build a NetworkX `Graph` from the Postgres span table, in which each span joins two sites (weight = span km), containing only sites that have spans. Segments are not in the graph. Build at startup and after each confirmed upload or span edit. | ✅ | 2026-10-27 |
| TASK-050 | `GET /api/routes/endpoints` lists all sites. `GET /api/routes?from=&to=&cores_needed=&sort=km|free_cores` takes candidate paths from `shortest_simple_paths` (candidate count set in code), ranks them by km (default, Shortest distance) or by fewest free cores on any span of the path, highest first (Most free cores), puts options with too few free cores last, tags the best fit "Best match" and returns the top 3; each option returns its ordered spans (with km, free cores and segment label), total km, estimated dB (null when any span has no distance), fewest free cores, measured spans out of spans on the path, and an insufficient-cores flag. Invalid input returns 422 with a field name. | ✅ | 2026-10-27 |
| TASK-051 | UI: the "Route A to B" mode of the Find card (TASK-074): From and To pickers listing all sites, Optimise for (Shortest distance or Most free cores), Cores needed per span, the options list showing every option returned (up to 3), none hidden or cut off, expandable options showing spans grouped by segment label, the bottleneck shown, inline field errors, and selecting an option writes `#route=` and shows the ribbon (TASK-076) with Reserve on this route. | | |

Completion: TEST-012 passes.

### Implementation Phase 11 (Session 10, 29 October): Map page, time-boxed to one day for the map itself

- GOAL-011: The map page is the home page and holds the span and route workflow; the MapLibre map draws straight span lines from self-hosted assets, or the SVG fallback ships. Open question: this phase now carries the UI rework (TASK-073 to TASK-079) as well as the map, so it may need to start earlier or be split (RISK-010).

| Task | Description | Completed | Date |
|------|-------------|-----------|------|
| TASK-052 | `scripts/get-tiles.sh` downloads a Malaysia PMTiles extract (bbox 99.5,0.8,119.5,7.5, zoom 0 to 14) from a Protomaps daily build into `web/public/map/malaysia.pmtiles` (git-ignored), using the pinned `protomaps/go-pmtiles:v1.31.2` image. It runs once on each machine with internet, including the dev and prod VMs, so the file never travels by email or git. Southeast Asia beyond Malaysia is a later second file. Glyphs, sprites and the light style from the UI colour tokens go in `web/public/map/`. | ✅ (tiles) | 2026-10-24 |
| TASK-053 | `GET /api/map/spans` and `GET /api/map/sites` returning GeoJSON: each span as a straight line with route type and free cores (for the chip symbol: 10 or more, 1 to 9, 0, not surveyed). By default sites are only those with spans, with kind (data center or other) and the linked LRD site for a DC; the other sites come from an optional clustered layer endpoint. No caching in the MVP; test performance after the MVP and cache only if slow. Sites with invalid coordinates, and DCs with no valid location, are listed but not drawn. | | |
| TASK-054 | Map card with MapLibre: each span drawn as a straight line between its two sites (works with the Excel alone); data center square, other site diamond, line weight by route type (trunk thick, metro thin, bespoke dashed), free-cores chip with symbol. Layers control: Dark fibre enabled; Services and Data centres disabled with a "Later" tag. Click a span to select it. KMZ import is built against the standard KML format with a synthetic test file (real files cannot be shared with the developer); real KMZ import and drawing KMZ shapes are Later (TASK-084 proves the shape path with a mock route). | | |
| TASK-055 | Fallback, second cut: if TASK-052 to TASK-054 are not working by the end of 29 October, build a plain SVG map of sites and straight span lines, without a basemap, instead. | | |
| TASK-073 | App shell rework (UI subagent: Opus 5.5 or Fable). Top bar only, no left sidebar: logo mark ("Fiber / Malaysia network"), tabs Map, My reservations, Approvals (admin only, amber waiting count), Upload (admin only), global search, account menu with Sign out and, for admins, Users (opens the users screen). Remove the theme toggle (light only). Self-hosted Geist and Geist Mono, style tokens from CON-015, minimum width 1200px. | ✅ | 2026-10-26 |
| TASK-074 | Map page layout: map card (about 8 of 12 columns), Find card (toggle "Span or site" and "Route A to B", Region and Route type filters with "n of N spans"), Inspector card with tabs Cores (live), Site and Services (disabled, "Later"), "Collapse map" control, and selection kept in the URL hash (`#span=AABB-BBCC`, `#route=AABB-DDEE`), read on load. Search and lists reach every span and route without the map. | ✅ | 2026-10-26 |
| TASK-075 | Span section "Cores of <span>": cores grid (12 per row, plain-text tube labels), legend with counts, core status filter chips, "N not surveyed" note, chosen bar pinned to the viewport bottom while the grid is in view (chosen-core chips, Clear, Customer, Planned date, Reserve; replaces the Reserve side panel of TASK-026); "Held on this span" table with status chips and counts, expandable grouped rows, count-only rows, ports at both ends from the Excel's paired ports, a "Stale" tag for reservations past the stale rule (REQ-003); core detail with history, Keep and Release. Below the held table, a short "Loss" block (calculated and measured where available; TASK-040). | ✅ | 2026-10-26 |
| TASK-076 | Route ribbon: sites as nodes left to right, spans as links with name, km, free-cores badge and bar; bottleneck marked with a triangle and the word; a span with too few free cores shown red cross-hatched with a cross and "short" and Reserve disabled with a sentence naming it; long routes wrap with a "cont." marker; a hidden text list for screen readers; arrow keys move between spans; per-span table; Reserve on this route takes N cores per span from the first free cores on each span. A loss line under the ribbon shows loss per span plus the route total (TASK-040). | | |
| TASK-077 | Reservation history endpoint: `GET /api/reservations/{id}/history` (and per core) returning the events in order with user, time, reason and the cores each covers, for the core detail in TASK-075. It does not exist yet. | ✅ | 2026-10-26 |
| TASK-078 | My reservations list: chips All, Stale, Planned in 30 days (and Pending, Rejected), age in days, Action needed count badge. Rework of the list from TASK-033. | | |
| TASK-084 | Mock route with a drawn shape. Seed one mock segment of two spans between three sites with a stored LineString (`segments.geom`), served in `GET /api/map/spans`; the map draws the line shape in place of those two straight lines. All other spans stay straight lines. Proves the line-shape path end to end; real KMZ import is Later. | | |
| TASK-079 | Global search in the top bar: one box, "Find a span, site, customer, circuit or core", results grouped by type from `GET /api/search`; choosing a result sets the hash selection. | | |

Completion: the map loads with no request leaving the network (checked in Playwright with external requests blocked), or the SVG fallback is in place; the page works at 1200, 1280, 1440 and 1920px; TEST-020 and TEST-021 pass.

### Implementation Phase 12 (Session 11, 30 October): Email and scheduler (first cut)

- GOAL-012: The daily digest and new-request emails send once per day through the SMTP relay, or the phase moves to v1.1.

| Task | Description | Completed | Date |
|------|-------------|-----------|------|
| TASK-056 | `api/app/notify/email.py` using stdlib `smtplib` and `email.message`; does nothing when `SMTP_HOST` is empty. | | |
| TASK-057 | APScheduler job in `api/app/notify/jobs.py`, daily: take PostgreSQL advisory lock, insert into `job_runs` for today in Asia/Kuala_Lumpur (skip on conflict), send each active planner their stale list; stale items of deactivated planners go to all active admins. | | |
| TASK-058 | On each new request, email all active admins (same no-op rule). | | |

Completion: TEST-013 passes. SMTP access is not available yet, so this phase is expected to move to v1.1; the in-app Action needed list and bell count already cover the requirement.

### Implementation Phase 13 (30 to 31 October): Cut checkpoints, real data and release

- GOAL-013: The MVP runs on the company server with real exported data, with any cuts made in order.

| Task | Description | Completed | Date |
|------|-------------|-----------|------|
| TASK-059 | Checkpoint, end of 27 October: if Phase 8 is not complete, cut Phase 12 (first cut). | | |
| TASK-060 | Checkpoint, end of 29 October: if the map is not working, ship TASK-055 (second cut). | | |
| TASK-061 | Checkpoint, end of 29 October: if Phases 9 to 10 are not complete, cut TASK-047 (third cut). Core status editing stays. | | |
| TASK-062 | Upload real Excel exports (the Reservation workbook and the site master workbook); fix validation and mapping issues found. This is the gate to ship. | | |
| TASK-063 | Production Compose override `docker-compose.prod.yml`: `APP_ENV=production`, `web` serves the static build, no source mounts, no `--reload`; per CON-007, machine differences stay in `.env`. Deploy to the server confirmed with IT. | | |
| TASK-064 | Manual check at 1200, 1280, 1440 and 1920px (light theme); timed reservation test with 3 planners (target 2 minutes or less). | | |

Completion: real data uploaded without blocking errors; the success criteria in PRD section 1 can be measured.

## 3. Alternatives

- **ALT-001**: Store core status as a column updated by each action. Rejected: it can drift from the event log; the view `core_status_v` derives it instead (PAT-003).
- **ALT-002**: Check core availability in application code before inserting a request. Rejected: two simultaneous requests can both pass; the `core_holds` primary key settles it in the database (PAT-002).
- **ALT-003**: JWT access tokens stored in the browser. Rejected: same-origin SPA, so an httpOnly session cookie is simpler and avoids token storage in JavaScript.
- **ALT-004**: A separate worker container for the daily job. Rejected for the MVP: APScheduler in the API container with an advisory lock and `job_runs` is enough for one job.
- **ALT-005**: A tile server for the basemap. Rejected: PMTiles is read with HTTP range requests from static files.
- **ALT-006**: TypeScript 7.x. Rejected by decision: new native-port major with unproven tooling support.
- **ALT-007**: Separate Spans and Routes pages, a left sidebar with a span list, and the Impeccable theme. Rejected by the owner (26 October 2026): one map page holds the workflow.
- **ALT-008**: Site master upload that only adds and updates, leaving missing sites untouched. Rejected for the site master: it uses the replace-file model (Missing is marked inactive). Reservation and span uploads keep "Not in this file".

## 4. Dependencies

- **DEP-001**: Docker Engine 29.8.2 and Docker Compose v5.6.0 in this WSL environment (verified 21 October 2026).
- **DEP-002**: Versions pinned in `docs/architecture.md`, section 4.
- **DEP-003**: The sample Excel workbook, needed by TASK-016, TASK-041 and TASK-069. Received 22 October 2026 at `Sample/Sample Excel Structure.xlsx`. The mock KMZ file is still pending.
- **DEP-004**: Mock dashboard designs made in this project, in `docs/mockups/comparison/`. Decided 26 October 2026: the chosen page is `map/index.html`, the style source is `v4/index.html`, the route ribbon is `route/index.html`. The v6 mock is not built as a design, but the features listed in the PRD (Design decisions) are taken from it. Needed by TASK-027 and TASK-073 to TASK-076. Done.
- **DEP-005**: Real Excel exports (the Reservation workbook and the site master workbook, as separate files), needed by TASK-062. Real KMZ files are Later.
- **DEP-006**: Internet access on each machine that runs `scripts/get-tiles.sh` (Protomaps daily builds, OpenStreetMap data). Decided 24 October 2026: Malaysia only for the MVP, downloaded directly on the dev and prod VMs. Self-hosted, so there is no tile rate limit for 50 planners.
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
- **FILE-007**: `api/app/seed.py`: loads the sample workbook through the ingest parser.
- **FILE-014**: `api/app/ingest/checks.py`, `api/app/ingest/excel_check.py`: shared check functions and the standalone checker.
- **FILE-008**: `api/tests/`: pytest suite against a real PostGIS container.
- **FILE-009**: `web/package.json`, `web/Dockerfile`, `web/vite.config.ts`: frontend build.
- **FILE-010**: `web/src/api/schema.d.ts` (generated), `web/src/api/client.ts`: typed API client.
- **FILE-011**: `web/src/`: React screens and components.
- **FILE-012**: `web/public/map/`: PMTiles, glyphs, sprites and styles.
- **FILE-013**: `web/e2e/`: Playwright tests.
- **FILE-015**: `api/app/ingest/site_master.py`: site master sheet finder, diff and apply (TASK-081, TASK-082).
- **FILE-016**: `docs/mockups/comparison/` (`map/`, `v4/`, `route/`): reference mocks for the UI.

## 6. Testing

All backend tests run with `docker compose exec api pytest` against the PostGIS container, each test in a rolled-back transaction.

- **TEST-001**: Two concurrent `POST /api/reservations` for the same core: exactly one succeeds, the other returns 409 listing the taken core.
- **TEST-002**: Request, then approve: cores show Reserved. Request, then reject without a reason: 422. Reject with a reason: cores Available, reason visible to the planner.
- **TEST-003**: Withdraw own pending request frees cores at once; withdrawing another planner's request returns 403.
- **TEST-004**: Approved two-span route reservation. Request release of one span's cores, decline without reason (422), decline with reason, request again, release: those cores are Available and the other span's cores stay Reserved. The reservation, its cores and the full event history are kept, and `release_cores` lists the cores of each release event. Releasing the remaining cores ends the reservation.
- **TEST-005**: A reservation approved more than 3 months ago appears in the Action needed list; after keep it does not; an imported undated reservation counts from its import date, and its date cannot be corrected.
- **TEST-006**: Admin self-approval is refused while another active admin exists and allowed when the admin is the only one. Correction requires a reason, changes only customer and planned date (a change to cores is refused), is refused with 409 on a pending, rejected, withdrawn or released reservation, and leaves the original values in history.
- **TEST-007**: Login with a wrong password fails; a deactivated user cannot log in; a new user is forced to change their password; a planner gets 403 on every `/api/admin/` endpoint.
- **TEST-008**: Loss bands: deviation below calculated is green; boundary values at 3%, 7% and 10%; above 10% is off_scale; missing distance gives no calculated loss.
- **TEST-009**: Upload validation: rejected rows with reasons, duplicate Port ID warning, duplicate cable warning, ambiguous segment chain flagged, nothing saved before confirm.
- **TEST-010**: Re-upload: no duplicates, missing rows untouched, protected fields kept unless ticked, measurements appended, reservations never changed, a row marking a held core Faulty sends the reservation to the Action needed list.
- **TEST-011**: Core status edit without a reason returns 422; with a reason writes `data_edits`; a distance edit changes calculated loss.
- **TEST-012**: Routing on a small fixture graph (spans joining sites, weighted by km) returns at most 3 options, in km order by default and by most free cores with `sort=free_cores`, options with too few free cores last, a "Best match" tag on the first option that fits, the correct fewest free cores, loss confidence as measured spans out of spans, null estimated dB when a span has no distance, the insufficient flag, and a route that starts or ends at a site inside a segment.
- **TEST-013**: The daily job run twice on the same day sends once.
- **TEST-016**: `excel_check` on a small fixture workbook reports each defect once with sheet and row number: a swapped lat/long and a 0,0 coordinate, an unknown site code, a mismatched port range length and `P23-282`, a blank requestor, an unknown region spelling, and a duplicate site name. A clean fixture reports nothing. The upload preview returns the same findings for the same file, and nothing is written to the database by the command.
- **TEST-017**: Sample workbook parsing: merged Region cells and title rows are filled forward (`group_label`); "Nothern" maps to North; `AABB-BBCC` and `BBCC-AABB` match the same span; "(additional core)" matches the span and sets `additional`; `AABB Tray 1 P1-P2` and `BBCC MOD B P23-24` pair as P1 with P23 and P2 with P24; Aging(days) and Core balance are ignored; Port Info, Contractor and Remark are stored raw; the Monitoring sheet is skipped; the sites sheet and the DC sheet are found by their headers (not by name or header row); extra site columns go in `details`; a DC List row becomes a 'data_center' site linked to its LRD site, with its own coordinates when valid. Core Secured sets `survey_cores`; a row with a count and a blank Core assignment is Ready with `unassigned_cores = N` and no cores; a row with both blank is Needs review. A parser failure on one row marks that row Needs review and the rest import.
- **TEST-018**: Count-only booking. A span with 10 surveyed cores, 3 in use and a count-only reservation of 4: free to reserve is 3; a request for 4 returns 409 for planner and admin, a request for 3 succeeds. A not surveyed span refuses booking until an admin sets a count with a reason, and then more cells appear. `assign` (admin only, planner gets 403) adds specific cores, reduces the remaining unassigned count, rejects more cores than remain, and leaves free to reserve unchanged. Releasing a count-only reservation frees its remaining unassigned count.
- **TEST-014**: Playwright: port grid keyboard operation, non-colour status marks, 4.5:1 contrast (light theme).
- **TEST-015**: Reservation rows in an upload: a row without a customer is Rejected and not imported, and imports after the Excel is fixed and uploaded again; an undated row imports with a warning; a row whose core is already held is skipped; a row with an unknown region is Needs review and not imported; after "Close reservation import", reservation rows are ignored with a warning and nothing is imported, and closing writes the `data_edits` row with user and reason.
- **TEST-019**: Site master upload. Sheets with renamed tabs are found by headers; header case and spacing are ignored; no matching sheet blocks that part with a message naming the expected headers. "TBA", "N/A", "NA", "-", "TBC" and empty are blank, not invalid. Per sheet the preview shows Added, Changed, Missing and Problem, and nothing is written before apply. A file with 10% or more fewer rows blocks that sheet until the admin confirms; an empty sheet, missing headers or duplicate keys block it; a failing DC sheet does not block a good sites sheet. Apply inserts Added, updates Changed with `data_edits` rows (reason: the upload), marks Missing inactive, keeps a Missing site active with a warning when a span or reservation uses it, and never deletes. A dashboard-edited field shows "edited in dashboard, file differs" and keeps its value. A missing DC plus a new DC with the same LRD and coordinates is flagged "possible rename". A DC with blank or invalid lat/long takes the linked site's location, labelled "location from site <LRD>"; with neither valid it is Needs review and not in the map data; a DC row creates no new site. A site with invalid coordinates is Needs review, not in the map data, and still routable.
- **TEST-020**: Playwright, map page: the hash `#span=` and `#route=` restores the selection on load; with tiles blocked, search and lists still reach every span and route; the chosen bar stays visible while the grid is in view; Reserve on a route with a short span is disabled and names the span; arrow keys move between ribbon spans; layout has no horizontal scroll at 1200, 1280, 1440 and 1920px.
- **TEST-022**: Mock route with a drawn shape. The map data returns the mock segment's two spans with its LineString, and the map draws that shape; every other span is a straight line between its two sites.
- **TEST-021**: Reservation history endpoint returns the events of a reservation in order with user, time, reason and covered cores, and a planner can read only what they may see in the app; Keep and Release from the core detail call the existing actions.

## 7. Risks & Assumptions

- **RISK-001**: Thirteen phases in 11 days for one person. Mitigation: the checkpoints in Phase 13 (TASK-059 to TASK-061).
- **RISK-002**: Real Excel headers differ from the mock. Mitigation: all header mapping lives in `api/app/ingest/columns.py`; TASK-062 runs on real data before release.
- **RISK-003**: First use of PostGIS, MapLibre and PMTiles. Mitigation: one-day time box and the SVG fallback (TASK-055); the workflow's Step 3 spike tests this before the build.
- **RISK-004**: Loss band boundaries are not stated as inclusive or exclusive in the PRD. TEST-008 fixes whichever rule is agreed. Until decided, a value exactly on 3%, 7% or 10% belongs to the lower level.
- **RISK-006**: A Southeast Asia extract capped at zoom 14 may be too large to ship easily between machines. Map tiles cannot travel by email (CON-008), so the PMTiles extract must be downloaded or built on each target machine, which may need its own IT ticket for the download source. Option to decide in the workflow's Step 3 spike: Malaysia at zoom 14 plus the rest of Southeast Asia at a lower zoom.
- **RISK-007**: Outlook may block or strip zip attachments, or attachments above a size limit. Fallback to agree with IT: a shared drive or an internal Git host.
- **RISK-008**: KMZ routes are named `<site A> - <site B>`, but several segments can share the same two end sites, so a KMZ name may match more than one segment. Such routes go to the validation report. Check against the mock files arriving 22 October 2026.
- **RISK-009**: Data is uncleaned: free-text requestors, merged cells, region typos, malformed port ranges and bad coordinates in the sample workbook. Impact: bad rows save silently, plot in the wrong place or create wrong reservations. Mitigation: raw staging with a status per row (Ready, Needs review, Rejected), Needs review for anything not safely readable, the `excel_check` command (TASK-069), and the same checks in the upload preview.
- **RISK-010**: The map page is now the home page and holds the whole span workflow, so the UI rework (TASK-073 to TASK-079) lands in Phase 11 with the one-day map time box. Impact: the main page slips. Mitigation: lists and search work without the map (TASK-055 fallback); open question whether the shell and sections (TASK-073 to TASK-075) move to an earlier session.
- **RISK-011**: A site master file that is wrong or partial would mark many sites inactive. Mitigation: the whole-file checks (10% fewer rows blocks the sheet), the preview before apply, no deletion, and a site in use by a span or reservation stays active.
- **ASSUMPTION-001**: The span key is the unordered site pair; Excel may list a span as A to B or B to A.
- **ASSUMPTION-002**: Phase 12 moves to v1.1 because SMTP access comes later.
- **ASSUMPTION-003**: Planned workflow Steps 3 (spike) and 4 (tickets) run before Phase 1 starts, unless skipped by decision.
- **ASSUMPTION-004**: Work continues on weekends (24, 25 and 31 October are weekend days). Confirmed by the owner on 21 October 2026.

## 8. Related Specifications / Further Reading

- `docs/PRD.md`: requirements
- `docs/architecture.md`: architecture and pinned versions
- `docs/fiber-dashboard-workflow.md`: build workflow and session order
- `CLAUDE.md`: project rules and delegation
- `docs/mockups/comparison/`: reference mocks

## 9. Later / parked

Not MVP (owner, 26 October 2026).

- Excel export of reservations in the Reservation sheet layout (region blocks, title rows, LRD-LRD pairs with "(additional core)", core assignment, ports, contractor, remark, requestor, request date) with a Fiber ID column so re-uploads match exactly, and a header note "Generated from Fiber on <date>. Make changes in the dashboard."
- Idea: the web app holds the reservation Excel and appends or modifies its rows when reservations are made in the dashboard, keeping both in sync.
- Reservation uploads while Excel and dashboard are both in use: compare each row with the dashboard and label New, Same, Differs, Clash or Missing; the dashboard is never overwritten automatically. The "Close reservation import" switch stays as an optional one-time admin action.
- Link loss tab in the Inspector, and a "lowest loss" route option, once measurement data exists.
- Dark theme.
- Per-span core override on route reservations.
- Inspector tabs Site and Services, and map layers Services and Data centres (placeholders for DC internals and bandwidth).
- Undo or rollback of a site master upload (the MVP keeps previous uploads for comparison only).
- Real KMZ import and KMZ route shapes on the map (the MVP uses straight lines plus one mock route with a drawn shape, TASK-084).
- Optional Reservation workbook columns `Core status` (mark a core Faulty), `Loss (dB)` and `Tested on` (append a measurement). The parser already reads them when present, but the real sheet has none; agree the column names with the planners before relying on them.

Open questions:

- How an upload may "modify" a reservation. Proposal: customer and date through a 'corrected' event chosen by the admin; core differences need release and a new reservation; missing rows only warn.
- Count-only reservations: whether real rows have blank or short core assignments. Check by running `excel_check` on the real file on the work laptop. If every real row lists its cores, a blank assignment could become Needs review instead of a count-only reservation.
