# Fiber Dashboard

Read before working: `docs/PRD.md` (requirements), `docs/architecture.md` (design and pinned versions), `docs/fiber-dashboard-workflow.md` (build steps and session order). Where they disagree, the PRD wins, except for layout and UI, where `docs/DESIGN.md` wins. Read `docs/DESIGN.md` before any UI or mock work.

## Commands

- `docker compose up -d --build`: start db, api (http://localhost:8000) and web (http://localhost:5173). Copy `.env.example` to `.env` first.
- `docker compose exec api pytest`: backend tests.
- Lint: `docker compose exec web npm run lint` (oxlint, TypeScript).
- `docker compose exec api alembic upgrade head`: apply migrations.
- `docker compose exec api python -m app.create_admin USERNAME "Display name"`: first admin on an empty database; asks for the password (hidden). The dev seeds are for DEV data only.
- `docker compose exec api python -m app.seed_dev_network`: DEV only (refuses unless APP_ENV=development, safe to run again): adds 8 DEV west-coast sites, 14 segments with loops, and a road-shaped line per DEV segment from `api/app/dev_road_shapes.json` (OSRM, fetched once, no network at seed time).
- `docker compose exec api python -m app.load_data --template data/fiber-data.xlsx` writes a blank Sites/Segments workbook to `api/data/` (git-ignored); `docker compose exec api python -m app.load_data ADMIN data/fiber-data.xlsx` loads it through the same code as the Upload tab, plus Surveyed cores and Total cores. Safe to run again.
- Python dependencies: `api/requirements.lock` holds the runtime packages (exact pins, packages they need included); `api/requirements-dev.lock` holds test tools (pytest, httpx) and exists only on `dev`; the api Dockerfile installs it when present. Edit it, then check inside a `python:3.14.8-slim` container with `pip install -r requirements.lock && pip check`. npm dependencies: `npm install --save-exact` inside the web container so `web/package-lock.json` updates.
- Host venv for the editor and pyright only (the app runs in Docker): `python3 -m venv --without-pip api/.venv && python3 -m pip --python api/.venv/bin/python install -r api/requirements.lock`.
- UI tests: `docker compose exec web npx playwright install --with-deps chromium` once after each web image rebuild, then `docker compose exec web npm run test:e2e`.
- Map basemap: `./scripts/get-tiles.sh` once per machine with internet (downloads `web/public/map/malaysia.pmtiles` and the label fonts into `web/public/map/fonts/`, git-ignored, never shipped by git or email; `FORCE=1` downloads again). Without them the map falls back to a plain overlay with a note.
- Ship to another machine: `git archive --format=zip -o fiber.zip HEAD` (source only; images are built on each machine).

## Domain rules

- Reservations are insert-only events. An upload never changes a reservation.
- Excel imports reservations only until the one-time "Close reservation import" switch is closed (a `data_edits` row: entity 'system', entity_id 0, field 'reservation_import', new_value 'closed'). After that, reservation rows in an upload are ignored with a warning and new reservations are made only in the dashboard.
- Release is not deletion. It adds a 'released' event and frees only the `core_holds` lock row; the reservation, its cores and its events stay. A release can cover only some cores of a route reservation.
- Corrections are only for customer and planned date, on approved reservations, with a reason, as a 'corrected' event. Cores are never corrected or swapped: release and request again. Customer is required on every reservation.
- Surveyed capacity: a segment shows one core cell per surveyed core (`segments.survey_cores`, from the onsite survey), never one cell per core of the cable. `segments.cable_size` (default 144) is info only, shown as "Total cores". A segment with no survey count is "not surveyed" and cannot be booked until an admin enters a count, with a reason.
- Excel never imports ports or core assignment: every reservation row imports as a count-only reservation from "No of core requested" (`unassigned_cores = N`, no cores, ports "-"), raw cells kept in staging. Admins add ports (`POST /api/admin/cores/{id}/ports`, reason required) and assign cores by hand. Count-only reservations: Free = Available cells minus the remaining unassigned cores of active reservations on the segment; nobody can book more (409). Only an admin `assign` action adds specific cores later (an 'assigned' event); remaining unassigned is derived from events.
- Segment list upload (Upload tab): a sheet of `Link` (AAAA-BBBB) and `Distance`, optional `Site A`, `Route` (text such as R1), `Section`, `Type` (Trunk, Metro) creates and updates segments between sites already in the dashboard. Rows with an unknown site are Needs review and skipped; nothing is deleted; dashboard-edited fields are protected. `segments.route` and `segments.section` are plain text.
- Routes are labels for display and the KMZ map line. Routing runs over segments: each segment joins two sites, weighted by km, and any site can route to any site.
- "Nodes" is only an Excel column name, used by the parser. It is not a database or domain term. Its value is a site pair `LRD-LRD` and becomes a segment. A site is one place with one 4-letter LRD code.
- Uploads are layered: every row is kept raw in staging with sheet name and row number, and gets a status Ready, Needs review or Rejected with a reason. Raw text is always kept and parsed fields are added on top; a parser failure never blocks the import. Needs review means a row the admin must look at. Never guess a value to make a row pass.
- Real data files must not be committed.
- Time zone is Asia/Kuala_Lumpur for date logic (stale rule, daily digest) and date display. Timestamps are stored in UTC (timestamptz).
- Every write is attributable to a user, and every data edit needs a reason and is kept as history.
- Nothing is deleted. Accounts are deactivated.
- After the first import the dashboard database is the source of truth and the Excel is a feed. A field edited in the dashboard is protected from uploads.
- Internal segment ID is the key. Two sites have at most one segment; uploads match a segment by its site pair. Circuit ID comes from another system and is an optional field on the core, because one segment carries many circuits.
- Loss belongs to a CORE, not to the whole segment cable. Each core has a calculated loss and a measured loss. Calculated loss comes from this formula: Calculated loss (dB) = distance_km x 0.25 + 0.1 x splices + 0.5 x connectors, with splices = distance_km / 4 (exact) and connectors = 2 per segment, rounded to 2 decimals (32.5 km = 9.94 dB); a route sums its segments' values. Measured loss is a physical field test by the field team, kept with its test type, date and team. Always label them "Calculated loss" and "Measured loss", never just "Loss". Segment-level views show no loss; per-core loss lives in core details and the reserve box. A measurement with no core recorded (old Excel imports) is shown as "core not recorded". Distance comes from the Excel.
- Site is the general term for a site, building or equipment location.
- The same Docker Compose setup runs unchanged on the personal laptop, work laptop, dev server and production server. Anything machine-specific lives only in `.env`.

## UI rules (owner decisions, apply to every screen and every mock)

- No eyebrow labels: no small label above a title or a number ("Free" as a tiny line above its number).
- No subtext: no muted explanation or restating line under or beside a title, number or control. Keep only labels, table headers, empty states, validation and error messages, confirmation counts, and a fact that appears nowhere else. Screen-reader text may stay as sr-only.
- No check-mark or "healthy" chip beside a title. Status shows in the number's colour; a state such as Cut keeps its chip.
- Core status words are Available, Requested, Reserved, In service (data value `In use`). There is no per-core Faulty: a fiber cut is a state of the segment. Route types are Trunk and Metro only. One merged "Cores" table (see `docs/DESIGN.md`).
- Map chips show only the free-core number on the line, no icons. Status is never colour alone: symbol, pattern or word somewhere on the screen.
- Do not add Collapse map, Site/Services "Later" tabs, a Reserve tab, or helper lines like "Reserve is off: ...".
- Tabs: Inventory and My reservations. Inventory: map (8 of 12 columns, never shrunk, Region and Type filters in its toolbar) with the "Site A to B" panel beside it at map height, the segment diagram (the current `SegmentDiagram`), a row below it with "Reserve on this route" and "Edit segment" (same width), then the Cores table. Reserving opens as a box over Inventory. Full layout: `docs/DESIGN.md` section 3.

## Delegating to subagents

The main chat stays on one model so its cache is kept. Hand work to a subagent by setting `model` on the Agent call:

- Haiku: mechanical work with obvious output. Renames, moving text, ticking checklists, version lookups, running a command and reporting its output.
- Sonnet: applying the user's answers to a doc where wording or consistency matters (plan, architecture, PRD), and backend code: schema, reservation rules, upload logic, tests.
- Opus 5.5 or Fable: all UI and design work (mockups, React components, styling, layout). Not Sonnet.
- Main chat: asking questions, design calls, trade-offs, and reviewing the result.

If a wrong edit would take real judgment to spot, use Sonnet. A subagent starts with no context, so put the answers and the exact edits in its prompt. Review every subagent diff before reporting it as done.
