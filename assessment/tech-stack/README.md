# Tech stack assessment (18 Nov 2026)

Goal: simplicity, efficiency, less slop, one setup that runs everywhere. Findings come from the running
dev stack, `api/requirements.lock`, `web/package.json` and the code on `dev` at 0b2e693.

The stack is already lean. Most pieces earn their place. The real wins are a production build that
does not run the Vite dev server, and a reload watcher that burns CPU at idle.

## Phases

| Phase | File | What | Size |
| --- | --- | --- | --- |
| 1 | [phase-1-quick-fixes.md](phase-1-quick-fixes.md) | Idle CPU fix, unused dependency, selective e2e runs | Small |
| 2 | [phase-2-production-build.md](phase-2-production-build.md) | FastAPI serves the built frontend; no Node and no nginx in production | About 20 lines |
| 3 | [phase-3-optional-cuts.md](phase-3-optional-cuts.md) | NetworkX, fonts, planned APScheduler | Small, optional |
| Parked | [parked-frontend-framework.md](parked-frontend-framework.md) | React to Vue | Large, parked by owner |

## Every piece of the stack and why it is there

| Layer | Tool | Why | Verdict |
| --- | --- | --- | --- |
| Database | PostgreSQL 18 | Source of truth, transactions, advisory lock for reservations | Keep |
| Database | PostGIS | Site points and segment lines (`ST_MakePoint`, `ST_GeomFromGeoJSON`), GeoJSON for the map | Keep: free in the image, KMZ lines need it |
| API | Python 3.14 | Best libraries for Excel, KMZ and graphs | Keep |
| API | FastAPI, Starlette, Pydantic | Routes, validation, OpenAPI spec that generates the TypeScript types | Keep |
| API | Uvicorn | ASGI server | Keep |
| API | SQLAlchemy | Engine, pool and `text()` SQL; the code is mostly raw SQL | Keep, already used thinly |
| API | Alembic (with Mako) | Schema migrations | Keep |
| API | psycopg 3 | Postgres driver | Keep |
| API | openpyxl | Excel uploads and templates, a core feature | Keep |
| API | NetworkX | Shortest path over segments (`api/app/routing/graph.py`, 36 lines) | Optional cut, phase 3 |
| API | argon2-cffi | Password hashing | Keep (security) |
| API | python-multipart | File uploads, required by FastAPI | Keep |
| API | opentelemetry-api | In the lock file; nothing in `api/app` imports it | Check, phase 1 |
| Web | React 19, TypeScript | UI | Parked question (Vue) |
| Web | Vite 8, `@vitejs/plugin-react` | Dev server, build, `/api` proxy | Keep for dev; not in production (phase 2) |
| Web | Tailwind 4, `@tailwindcss/vite` | Styling | Keep |
| Web | Geist fonts (two `@fontsource` packages) | Self-hosted fonts, no CDN | Optional cut, phase 3 |
| Web | MapLibre GL, PMTiles | Offline basemap with no tile server | Keep |
| Web | openapi-typescript | Types generated from the API, never hand-written | Keep |
| Lint | oxlint, `tsc` | Fast lint, typecheck in `build` | Keep |
| Test | pytest, httpx | Backend tests (dev branch only) | Keep |
| Test | Playwright | UI e2e suite | Keep |
| Ops | Docker Compose | Same setup on every machine | Keep |
| Planned | APScheduler | Daily digest job | Do not add, phase 3 |

Not worth cutting: PostGIS, SQLAlchemy, Alembic, Tailwind and openapi-typescript. Each one removes
hand-written code or a real failure mode; dropping it adds work.

## Why two languages

- Python is the runtime because the work is data: Excel parsing, KMZ, routing, Postgres.
- Node is only a build tool. The browser cannot run TypeScript or JSX, so Vite compiles them. After
  phase 2, Node never runs in production.
