# Fiber Dashboard: Epic Architecture Specification

Source: `docs/PRD.md` (22 October 2026). Where this document and the PRD disagree, the PRD wins.

Note on the template: the `breakdown-epic-arch` template assumes Next.js, tRPC, Stack Auth, Redis, Qdrant and n8n. The PRD fixes a different stack (React + Vite, FastAPI, local accounts, PostgreSQL + PostGIS), so those template components are left out on purpose.

## 1. Epic Architecture Overview

One Docker Compose stack on a company-managed server, with three runtime pieces:

- **Web:** a React + TypeScript single-page app (Vite build) plus the self-hosted map assets (PMTiles basemap, glyphs, sprites), served as static files.
- **API:** one FastAPI service, built as a modular monolith. It holds every business rule: ingest (Excel and KMZ), inventory, reservations, loss, routing, identity and notifications. The daily job (APScheduler) runs inside this service.
- **Database:** PostgreSQL with PostGIS. It is the source of truth after the first import.

The design rules that shape everything else:

1. **Append-only history.** Reservations, measurements and data edits are insert-only rows. Current state is derived from them, never overwritten. Nothing is deleted.
2. **The database enforces invariants where it can.** "First request submitted wins" is a unique constraint on active core holds, not an application check.
3. **Every write carries `user_id`.** A dev-only header supplies the user until login lands (Session 5); then a session cookie replaces it with no change to the domain code.
4. **Contract first.** FastAPI's OpenAPI spec generates the TypeScript client (`openapi-typescript`). Stub endpoints come first, and real logic replaces them one endpoint at a time.
5. **No data leaves the network.** No external map API, CDN or font host. Email goes only through the company SMTP relay.

## 2. System Architecture Diagram

```mermaid
flowchart TB
  subgraph USER["User layer (company network, desktop browsers)"]
    P["Planner"]
    A["Admin"]
  end

  subgraph APP["Application layer"]
    WEB["Web container<br/>React SPA (Vite build)<br/>PMTiles basemaps, glyphs, sprites"]
    AUTH["Auth module<br/>local accounts, roles, session cookie<br/>(dev header until Session 5)"]
  end

  subgraph SVC["Service layer: FastAPI modular monolith"]
    INGEST["Ingest<br/>Excel + KMZ parse, validate, clean<br/>staging, preview diff, confirm"]
    INV["Inventory<br/>sites, spans, segments, cores, ports<br/>admin edits with reason"]
    RES["Reservations<br/>request, approve, reject, withdraw<br/>keep, release, correct"]
    LOSS["Loss<br/>calculated vs measured<br/>warning levels"]
    ROUTE["Routing<br/>NetworkX graph of spans, up to 10 options"]
    REVIEW["Needs review + bell count<br/>stale, upload conflicts, faulty cores"]
    JOB["APScheduler daily job<br/>stale check, digest<br/>records last run"]
    NOTIFY["Notifications<br/>in-app + email"]
  end

  subgraph DATA["Data layer"]
    PG[("PostgreSQL + PostGIS<br/>inventory, reservation events,<br/>measurements, edit history,<br/>upload log, job runs")]
    FILES["Excel + KMZ exports<br/>(uploaded by admin)"]
    SMTP["Company SMTP relay<br/>(access TBD)"]
  end

  subgraph INFRA["Infrastructure layer"]
    DC["Docker Compose on company server<br/>web, api, db containers<br/>secrets in environment variables"]
  end

  P -->|HTTPS| WEB
  A -->|HTTPS| WEB
  WEB -->|"REST /api (generated TS client)"| AUTH
  AUTH --> INV & RES & LOSS & ROUTE & REVIEW
  AUTH -->|admin only| INGEST
  FILES -->|upload| INGEST
  INGEST -->|confirm in one transaction| PG
  INV & RES & LOSS & ROUTE & REVIEW --> PG
  RES --> NOTIFY
  JOB -.->|daily, async| REVIEW
  JOB -.-> NOTIFY
  NOTIFY -.->|digest, request emails| SMTP
  INGEST -.->|rebuild graph after confirm| ROUTE
  DC --- WEB & SVC & PG

  classDef user fill:#e8f0fe,stroke:#3367d6,color:#111
  classDef app fill:#e6f4ea,stroke:#188038,color:#111
  classDef svc fill:#fef7e0,stroke:#b06000,color:#111
  classDef data fill:#fce8e6,stroke:#c5221f,color:#111
  classDef infra fill:#f1f3f4,stroke:#5f6368,color:#111
  class P,A user
  class WEB,AUTH app
  class INGEST,INV,RES,LOSS,ROUTE,REVIEW,JOB,NOTIFY svc
  class PG,FILES,SMTP data
  class DC infra
```

Solid lines are synchronous request paths. Dotted lines are asynchronous or scheduled flows.

## 3. High-Level Features & Technical Enablers

### Features (in build order from the workflow)

| # | Feature | PRD story | Key architectural points |
| --- | --- | --- | --- |
| F1 | Search, span list, port grid | 1 | One search endpoint over customer, span, circuit ID and core. Core status is derived (see E3). Filters for region and route type. |
| F2 | Reserve cores and approval flow | 2, 3 | Reservation events are append-only. Route reservations are one request across many spans. A request holds cores; approval reserves them; rejection or withdrawal frees them. A release can cover only some cores of a route reservation; it frees their locks and keeps all records. Corrections touch only customer and planned date. |
| F3 | Needs review and bell count | 2, 3 | A query, not a stored flag: stale reservations, release requests, upload conflicts, faulty cores, pending approvals. |
| F4 | Login and roles | 7 | Local accounts, planner and admin, forced password change, deactivation only. Built right after F2. |
| F5 | Link loss | 4 | Calculated loss in one backend function (distance × 0.3 dB/km). Measurements kept as history; the latest is shown. Coverage is spans with a reading out of all spans. |
| F6 | Admin upload | 8 | Upload, Preview, Confirm. Preview groups New, Changed, Conflicts, Not in this file, Rejected. Upload never touches reservations. |
| F7 | Admin editing | 8 | Core status (Faulty or Available), then span and site details (third cut). Every edit needs a reason and protects the field. |
| F8 | Route planning | 5 | NetworkX graph of spans (sites are nodes, spans are edges); any site to any site; up to 10 options with km, estimated dB, minimum free cores, loss confidence; sort by km or free cores. |
| F9 | Map | 6 | MapLibre with KMZ routes (second cut; fallback is the SVG map from the v6 mock). |
| F10 | Email digest and request emails | 3, 2 | Daily digest and new-request emails through SMTP (first cut). |

### Technical enablers

**E1. Docker Compose stack (Session 0).** Three services: `db` (PostGIS image), `api` (FastAPI, Uvicorn), `web` (Vite dev server in development, static build in production). One `.env` file for secrets, kept out of the repository.

**E2. Schema and migrations (Session 1).** Alembic migrations. Internal IDs for sites, spans and segments. Natural keys for upload matching: span by (site A, site B), since two sites never share more than one span; segment by its two end sites (several segments can share the same two end sites, so that index is not unique); port by Port ID. Route type is an attribute of the span, not part of its key. Circuit ID is an optional column on the core. Site names are unique across all regions. Regions are North, Central, South and East Coast; a new value comes by migration, and an unknown region is a Rejected upload row. Measurements store `test_method` and `field_team`. All timestamps are `timestamptz` stored in UTC.

**E3. Derived core status.** One SQL view gives each core's current status, in priority order:

```text
Faulty     if the latest admin status edit says Faulty
In use     if the Excel marks it in use
Reserved   if it has an approved, unreleased reservation
Requested  if it has a pending request
Available  otherwise
```

**E4. Reservation event log and core holds.** `reservation_events` is insert-only (request, approve, reject, withdraw, keep, release request, release, decline release, correct), each with `user_id`, timestamp and reason where needed. Alongside it, a `core_holds` table has one row per held core, with `core_id` as its primary key. The request event and its holds are written in the same transaction. A second request for the same core fails on the key, and the API returns the taken cores so the planner can pick again. Reject, withdraw and release delete the hold rows; the events keep the history. (`core_holds` is the only table rows are removed from: it is a lock table, not a record.) Release is not deletion: it adds a `released` event, and the reservation, its cores and all events stay. A `release_cores` table records which cores each `release_requested`, `released` and `release_declined` event covers, so a release can free some cores of a route reservation and leave the rest reserved. Releasing all cores ends the reservation. `reservations` and `reservation_cores` are append-only too (triggers reject UPDATE and DELETE). A `corrected` event changes only customer and planned date on an approved reservation; cores are never corrected.

**E5. Edit history and protected fields.** One `data_edits` table: entity type, entity ID, field, old value, new value, reason, `user_id`, timestamp. A field is protected from uploads when an edit row exists for it. Admin corrections to reservations go through E4, not here.

**E6. Two-phase upload.** Parse and validate into a staging area keyed by upload ID (pandas + openpyxl for Excel, zip + XML for KMZ). Compute the preview diff against current data and protected fields. On confirm, apply everything in one transaction and write the upload log (who, when, counts, changes). Nothing outside staging changes before confirm.

**E7. Stale rule as a query.** A reservation is stale when its latest approve or keep event (or its import date when undated) is more than 3 months old and it has no release. Computed at read time, so there is no flag to drift. "Today" and the 3-month boundary use the Asia/Kuala_Lumpur date; the daily digest uses the same date.

**E8. Routing graph.** A NetworkX graph with sites as nodes and spans as edges (weight = km), built in memory from the Postgres span table at startup and rebuilt after an upload is confirmed or a span is edited. Any site can route to any site. Up to 10 options via `shortest_simple_paths`, sorted by km (default) or by free cores (the fewest free cores on any span of the path, higher is better). Segments are labels only. About 100 points of interest, so the graph is tiny. No graph database: NetworkX in memory is enough at this size.

**E9. Scheduler with run record.** APScheduler inside the `api` container. A `job_runs` table records each run by date, so a restart never sends twice. A PostgreSQL advisory lock makes sure only one Uvicorn worker runs the job.

**E10. Auth.** Passwords hashed with Argon2. An httpOnly session cookie on the same origin as the SPA (no token storage in the browser). Role checks are FastAPI dependencies. A dev-only header supplies the user until Session 5 and is disabled outside development.

**E11. Map assets.** One PMTiles extract capped at zoom 14, plus glyphs, sprites, and light and dark styles, all served as static files by `web` (PMTiles is read with HTTP range requests, so no tile server is needed). KMZ routes are stored as PostGIS LineStrings and served to the map as GeoJSON. KMZ routes are named `<site A name> - <site B name>`; the name is split on ` - ` and matched exactly to a segment by its two end sites. No match, or more than one, goes to the validation report. Several segments can share the same two end sites, so multiple matches are expected; to be checked against the mock files arriving 22 October 2026.

**E12. Typed API client.** `openapi-typescript` generates the frontend types from FastAPI's OpenAPI spec. Regenerate after every endpoint change.

**E13. Tests.** pytest for the reservation flow (request, approve, reject, release, correct), upload validation and the loss bands, against a real PostGIS container. Playwright for the port grid checks (status not by colour alone, keyboard operation, 4.5:1 contrast).

## 4. Technology Stack

| Layer | Choice |
| --- | --- |
| Frontend | React, TypeScript, Vite, Tailwind CSS, shadcn/ui, Recharts |
| API client | `openapi-typescript` generated from FastAPI's OpenAPI spec |
| Map | MapLibre GL JS, PMTiles (OpenStreetMap extract, zoom 14 cap), self-hosted glyphs and sprites |
| Backend | Python, FastAPI, Uvicorn, SQLAlchemy, Alembic, Pydantic |
| Ingest | pandas, openpyxl (Excel); zipfile and XML parsing (KMZ) |
| Routing | NetworkX |
| Scheduling | APScheduler, with a `job_runs` table and a PostgreSQL advisory lock |
| Auth | Local accounts, Argon2 password hashes, httpOnly session cookie |
| Database | PostgreSQL with PostGIS |
| Email | Company SMTP relay (access TBD) |
| Testing | pytest, Playwright |
| Deployment | Docker Compose on a company-managed server (host confirmed with IT before go-live) |

### Pinned versions (21 October 2026)

Latest stable at the time of pinning, per the data owner's "latest" rule. Source: registry lookups by a research subagent, not yet re-verified; Session 0 confirms each by actually installing.

| Item | Version |
| --- | --- |
| Python | 3.14.8 (3.15 skipped: 12 days old, FastAPI, Uvicorn, APScheduler, argon2-cffi and python-multipart do not list it yet) |
| Node.js (LTS) | 24.22.1 |
| PostgreSQL | 18.6 (19 is not GA) |
| PostGIS image | `postgis/postgis:18-3.6` pinned by digest in `docker-compose.yml`; PostGIS 3.6.4, GEOS 3.14.1 (checked 21 October 2026) |
| FastAPI / Uvicorn | 0.157.0 / 0.54.0 |
| SQLAlchemy / Alembic | 2.1.5 / 1.20.0 |
| Pydantic / psycopg | 2.14.1 / 3.3.6 |
| pandas / openpyxl | 3.0.6 / 3.1.5 |
| NetworkX / APScheduler | 3.7 / 3.11.3 |
| argon2-cffi / python-multipart | 25.1.0 / 0.0.32 |
| pytest / httpx | 9.1.1 / 0.28.1 |
| shapely (only if KMZ needs it) | 2.2.0 |
| React / React DOM | 19.3.1 |
| Vite | 8.3.5 |
| TypeScript | 6.0.3 (7.x skipped by decision: new native-port major, tooling support unproven) |
| Tailwind CSS | 4.3.3 |
| Recharts | 3.10.1 |
| maplibre-gl / pmtiles | 6.15.0 / 4.5.0 |
| openapi-typescript | 7.13.0 |
| Playwright | 1.64.1 |
| shadcn/ui | CLI, `npx shadcn@latest`, no pin |

## 5. Technical Value

**High.** Reservations move out of Excel into one attributable, append-only record, which the PRD's success criteria depend on (100% of reservations in the dashboard, 0 stale items older than 4 months). The event log, edit history and protected fields also make the dashboard safe to run as the source of truth while the Excel feed keeps arriving.

## 6. T-Shirt Size Estimate

**L.** Ten features on a small, well-known stack with modest data (about 100 points of interest, 50 users). The size is in the rules, not the scale: event-sourced reservations, two-phase upload with conflict handling, and the first use of PostGIS, MapLibre and PMTiles. For one person in about 11 days it is at the edge of feasible, so the PRD's cut order (email, then real KMZ map, then span and site editing) is part of the plan, not a fallback.

## Open decisions that affect the architecture

| Decision | Affects | Default until confirmed |
| --- | --- | --- |
| SMTP relay access | F10, E9 | Later, per data owner. In-app Needs review and bell count ship first |
| KMZ name matching when segments share end sites | E11 | Ambiguous names go to the validation report; check against the mock files |

Resolved by data owner: two sites never have more than one span, so a span is keyed by its site pair. Many cores per span is normal. KMZ names are `<site A name> - <site B name>`.
| Production web serving | E1 | Static build served by a small web server container; confirm with IT along with the host |
