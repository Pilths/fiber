# Plan: rename span to segment, and new branch model

Owner decisions, 1 November 2026. Work through the steps in order, one step per session if tokens are short.
Tick a step only after its test passes. Each session: read this file first, do the next unticked step, update it.

## Decisions

- A connection from one site to the next site is a **segment** (was "span").
- A named group of segments end to end (the KMZ line, today's `segments` table) is a **route** (was "segment").
- `spans.route` (text label such as R1) stays a text label on the segment.
- Excel column names (Link, Nodes, Core Secured and so on) do not change; the parser reads real files.
- The rename covers docs, UI words, code, API and database.
- The production database may be rebuilt: the owner is reworking the code, so no data needs to survive.
  Migrations are squashed into one fresh baseline with the new names instead of a rename migration.
- Old wording to remove from the docs while renaming: Inspector, Find card, Allocations, Reserve tab,
  per-span loss, "free to reserve", "cable size", "est. dB". Current layout: `docs/DESIGN.md`.

## Branch model

| Branch | Holds |
|---|---|
| `main` | The working website only, clean like the old `PD`: app code and what it needs to build and run. No `.md` docs, no tests, no dev packages, no mocks. |
| `dev` | Development and testing: everything in `main` plus docs, tests, dev tools. All work happens here and is copied to `main` when it is ready. |
| `pictures` | Mockups, screenshots and design files (today's `docs/mockups/`, FigCraft exports). |

Branches deleted (owner confirmed 1 Nov; remote deletes run by the owner): `PD`, `demo`, `ui-trim-notes`, `mock-route-view` (local, remote,
and the worktrees `/home/user1/project/fiber-pd` and `/home/user1/project/fiber-demo`).

## Steps

- [x] 1. Branches: commit current work on `dev`; create `pictures` (mockups and FigCraft files) and remove
      `docs/mockups/` from `dev`; delete `PD`, `demo`, `ui-trim-notes`, `mock-route-view` (local, remote,
      worktrees). Test: `git branch -a` shows only main, dev, pictures; `dev` still runs.
- [x] 1b. Trim dependencies on `dev`: remove unused pandas, numpy, APScheduler (api); remove lucide-react,
      shadcn, @base-ui/react, class-variance-authority, tw-animate-css and the `cn` package (web), replacing
      the one `Button` and `cn` with plain local code; move pytest and httpx into a dev-only requirements file.
      Test: `docker compose up -d --build`, `docker compose exec api pytest`, web lint, typecheck, e2e.
- [x] 1c. Rebuild `main` as the clean website from `dev`: only runtime files (as the old `PD` did), scripts and
      dev packages removed from `web/package.json`, runtime-only requirements, lockfiles regenerated.
      Test: on `main`, `docker compose up -d --build` starts db, api and web.
      Done 2 Nov: images build; api image has no pytest/httpx, web image no playwright/oxlint. Worktree
      `/home/user1/project/fiber-main` holds `main`; to update it, extract `git archive dev` there with the same
      excludes (CLAUDE.md, docs, api/tests, web/e2e, pytest.ini, requirements-dev.lock, certs/README.md,
      pyrightconfig.json, .oxlintrc.json, playwright.config.ts) and strip lint, gen:api, test:e2e and their packages.
- [ ] 2. Docs on `dev`: CLAUDE.md, PRD, DESIGN.md, architecture, workflow reworded (segment, route) and old
      wording removed. Test: `grep -rniw "span\|spans" CLAUDE.md docs/*.md` finds only intended uses.
- [ ] 3. Database: one fresh baseline migration with `segments` (was `spans`), `routes` (was `segments`),
      `route_segments` (was `segment_spans`), `segment_id` columns, views, indexes, constraint names, and
      data value 'segment' in `data_edits`. Test: empty database, `alembic upgrade head`, then
      `docker compose exec api pytest`.
- [ ] 4. Backend: models, SQL, schemas, routers (`/api/segments`), JSON keys (`segment_id`), seeds, tests.
      Test: `docker compose exec api pytest` all green.
- [ ] 5. Frontend: regenerate `web/src/api/schema.d.ts`, rename identifiers and labels ("Segment list
      upload"), URL hash `#segment=` (also accept old `#span=`). Do not touch HTML `<span>` tags.
      Test: `docker compose exec web npm run lint`, typecheck, `npm run test:e2e`.
- [ ] 6. Final sweep: grep for leftover "span" (skip `<span>`), full test run, copy app to `main`.

## Reminders for the website build

- Ask the owner for the calculated-loss formula (per core) before building loss UI.
- Keep the current `SpanDiagram` component's look (it will be renamed with the code).
