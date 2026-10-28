# Fiber Dashboard

Read before working: `docs/PRD.md` (requirements), `docs/architecture.md` (design and pinned versions), `docs/fiber-dashboard-workflow.md` (build steps and session order). Where they disagree, the PRD wins.

## Commands

- `docker compose up -d --build`: start db, api (http://localhost:8000) and web (http://localhost:5173). Copy `.env.example` to `.env` first.
- `docker compose exec api pytest`: backend tests.
- Lint: `docker compose exec web npm run lint` (oxlint, TypeScript).
- `docker compose exec api alembic upgrade head`: apply migrations.
- `docker compose exec api python -m app.create_admin USERNAME "Display name"`: first admin on an empty database; asks for the password (hidden). The dev seeds are for DEV data only.
- Python dependencies: edit `api/requirements.in`, then regenerate `api/requirements.lock` with `pip freeze` inside a `python:3.14.8-slim` container. npm dependencies: `npm install --save-exact` inside the web container so `web/package-lock.json` updates.
- Host venv for the editor and pyright only (the app runs in Docker): `python3 -m venv --without-pip api/.venv && python3 -m pip --python api/.venv/bin/python install -r api/requirements.lock`.
- UI tests: `docker compose exec web npx playwright install --with-deps chromium` once after each web image rebuild, then `docker compose exec web npm run test:e2e`.
- Map basemap: `./scripts/get-tiles.sh` once per machine with internet (downloads `web/public/map/malaysia.pmtiles` and the label fonts into `web/public/map/fonts/`, git-ignored, never shipped by git or email; `FORCE=1` downloads again). Without them the map falls back to a plain overlay with a note.
- Ship to another machine: `git archive --format=zip -o fiber.zip HEAD` (source only; images are built on each machine).

## Domain rules

- Reservations are insert-only events. An upload never changes a reservation.
- Excel imports reservations only until the one-time "Close reservation import" switch is closed (a `data_edits` row: entity 'system', entity_id 0, field 'reservation_import', new_value 'closed'). After that, reservation rows in an upload are ignored with a warning and new reservations are made only in the dashboard.
- Release is not deletion. It adds a 'released' event and frees only the `core_holds` lock row; the reservation, its cores and its events stay. A release can cover only some cores of a route reservation.
- Corrections are only for customer and planned date, on approved reservations, with a reason, as a 'corrected' event. Cores are never corrected or swapped: release and request again. Customer is required on every reservation.
- Surveyed capacity: a span shows one core cell per surveyed core (`spans.survey_cores`, from the onsite survey), never per cable size. `spans.cable_size` (default 144) is info only. A span with no survey count is "not surveyed" and cannot be booked until an admin enters a count, with a reason.
- Excel never imports ports or core assignment: every reservation row imports as a count-only reservation from "No of core requested" (`unassigned_cores = N`, no cores, ports "-"), raw cells kept in staging. Admins add ports (`POST /api/admin/cores/{id}/ports`, reason required) and assign cores by hand. Count-only reservations: Free to reserve = Available cells minus the remaining unassigned cores of active reservations on the span; nobody can book more (409). Only an admin `assign` action adds specific cores later (an 'assigned' event); remaining unassigned is derived from events.
- Segments are labels for display and the KMZ map line. Routing runs over spans: each span joins two sites, weighted by km, and any site can route to any site.
- "Nodes" is only an Excel column name, used by the parser. It is not a database or domain term. Its value is a site pair `LRD-LRD` and becomes a span. A site is one place with one 4-letter LRD code.
- Uploads are layered: every row is kept raw in staging with sheet name and row number, and gets a status Ready, Needs review or Rejected with a reason. Raw text is always kept and parsed fields are added on top; a parser failure never blocks the import. Needs review means a row the admin must look at. Never guess a value to make a row pass.
- Real data files must not be committed.
- Time zone is Asia/Kuala_Lumpur for date logic (stale rule, daily digest) and date display. Timestamps are stored in UTC (timestamptz).
- Every write is attributable to a user, and every data edit needs a reason and is kept as history.
- Nothing is deleted. Accounts are deactivated.
- After the first import the dashboard database is the source of truth and the Excel is a feed. A field edited in the dashboard is protected from uploads.
- Internal span ID is the key. Two sites have at most one span; uploads match a span by its site pair. Circuit ID comes from another system and is an optional field on the core, because one span carries many circuits.
- Measurements are stored per span. Distance comes from the Excel.
- Site is the general term for a site, building or equipment location.
- The same Docker Compose setup runs unchanged on the personal laptop, work laptop, dev server and production server. Anything machine-specific lives only in `.env`.

## Delegating to subagents

The main chat stays on one model so its cache is kept. Hand work to a subagent by setting `model` on the Agent call:

- Haiku: mechanical work with obvious output. Renames, moving text, ticking checklists, version lookups, running a command and reporting its output.
- Sonnet: applying the user's answers to a doc where wording or consistency matters (plan, architecture, PRD), and backend code: schema, reservation rules, upload logic, tests.
- Opus 5.5 or Fable: all UI and design work (mockups, React components, styling, layout). Not Sonnet.
- Main chat: asking questions, design calls, trade-offs, and reviewing the result.

If a wrong edit would take real judgment to spot, use Sonnet. A subagent starts with no context, so put the answers and the exact edits in its prompt. Review every subagent diff before reporting it as done.
