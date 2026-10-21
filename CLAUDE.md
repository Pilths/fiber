# Fiber Dashboard

Read before working: `docs/PRD.md` (requirements), `docs/architecture.md` (design and pinned versions), `docs/fiber-dashboard-workflow.md` (build steps and session order). Where they disagree, the PRD wins.

## Commands

- `docker compose up -d --build`: start db, api (http://localhost:8000) and web (http://localhost:5173). Copy `.env.example` to `.env` first.
- `docker compose exec api pytest`: backend tests.
- `docker compose exec api alembic upgrade head`: apply migrations.
- Python dependencies: edit `api/requirements.in`, then regenerate `api/requirements.lock` with `pip freeze` inside a `python:3.14.8-slim` container. npm dependencies: `npm install --save-exact` inside the web container so `web/package-lock.json` updates.
- Host venv for the editor and pyright only (the app runs in Docker): `python3 -m venv --without-pip api/.venv && python3 -m pip --python api/.venv/bin/python install -r api/requirements.lock`.
- Ship to another machine: `git archive --format=zip -o fiber.zip HEAD` (source only; images are built on each machine).

## Domain rules

- Reservations are insert-only events. An upload never changes a reservation.
- Release is not deletion. It adds a 'released' event and frees only the `core_holds` lock row; the reservation, its cores and its events stay. A release can cover only some cores of a route reservation.
- Corrections are only for customer and planned date, on approved reservations, with a reason, as a 'corrected' event. Cores are never corrected or swapped: release and request again. Customer is required on every reservation.
- Segments are labels for display and the KMZ map line. Routing runs over spans: sites are nodes, spans are edges, and any site can route to any site.
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
- Sonnet: applying the user's answers to a doc where wording or consistency matters (plan, architecture, PRD), and all code: schema, reservation rules, upload logic, tests.
- Main chat: asking questions, design calls, trade-offs, and reviewing the result.

If a wrong edit would take real judgment to spot, use Sonnet. A subagent starts with no context, so put the answers and the exact edits in its prompt. Review every subagent diff before reporting it as done.
