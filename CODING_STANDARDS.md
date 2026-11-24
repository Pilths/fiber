# Coding standards

Project decision: readable over short. The goal is code a teammate can debug at 5 pm without asking the author.
Applies to all new and changed code. Existing code is tidied in a cleanup session, not during feature work.
Reviewers (human or `/code-review`) check a diff against this file. Domain rules (what the app must do) are in the
"Domain rules" section of `CLAUDE.md`; this file is about how the code is written.

When rules pull against each other, this order wins: **correct > readable > fast**.

Paths: backend is `api/app/`, frontend is `web/src/`.

## Tooling first

Anything a tool can enforce lives in config, not in review comments. Reviewers skip what these already catch.

- Python: `ruff check` with `api/ruff.toml`: line length 120 (E501), no one-line `if` or `for` (E701), no
  statements joined with `;` (E702, E703), no `l`/`O`/`I` names (E741), no swallowed errors (BLE001, S110), no
  `print` in server code (T201; command-line scripts and tests are exempt). There is no auto-formatter.
- TypeScript: `npx tsc -b --noEmit` (TypeScript 6, strict by default, plus `noUnusedLocals` and
  `noUnusedParameters`). oxlint (`web/.oxlintrc.json`): `curly` (every `if` gets braces), `no-nested-ternary`,
  `no-unused-expressions` (catches `cond && doSomething()`), `react/rules-of-hooks`, `no-explicit-any`. There is no
  auto-formatter.
- The pre-commit hook (`.githooks/pre-commit`) runs ruff, oxlint and the typecheck, and refuses the commit if one
  fails. Turn it on once per clone with `git config core.hooksPath .githooks`. Don't skip it with `--no-verify`: fix
  the failure.
- A review finding that comes up twice becomes a lint rule (with any existing cases fixed), not another line in
  this file. When a tool check and a paragraph here disagree, the tool wins and the paragraph is fixed.

## Names and words

- Use the domain words from the "Domain rules" section of `CLAUDE.md` exactly (`GLOSSARY.md` at the repo root
  holds the full list; if the two disagree, fix both): `site`, `segment`, `core`, `port`, `reservation`, `planner`, `customer`,
  `route`. One word per idea. If the team renames a term, rename it everywhere in one commit.
- A `building` is a kind of site (`sites.kind`, `api/app/models.py:76`), never another word for site.
- Known word clashes to avoid spreading:
  - `remarks` is the user's note everywhere; the old `reservations.remark` column (`api/app/models.py:197`) is the
    one exception. Don't copy its name.
  - "Core verification" in UI, docs and messages; `survey_cores` stays only as the DB column and API field.
  - `route_type` is the name of the derived Trunk / Metro / DC-DC / DC-TOC value (computed in
    `api/app/link_type.py`). Don't call it link type in new code.
  - "Needs review" means an upload row status (`needs_review`). The reservation alert list (`web/src/components/reservations/NeedsReview.tsx`:
    stale, release requested, fiber cut) is a different thing; name new code for it "alerts", not needs review.
- Full, plain names: `planner`, `option`, `segment`, `site`, not `rp`, `op`, `s`, `g`, `x`. Short names only for
  loop counters (`i`) and tiny arrow functions over one item.
- Put the unit in the name when a number has one: `distance_km`, `loss_db`, `measured_loss_db`. Most fibre bugs
  are unit bugs.
- New booleans read as a yes/no question: `is_stale`, `has_reading`, `canApprove`. Existing DB columns
  (`imported`, `additional`, `cut`) keep their names.

## Style

- One step per line. No several statements joined with `;`.
- If/else is never on one line; the body goes indented below, also for a single statement.
- No `cond && doSomething()` for actions in TypeScript; write an `if`. `cond && <Element />` in JSX is fine.
- Ternaries only for a simple value choice (`x ? "on" : "off"`). Never nested, never for actions.
- Functions have one job and a name that says it. Rough signal to split: over ~40 lines, or the name needs "and"
  to describe it. Split into private helpers inside the same module; don't create a new module or file just to
  hold one small function (that makes shallow modules, see Architecture).
- A React component over ~150 lines, or one that both fetches data and lays out the page, is split. Its state and
  handlers go in a hook in `web/src/lib/` (`useReserveBox.ts`, `useInventory.ts` are the pattern).
- Comments say why, not what. If code needs a comment to explain a trick, rewrite it plainly.

## Business rules live in one place

The rules below are the ones most likely to be wrong and hardest to spot. Each lives in one named constant,
function or view, never retyped inline. Duplicating one even once is a finding.

| Rule | Its one home |
|---|---|
| Calculated loss: 0.25 dB/km + 0.1 dB per splice (one per 4 km) + 0.5 dB x 2 connectors, 2 decimals | `calculated_loss_db()` and its constants, `api/app/loss/service.py` |
| Deviation of measured from calculated loss | `deviation_pct()`, `api/app/loss/service.py` |
| Loss levels: green up to 3%, amber to 7%, red to 10%, off-scale above; edges go to the lower level | `warning_level()`, `api/app/loss/service.py`. The UI shows the API's `level` (`web/src/lib/lossLevel.tsx`) and never redoes the math |
| Stale: approved, no approval or keep for over 3 months, no release waiting | `is_stale` in the `reservation_state_v` view (`api/alembic/versions/0001_baseline.py:314`). Code reads `is_stale`; it never recomputes the 3 months. Changing the period needs a new migration that redefines the view, plus the four texts that say "3 months": `api/app/reservations/service.py:376`, `web/src/components/CoresTable.tsx:76`, `web/src/components/reservations/ReservationCard.tsx:125`, `web/src/components/reservations/Approvals.tsx:122` |
| Reservation status | Derived from the latest event in `reservation_state_v`. Never stored, never written |
| Route type from the two end sites' kinds | `api/app/link_type.py` |
| Port label shapes | `api/app/port_label.py`, mirrored in `web/src/lib/portLabel.ts` |
| Time zone `Asia/Kuala_Lumpur` | One constant per side: `TZ` in `api/app/reservations/service.py` (also imported by `api/app/inventory/service.py`), `TIME_ZONE` in `web/src/lib/format.ts`. `TZ` holds the quoted SQL literal, so it goes straight into an f-string. New SQL uses the constant, not the literal. Inline copies today: `api/app/loss/service.py:55,61,65,94`, `api/app/admin_edits/measurements.py:22`, `api/app/seed_dev_loss.py:22`. Moving `TZ` to a shared module such as `api/app/db.py` is the cleanup |

- Reservation events are insert-only. The event types are `requested`, `approved`, `rejected`, `withdrawn`,
  `kept`, `release_requested`, `released`, `release_declined`, `corrected`, `assigned`. No `UPDATE` or `DELETE` on
  reservations or their events. A correction is a `corrected` event; the original stays.
- Every event goes through `_event()` in `api/app/reservations/service.py`, after `_require()` checks the move and
  `_own_or_admin()` checks who may make it. (`api/app/ingest/reservation_import.py` still inserts its own events;
  see Target structure.)
- Use `Decimal` with `ROUND_HALF_UP` for dB math, not floats. `float` is allowed only when serialising to JSON
  (`api/app/loss/schemas.py:10-11`).

## Errors and debugging

- Never swallow an error. No bare `except:` or `except Exception: pass`; no `.catch(() => {})` or empty
  `catch {}` in TypeScript. If an error really can be ignored, say why in a comment on that line.
- One exception: upload parsing catches the error of a single row, records it as that row's reason, and moves on
  (`api/app/ingest/excel.py:131`, `api/app/ingest/segment_list.py:172`, `api/app/ingest/site_master/parse.py:119`).
  Mark it with `# noqa: BLE001` and a short why.
- Lint enforces this: ruff `BLE001`, `S110` in the API, `no-empty`, `no-empty-function` in the web app. A best-effort call
  whose failure the user does not need to see (refresh, clipboard) uses `.catch(ignoreFailure)` from
  `web/src/lib/utils.ts`.
- Fail loudly at the edge: check input where it enters (FastAPI request models in Pydantic, Excel and KMZ rows at
  import). Inside the app, trust the data.
- Error messages say what was expected and what was found: `"Segment KLCC-PJYA: expected 24 verified cores,
  found 0"`, not `"Invalid data"`. When the reader can act on it (upload row reasons, admin errors, script
  output), end with the fix: `"... found 0. Fix: enter a verified core count in Edit segment"`. New and changed
  messages only.
- Uploads are layered, never all-or-nothing: every row is kept raw in staging with sheet and row number, and gets
  a status Ready, Needs review or Rejected with a reason. A bad row never blocks the good ones. Never guess a value
  to make a row pass.
- The server logs with `logging`, not `print`. Include the IDs needed to find the record (segment, core,
  reservation, user). Never log passwords or tokens. Command-line scripts (`app.load_*`, `app.seed_*`,
  `app.create_admin`) may `print` their output.
- No silent fallbacks. If a value is missing, show it as missing ("Not tested", "core not recorded") rather than
  defaulting to 0 dB.

## Data and database

- SQL lives in module constants named `*_SQL` near the top of the module (for example `LOCK_RESERVATION_SQL` in
  `api/app/reservations/service.py`), or in small named functions, not inline in the logic.
- Values always go in as bound parameters (`:name`). Never put a value into SQL with an f-string or `+`. An
  f-string may only insert an identifier or a condition chosen from a fixed list in the same module (as in
  `api/app/ingest/segment_list.py:60`).
- Let the database guard the data: `NOT NULL`, foreign keys, `CHECK` and unique constraints first; Python checks
  second.
- Reserve, approve and release run in one transaction. They call `set_lock_timeout(db)` (`api/app/db.py`), lock the
  segments involved in id order (`LOCK_SEGMENTS_SQL ... ORDER BY id FOR UPDATE`, so two requests can't deadlock),
  and rely on the `core_holds` primary key so two planners can't hold the same core. Keep that order in new code.
- Timestamps are `timestamptz` stored in UTC. Date rules (stale, daily digest, "today") and date display use
  `Asia/Kuala_Lumpur`, in SQL or in `web/src/lib/format.ts`.
- Schema changes go through an Alembic migration in `api/alembic/versions/`, never by hand in `psql`.

## Frontend data

- API response types come from `web/src/api/schema.d.ts`, generated by `npm run gen:api`. Never edit it by hand;
  regenerate it after an API change. No `any`.
- API calls go through the `api` helpers in `web/src/api/client.ts`, never plain `fetch`. Static map files
  (PMTiles, glyphs in `web/src/lib/basemap.ts`) may use `fetch`.
- Every view that loads data handles three states on purpose: loading, empty, error.

## Architecture

Vocabulary matches the `/codebase-design` skill: **module**, **interface**, **depth**, **seam**, **adapter**,
**locality**, **leverage**. Decisions that should not be re-argued live in `docs/adr/` once it exists.

- **Deep modules.** A module hides a lot of behaviour behind a small interface. A caller reserving cores calls one
  function; it does not need to know about locking, status checks or event rows. If a module's interface is
  nearly as big as its body, it is shallow: merge it into its caller or into a neighbour.
- **Organise by domain, not by layer.** Backend already does this: `api/app/<feature>/` (`reservations/`,
  `inventory/`, `loss/`, `routing/`, `map/`, `ingest/`, `admin_edits/`, `auth/`), each with its `router.py`,
  `service.py` and `schemas.py`. New backend code goes into the feature folder it belongs to.
- **Dependencies point one way.** Router calls service; service runs SQL. Services never import routers; the
  frontend never knows table names.
- **Routes stay thin.** A FastAPI route parses input, calls one service function, returns the result. No SQL or
  business rules in routes or React components.
- **Seams only where needed.** One adapter means the seam is hypothetical: don't add it. Add a seam (for example
  for email sending, so tests can swap in a fake) once there are two real adapters.
- **Test through the interface.** Tests call the module's public functions or the HTTP API, not its private
  helpers. If a rule can only be tested by reaching inside, the interface is wrong.
- **Plain over clever.** Plain functions and plain data (dicts, lists, dataclasses, TypeScript types). No classes,
  factories or wrappers unless they make the calling code shorter and easier to read today.
- **Structural changes are welcome** when they make the code simpler to work in. Explain in one line what gets
  simpler, and record it as an ADR if it's hard to reverse and a future reader would ask why.
- Keep `docs/architecture.md` in step with the code: update it in the same change that alters a module's
  interface.

## Target structure (not followed yet)

These are the agreed direction. Existing code does not follow them yet, so a reviewer does **not** flag old files
for them. New code moves toward them where it is cheap; the big moves go through
`/mattpocock-skills:improve-codebase-architecture` as their own tickets.

| Target | Today |
|---|---|
| Frontend by feature: `web/src/features/<feature>/` with its API calls, hooks and components | Flat `web/src/components/` and `web/src/lib/` (~50 files) |
| One entry file per feature; other features import only from it (`__init__.py`, `index.ts`) | `__init__.py` files are empty; about 99 imports reach inner files |
| A feature's API calls in one file; components don't call `api.*` directly | 14 component files call `api.*` (for example `GlobalSearch.tsx:41`) |
| No component over ~150 lines | 13 are over, largest `ReservationUpload.tsx` (479) |
| No SQL in routers | `auth/router.py:110-155` (login, logout, password change; about 8 queries), `ingest/site_master_router.py:151` (the `/current` list) |
| One reservation event writer | `ingest/reservation_import.py:90` inserts events itself |

## Tests (light, on the rules that matter)

Not everything needs a test. These do, because a mistake here gives planners a wrong answer:

- Calculated loss, deviation and level choice, including the edges (exactly 3%, exactly 7%, measured below
  calculated). Home: `api/tests/test_loss.py`.
- Stale reservation date math, including "keep restarts the clock". Home: `api/tests/test_reservations.py`.
- Reservation moves: allowed moves pass, forbidden ones get 409, and only admins can approve or release. Two
  planners racing for one core: `api/tests/test_reservation_races.py`.
- Excel and KMZ upload: one good file, one file with a bad row that shows as Needs review or Rejected.

A bug fix adds a test that fails before the fix.

## Overrides for the code-review smell baseline

The `/code-review` skill carries a list of Fowler smells. Where this file disagrees, this file wins.

| Smell | Rule here |
|---|---|
| Primitive Obsession | Off. Strings, numbers and plain dicts are the default. Do not suggest wrapper types. |
| Data Clumps | Flag only when the same group of values is passed through 3 or more functions. A small `TypedDict` or dataclass is then enough. Known candidate: `site_a` + `site_b` identifying a segment. |
| Duplicated Code | Flag only code that is truly the same, not code that merely looks alike. Two similar blocks are fine; extract on the third. Business rules are the exception: duplicated even once is a finding. |
| Repeated Switches | Fix with one shared lookup (a dict or map) both places use. Never suggest polymorphism or class hierarchies. |
| Feature Envy, Message Chains, Middle Man, Refused Bequest | Judgement call only. Do not suggest new classes to fix them. |
| Speculative Generality | On, and strict: unused parameters, options, hooks or layers are a finding. |
| Mysterious Name, Shotgun Surgery, Divergent Change | On, as in the baseline. |

## Algorithm and query checks

Every review looks for these. Name the cost in plain words or Big-O (n = segments, cores, sites, reservations,
upload rows).

- **Big-O of loops.** A loop inside a loop over the same data is O(n²). Fine for a small fixed list (route types,
  regions, a site's ports); a finding for data that grows (segments, cores, reservations, upload rows). Fix with a
  dict lookup built once.
- **Repeated scans.** Searching the same list again and again (`x in some_list`, `.find()`, `.filter()` inside a
  loop) is a finding. Build a `set`/`dict` (Python) or `Set`/`Map` (TypeScript) once.
- **N+1 queries.** A database query inside a loop over rows is a finding. Fetch all needed rows in one query
  (`WHERE id = ANY(...)`, a join, or a grouped query) and match them in Python.
- **Work done twice.** The same value computed twice in one request or render (same query, same derived list) is a
  finding. Compute once and pass it on. In React, use `useMemo` only when the work is over a growing list.
- **Let the database do set work.** Counting, summing, filtering and sorting large sets belongs in SQL, not in
  Python after loading every row. Map geometry work belongs in PostGIS.
- **Mark known limits.** A deliberate simple choice with a known ceiling (an O(n²) scan over a list that stays
  small) gets a short comment naming the limit and when to change it.
