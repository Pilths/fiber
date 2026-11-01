# Demo branch

Frozen, tested copy of `main` (commit 9d028f6) plus this folder. Mock data only (invented DEV sites, customers and measurements).

## Set up (once, with internet, the day before)

```bash
cp .env.example .env          # skip if .env exists
./scripts/get-tiles.sh        # map files; behind the proxy put corporate-ca.crt in certs/ first
docker compose up -d --build
./demo/setup_demo_db.sh       # builds a separate, seeded database called fiber_demo
```

Then in `.env` change the end of `DATABASE_URL` from `/fiber` to `/fiber_demo` and run `docker compose up -d api`.
To go back to your normal data, change it back. The other database is never touched.

Open http://localhost:5173. Accounts: `planner1`, `planner2`, `admin1`, `admin2`; the password is `DEV_PASSWORD` in `.env` (default `dev-password-123`).

## Fake Excel files for the upload demo

```bash
docker compose cp demo/make_fake_excel.py api:/tmp/make_fake.py
docker compose exec api python /tmp/make_fake.py
docker compose cp api:/tmp/fake ./Sample          # Sample/ is git-ignored
```

Files: `fake-site-master-1.xlsx`, `fake-site-master-2.xlsx`, `fake-reservations.xlsx`, `fake-reservations-title-row.xlsx`.
Order: site master 1 (apply Site Location, then DC List), then reservations, then site master 2 (changed, missing, rename).
The old dev sites are not in these files: tick Override and enter any reason, or tick "Add and update only".

## Suggested walk-through (10 minutes)

1. **Map**: spans as lines (one shaped route), chips show free cores; click a span or a site; Find filters (Region, Route type).
2. **Span**: free to reserve (Healthy / Low / Full), Loss line, Taken cores table, core grid.
3. **Reserve**: choose Available cores, customer, planned date, Reserve; then the admin Approvals tab (red count circle).
4. **Route A to B**: pick two sites, see up to 3 options, reserve along a route.
5. **Admin**: edit a span or site with a reason; add ports to a core; assign cores to an Unassigned reservation.
6. **Uploads**: Site master (separate Apply per sheet, add-only mode), Reservation workbook (count-only, ports stay "-").
7. **My reservations**: Stale after 3 months, Keep or Release.

## Known limits (say them first if asked)

- Not in this branch: Span list upload (links list), KMZ route shapes (only one mock shaped route), email reminders.
- Excel imports reservations as count-only; ports and core numbers are added by hand.
- Map labels and fonts need `get-tiles.sh`; without it the map shows a plain background with a note.
