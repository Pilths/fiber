# Fiber Dashboard

Read before working: `docs/PRD.md` (requirements), `docs/architecture.md` (design and pinned versions), `docs/fiber-dashboard-workflow.md` (build steps and session order). Where they disagree, the PRD wins, except for layout and UI, where `docs/DESIGN.md` wins. Read `docs/DESIGN.md` before any UI or mock work.

## Commands

- `docker compose up -d --build`: start db, api (http://localhost:8000) and web (http://localhost:5173). Copy `.env.example` to `.env` first.
- `docker compose exec api pytest`: backend tests.
- Lint: `docker compose exec web npm run lint` (oxlint, TypeScript; `curly`, `no-nested-ternary` and `no-unused-expressions` are errors). Typecheck: `docker compose exec web npx tsc -b --noEmit` (plain `tsc --noEmit` at the root checks nothing: the root tsconfig only references the others). Backend: `docker compose exec api ruff check .` (line length 120, no one-line `if`/`;` statements; config `api/ruff.toml`).
- `docker compose exec api alembic upgrade head`: apply migrations.
- `docker compose exec api python -m app.create_admin USERNAME "Display name"`: first admin on an empty database; asks for the password (hidden). The dev seeds are for DEV data only.
- `docker compose exec api python -m app.seed_dev_network`: DEV only (refuses unless APP_ENV=development, safe to run again): adds 8 DEV west-coast sites, 14 segments with loops, port gaps on DEV Klang Hut - DEV Cyberjaya DC (cores 5-16), and a road-shaped line per DEV segment from `api/app/dev_road_shapes.json` (OSRM, fetched once, no network at seed time).
- `docker compose exec api python -m app.load_data --template data/fiber-data.xlsx` writes a blank Sites/Segments workbook to `api/data/` (git-ignored), `--reservation-template data/reservations.xlsx` a separate blank Reservation workbook (Region optional); `docker compose exec api python -m app.load_data ADMIN data/FILE.xlsx` loads either through the same code as the Upload tab, plus Verified cores (the old "Surveyed cores" header is still accepted) and Total cores, and a Reservation sheet as count-only reservations (same rules as the Upload tab). Safe to run again.
- `docker compose exec api python -m app.load_kmz USERNAME data/file.kmz [--folder "propose route"]`: draws road-shaped lines from a Google Earth KMZ (file in `api/data/`, git-ignored). Reads only the "propose route" folder by default (`--folder` to change); lines are matched to segments by their title `AAAA-BBBB` (two site names), and pieces with the same title are joined. Safe to run again.
- Python dependencies: `api/requirements.lock` holds the runtime packages (exact pins, packages they need included); `api/requirements-dev.lock` holds test tools (pytest, httpx) and exists only on `dev`; the api Dockerfile installs it when present. Edit it, then check inside a `python:3.14.8-slim` container with `pip install -r requirements.lock && pip check`. npm dependencies: `npm install --save-exact` inside the web container so `web/package-lock.json` updates.
- Host venv for the editor and pyright only (the app runs in Docker): `python3 -m venv --without-pip api/.venv && python3 -m pip --python api/.venv/bin/python install -r api/requirements.lock`.
- UI tests: `docker compose exec web npx playwright install --with-deps chromium` once after each web image rebuild, then `docker compose exec web npm run test:e2e`.
- Map basemap: `./scripts/get-tiles.sh` once per machine with internet (downloads `web/public/map/malaysia.pmtiles` and the label fonts into `web/public/map/fonts/`, git-ignored, never shipped by git or email; `FORCE=1` downloads again). Without them the map falls back to a plain overlay with a note.
- Backups: `./scripts/backup-db.sh` writes `backups/fiber-<time>.dump` (git-ignored, keeps the newest 14, `KEEP=n` to change; cron line in the script header). `./scripts/restore-check.sh [file]` is the restore drill: loads a dump into a separate `fiber_restore_check` database, prints row counts, drops it.
- The database uses only the `postgis` and `pg_trgm` extensions. `db/initdb/10_postgis.sh` replaces the image's startup script so new volumes do not get `postgis_tiger_geocoder` or `postgis_topology`; migration 0006 drops them from existing databases.
- `GET /api/health` is liveness; `GET /api/ready` returns 503 when the database is not at the Alembic head.
- Production (`main` branch only): copy `.env.example` to `.env` and change both `change-me` values; `./scripts/get-tiles.sh`; `docker compose up -d --build`; `docker compose exec api alembic upgrade head`; `docker compose exec api python -m app.create_admin USERNAME "Display name"`. The site is http://SERVER:8000 (`API_PORT` in `.env`). Workbooks for the `app.load_*` commands go in with `docker compose cp FILE api:/app/data/`. `main` is built from `dev` by copying the runtime code (api/app, api/alembic, web/src and the scripts) and leaving out the DEV seed scripts, tests, docs and dev tools.
- Ship to another machine: `git archive --format=zip -o fiber.zip HEAD` (source only; images are built on each machine).

## Domain rules

- Reservations are insert-only events. An upload never changes a reservation.
- Excel imports reservations only until the one-time "Close reservation import" switch is closed (a `data_edits` row: entity 'system', entity_id 0, field 'reservation_import', new_value 'closed'). After that, reservation rows in an upload are ignored with a warning and new reservations are made only in the dashboard.
- Release is not deletion. It adds a 'released' event and frees only the `core_holds` lock row; the reservation, its cores and its events stay. A release can cover only some cores of a route reservation.
- Keep is offered only on a stale reservation (approved, no approval or keep for over 3 months, no release waiting); it adds a 'kept' event and restarts the 3-month clock. The API refuses Keep otherwise (409).
- Corrections are only for customer and planned date, on approved reservations, as a 'corrected' event (remarks optional). Cores are never corrected or swapped: release and request again. Customer is required on every reservation.
- Core verification is the term in all UI, docs and messages; the DB column `segments.survey_cores` and API fields keep the old name.
- Verified capacity: a segment shows one core cell per verified core (`segments.survey_cores`, from core verification), never one cell per core of the cable. `segments.cable_size` (default 144) is info only, shown as "Total cores". A segment with no verified core count is "not verified" and cannot be booked until an admin enters a count.
- Excel never imports ports or core assignment: every reservation row imports as a count-only reservation from "No of core requested" (`unassigned_cores = N`, no cores, ports "-"), raw cells kept in staging. Admins add ports (`POST /api/admin/cores/{id}/ports`, no remarks field) and assign cores by hand. Count-only reservations: Free = Available cells minus the remaining unassigned cores of active reservations on the segment; nobody can book more (409). Only an admin `assign` action adds specific cores later (an 'assigned' event); remaining unassigned is derived from events.
- Port labels have two shapes only: `FDF1-MOD2-T3-P5` (frame, module, tray, port) and `ODF1-P5`, each part a number or 1 to 4 letters/digits (`api/app/port_label.py`; lenient input, one canonical output, unique per site). The single-core ports edit is a picker (FDF/ODF plus one short box per part); Paste ports reads one label per Excel cell and shows anything else as Problem. Old labels in other shapes stay until edited.
- Segment list upload (Upload tab): a sheet of `Link` (AAAA-BBBB) and `Distance`, optional `Site A`, `Route` (text such as R1), `Section` (there is no type column; a `Type`/`route_type` column is ignored) creates and updates segments between sites already in the dashboard. Rows with an unknown site are Needs review and skipped; nothing is deleted; dashboard-edited fields are protected. `segments.route` and `segments.section` are plain text.
- KMZ upload (Upload tab "KMZ route lines", or `app.load_kmz`): reads the lines of one KML folder (default "propose route"); pins and other folders are ignored. Lines are matched to segments by their Placemark title `AAAA-BBBB` (two site names, either order, case and spaces around the dash tolerated); pieces with the same title are joined into one line (one route row per segment). Untitled lines, titles that are not a site pair and pairs with no segment show as Needs review and are skipped. Preview first; apply replaces a segment's line. Segments are never created from a KMZ. The KML inside may be at most 50 MB unpacked; larger is refused before staging.
- Route type is never uploaded or edited. It is derived on every read from the kinds of a segment's two end sites (`sites.kind`, see `api/app/link_type.py`): both ends data_center = DC-DC; one data_center and one toc = DC-TOC; one data_center and anything else = Metro; everything else = Trunk. The API field stays `route_type`; segments have no route type column.
- Routes are labels for display and the KMZ map line. Routing runs over segments: each segment joins two sites, weighted by km, and any site can route to any site.
- "Nodes" is only an Excel column name, used by the parser. It is not a database or domain term. Its value is a site pair `LRD-LRD` and becomes a segment. A site is one place with one 4-letter LRD code.
- Uploads are layered: every row is kept raw in staging with sheet name and row number, and gets a status Ready, Needs review or Rejected with a reason. Raw text is always kept and parsed fields are added on top; a parser failure never blocks the import. Needs review means a row the admin must look at. Never guess a value to make a row pass.
- Real data files must not be committed.
- Time zone is Asia/Kuala_Lumpur for date logic (stale rule, daily digest) and date display. Timestamps are stored in UTC (timestamptz).
- Every write is attributable to a user, and every data edit is kept as history. The user's free-text note on an edit or event is called "Remarks" everywhere (UI, API field `remarks`, DB columns `data_edits.remarks` and `reservation_events.remarks`, renamed from `reason` by migration 0007). Remarks are optional everywhere, including closing the reservation import and a site-master override (owner decision, 19 Nov 2026); a blank remark is stored as NULL and shown as nothing. Older rows may still hold "no reason given" and stay as they are. Upload rows keep `reason` for why a row was rejected or skipped: that is a different thing.
- Nothing is deleted. Accounts are deactivated.
- After the first import the dashboard database is the source of truth and the Excel is a feed. A field edited in the dashboard is protected from uploads: a dashboard edit is a `data_edits` row with no `upload_id` (uploads and `load_data` fill it; remarks text does not matter).
- Internal segment ID is the key. Two sites have at most one segment; uploads match a segment by its site pair. Cores have no circuit ID (dropped 11 Nov 2026: no data source); the core key is the internal core ID.
- Loss belongs to a CORE, not to the whole segment cable. Each core has a calculated loss and a measured loss. Calculated loss comes from this formula: Calculated loss (dB) = distance_km x 0.25 + 0.1 x splices + 0.5 x connectors, with splices = distance_km / 4 (exact) and connectors = 2 per segment, rounded to 2 decimals (32.5 km = 9.94 dB); a route sums its segments' values. Measured loss is a physical field test by the field team, kept with its test type, date and team. Always label them "Calculated loss" and "Measured loss", never just "Loss". Segment-level views show no loss; per-core loss lives in core details and the reserve box. A measurement with no core recorded (old Excel imports) is shown as "core not recorded". Distance comes from the Excel.
- Site is the general term for a site, building or equipment location.
- Two Docker Compose setups, one per branch, each running unchanged on every machine that uses it; anything machine-specific lives only in `.env`. `dev` is the development stack (db, api with reload and source mounts, web on the Vite dev server). `main` is the production stack (db and api only; the api image builds the web app in a Node stage and FastAPI serves it, so no Node or Vite runs in production). Production serves plain HTTP with `COOKIE_SECURE=0`; there is no TLS proxy (owner decision, 18 Nov 2026).

## UI rules (owner decisions, apply to every screen and every mock)

- No eyebrow labels: no small label above a title or a number ("Free" as a tiny line above its number).
- No subtext: no muted explanation or restating line under or beside a title, number or control. Keep only labels, table headers, empty states, validation and error messages, confirmation counts, and a fact that appears nowhere else. Screen-reader text may stay as sr-only.
- No check-mark or "healthy" chip beside a title. Status shows in the number's colour; a state such as Cut keeps its chip.
- Core status words are Available, Requested, Reserved, In service (data value `In use`). There is no per-core Faulty: a fiber cut is a state of the segment. Route types are derived from the end sites: Trunk, Metro, DC-DC, DC-TOC. One merged "Cores" table (see `docs/DESIGN.md`).
- Map chips show only the free-core number on the line, no icons. Status is never colour alone: symbol, pattern or word somewhere on the screen.
- Do not add Collapse map, Site/Services "Later" tabs, a Reserve tab, or helper lines like "Reserve is off: ...".
- Tabs: Inventory and My reservations. Inventory: map (8 of 12 columns, never shrunk, Region filter and Layers (route types, trunk routes, site kinds) in its toolbar) with the "Site A to B" panel beside it at map height, the segment diagram (the current `SegmentDiagram`), a row below it with "Reserve on this route" and "Edit segment" (same width), then the Cores table. Reserving opens as a box over Inventory. Full layout: `docs/DESIGN.md` section 3.

## Code style and docs upkeep

- Coding standards: see `CODING_STANDARDS.md`. Architecture: see `docs/architecture.md`.
- Review workflow (session order, skills used): see `docs/review-workflow.md`.
- When a change alters structure or data flow, update `docs/architecture.md` and its Last verified line.
- Update `docs/LEARNING.md` only when a change introduces or removes a concept, or changes the architecture or data flow. Edit the existing section rather than appending. Skip bug fixes, renames, small refactors and performance tweaks that use an already-documented concept.

## Agent skills

### Issue tracker

Local markdown under `.scratch/<feature>/`. See `docs/agents/issue-tracker.md`.

### Domain docs

Single-context (`GLOSSARY.md` and `docs/adr/` at the repo root, created when first needed). See `docs/agents/domain.md`.

## Delegating to subagents

The main chat stays on one model so its cache is kept. Hand work to a subagent by setting `model` on the Agent call:

- Haiku: mechanical work with obvious output. Renames, moving text, ticking checklists, version lookups, running a command and reporting its output.
- Sonnet: applying the user's answers to a doc where wording or consistency matters (plan, architecture, PRD), and backend code: schema, reservation rules, upload logic, tests.
- Opus 5.5 or Fable: all UI and design work (mockups, React components, styling, layout). Not Sonnet.
- Main chat: asking questions, design calls, trade-offs, and reviewing the result.

If a wrong edit would take real judgment to spot, use Sonnet. A subagent starts with no context, so put the answers and the exact edits in its prompt. Review every subagent diff before reporting it as done.
