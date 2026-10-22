# Fiber Dashboard PRD

Last updated: 22 October 2026

## 1. Executive Summary

The MVP gives planners one web dashboard to find free cores, reserve them, and check link loss, ready for use by 31 October 2026.

**Problem Statement:** Cable management, core reservations and dB loss are tracked from Excel exports of the source system. Planners cannot quickly see which cores are free, which reservations have gone stale, or where measured loss differs from calculated loss.

**Proposed Solution:** A web dashboard for up to 50 concurrent users. The main areas are fiber health (cores and ports, reservations, link loss) and route planning, where a planner finds a route and sends a Reserve cores request that an admin approves. Layout and navigation are left to design. Data is loaded from Excel and KMZ files by an admin.

**Success Criteria** (agreed targets):

| Measure | Target | How measured |
| --- | --- | --- |
| Find and reserve free cores | A planner submits a reservation request in 2 minutes or less | Timed test with 3 planners on mock data, then real data |
| No forgotten reservations | 100% of reservations older than 3 months appear in Needs review and trigger a daily reminder until kept or released | Automated test plus a count of stale items older than 4 months, target 0 |
| Measured loss coverage | At least 80% of spans have a measured reading | Share of spans with at least one measurement, shown in the dashboard |
| Reservations in one place | 100% of new reservations created in the dashboard after go-live. | Count of reservations recorded outside the dashboard, target 0 |

## 2. User Experience & Functionality

The MVP serves two personas through eight user stories; login and roles stays in the MVP, because approval, release and attribution need it.

**Design freedom**

- Page count, navigation, layout and the visual form of each feature are open. The UI is explored in design, not fixed here.
- The requirements below say what a user must be able to see and do, not how it looks.
- Fixed constraints: WCAG 2.1 AA, status and warning levels never shown by colour alone, light and dark themes, desktop first.
- Earlier preferences, not binding: a map-first route planning screen, a port grid for cores, top navigation, a list of spans for link loss.

**Terms**

- **Site:** the general term for any place a span ends: a site, a building in it or the equipment in that building, such as a data center or TOC. Some sites have latitude and longitude in the Excel.
- **Span:** a connection between two sites (site A and site B). The app gives every span its own ID. A span carries many cores, and each core in use can carry its own circuit.
- **Segment:** a named route made of several spans end to end, with buildings or nodes in between; each KMZ route shows one segment. A segment is a label for display and the line on the map. Routing runs over spans, not segments. Several segments may share the same two end sites.
- **Core:** one fibre core in a span's cable, connecting a port at site A to a port at site B. Its circuit ID, which comes from another system, is an optional field on the core.

Confirmed by the data owner (21 October 2026): two sites have at most one span; one span carries many cores.

To confirm against the mock files arriving 22 October 2026: KMZ routes are named `<site A> - <site B>`, but several segments can share the same two end sites, so a KMZ name may match more than one segment. Such routes go to the validation report.

**User Personas**

- **Planner:** finds free cores, requests reservations for customers, plans routes, and reviews stale reservations.
- **Admin:** one of several admins in a tightly monitored enterprise; approves, rejects and releases reservations, uploads and updates Excel and KMZ data, and manages access. Roles beyond planner and admin: TBD.

**User Stories and Acceptance Criteria**

1. As a planner, I want to search by customer, circuit, core or span and see its port grid, so that I find free cores without opening Excel.
   - Global search matches customer, span, circuit ID and core.
   - Spans are labelled by their two sites and show their free cores and status mix; planners can filter by region and route type.
   - Each core's status is visible at a glance, and status is never shown by colour alone (for example hatched for Reserved, crossed for Faulty, outlined for Available).
   - The core table shows customer, circuit ID (when available), planned date, and the ports at both ends.
2. As a planner, I want to request cores for a customer with a planned date, so that capacity is held once an admin approves it.
   - Reserve cores is available from a route option and from a span, in a side panel. Submitting it sends a request; nothing is reserved until an admin approves.
   - The customer is required. It is picked from a customer table; the Reserve form warns and blocks submission without a customer. Adding a new customer warns about similar existing names, and the admin sees a new-customer flag on the request.
   - Each reservation records the customer, planner, planned date, request date, and the admin who approved or rejected it.
   - Reservations are append-only: no editing in place. A change, approval or release is a new record, and earlier records stay as history.
   - The planner chooses cores manually, per span on the route (for example by selecting available cells in a port grid); in use, reserved and faulty cores cannot be selected, and a counter shows cores chosen against cores needed.
   - A new request holds its cores as Requested until an admin approves or rejects it; approval reserves them and rejection frees them.
   - Admins are notified of each new request in the app (header bell count) and by email; the email moves to v1.1 first if time runs short.
   - Only an admin can approve, reject or release a reservation.
   - A pending request with mistakes is rejected by the admin, with a reason, and the planner creates a new one.
   - An approved reservation can be corrected by an admin, only for customer and planned date. The correction needs a reason and is saved as a new 'corrected' event; it replaces what is shown, while the old values stay in history.
   - Cores are never corrected or swapped. Wrong cores mean release and a new request.
   - A route reservation is one request across all its spans, approved or rejected as a whole; a rejection needs a reason the planner can see.
   - If two planners select the same core, the first request submitted wins; the second planner sees which cores are taken and picks again.
   - An admin can submit a request too. A different admin approves it when more than one admin exists; with a single admin, that admin approves it. The history shows the approving admin's name in both cases.
   - Planners track their own requests in a reservations list, with Pending and Rejected filters.
   - Pending requests never expire; admins see them oldest first with their age, and the bell count shows how many are waiting.
   - A planner can withdraw their own pending request; the withdrawal is saved as a new record and the held cores are freed at once.
3. As a planner, I want stale reservations flagged and reminded, so that none is forgotten.
   - A reservation is stale 3 months after it was approved. An imported reservation with no reserved date starts at its import date, and the upload preview warns the admin. Keeping it restarts the 3-month clock, and each keep is saved as a new history record.
   - Stale reservations appear in a Needs review list and the header bell count; so do reservations hit by an upload conflict or a core marked Faulty.
   - The 3-month rule and "today" in the daily digest use the Asia/Kuala_Lumpur time zone.
   - The planner keeps a stale reservation or sends a release request; only an admin releases it. A release request appears in Approvals and the bell count, the cores stay Reserved until an admin releases them, and a declined release needs a reason the planner can see.
   - A release request chooses which spans (cores) of a route reservation to free; the rest stays reserved. Releasing all its cores ends the reservation.
   - Release is not deletion. It adds a 'released' event; the reservation, its cores and all events stay forever, and only the core's lock is freed. The event history is the log.
   - A daily email digest per planner repeats until each is kept or released; the digest moves to v1.1 first if time runs short, while the in-app list and bell count stay.
4. As a planner, I want to compare calculated and measured loss per span, so that I can find high-loss spans.
   - Calculated loss is distance x 0.3 dB per km in the MVP. The formula lives in backend code, so it can change later, for example to add splice and connector losses. Distance comes from the Excel, per span; a segment's distance is the sum of its spans. A span with no distance has no calculated loss and shows no distance, never 0 dB.
   - Every measurement is kept as history; the latest is shown. Measurements are stored per span. A segment shows how many of its spans are measured (x of y); how it summarises its spans' levels is left to design.
   - For each measured span, planners see calculated loss, measured loss and the deviation in percent from calculated, with a warning level: green 0 to 3%, amber 3 to 7%, red 7 to 10%, and anything above 10% red and marked off-scale. The form is open: a chart, a list of spans sorted with the highest warning first, or both. The user must be able to see every span in the list, none hidden or cut off.
   - Each warning level has a label or shape, so colour is never the only signal. Thresholds are fixed for now; editable thresholds: TBD.
   - Deviation = (measured - calculated) / calculated; a measured value below calculated counts as green.
   - The difference in dB and percent, last test date, and measured or calculated-only status are available per span. The source data has test method and field team, which the backend cleans; both are stored and shown per span.
5. As a planner, I want to pick two buildings and see route options, so that I can choose a route with enough free cores.
   - Routing runs over spans: sites are the graph nodes and spans are the edges, weighted by km. Segments stay as labels for display and as the KMZ line on the map.
   - Up to 10 options are shown, each with its spans in order as building A to building B, with each span's km and free cores, grouped under their segment label where there is one. Each option shows total km, estimated dB, and the fewest free cores on any span of the path.
   - Options can be sorted by shortest km (the default) or by most free cores: the fewest free cores on any span of the path, higher is better.
   - The user must be able to see every option returned (up to 10), none hidden or cut off. The visual form of the list is open for design.
   - From and To list all sites, so any site can route to any site, including starting or ending a route inside a segment.
   - A route's estimated loss is the sum of its spans.
   - Each option shows loss confidence, as measured spans out of spans on the path.
   - An option with fewer free cores than needed is flagged.
   - Invalid input clears the results and shows an inline error on the field.
6. As a planner, I want to see real routes on a map, so that I understand where spans run.
   - MapLibre GL JS shows KMZ routes, one segment per route, with Data center and TOC markers; clicking a segment shows its spans.
   - Basemap colours come from the UI colour palette in light and dark themes; the UI is built first and the map follows.
   - Site coordinates come from the Excel where available. Each KMZ route is matched to a segment by the site A and site B in its name (`<site A> - <site B>`); the exact format is confirmed against the mock files. Because several segments can share the same two end sites, a name may match more than one segment. Routes that cannot be matched, or match more than one segment, are listed in the validation report. A site without coordinates takes its position from the end of a KMZ route that touches it; with neither, it is listed but not drawn on the map.
7. As an admin, I want users to sign in with roles, so that reservations and uploads are attributable.
   - Roles: planner and admin. Sign-in starts with local accounts; enterprise SSO is a later option. Admins create accounts and reset passwords; there is no self-signup, and a password change is forced at first login. Accounts are deactivated, never deleted: history keeps the user's name, their pending requests stay in the admin queue, and their stale digests go to all admins.
   - Stays in the MVP, because admin-only approval and release need sign-in, and it is built right after the approval flow so it is never the story left for last.
   - Admins get admin functions (Approvals, Data upload, Users) that planners never see, and can use every planner function too; how they are reached is left to design.
8. As an admin, I want to upload Excel and KMZ files, so that data updates without a developer.
   - A separate admin area, outside the planner functions.
   - Python validates and cleans each file and reports rejected rows. Excel stays manually updated after go-live, so uploads repeat: a re-upload updates existing records and adds new ones without duplicates; spans are matched by their two sites, in either order (two sites have at most one span), segments by their two end sites, and ports by Port ID; a circuit ID in a row attaches to its core.
   - New measurements are appended to history, never overwritten. Reservations are imported from Excel only until go-live. The admin upload area has a one-time switch, "Close reservation import". Until it is closed, every upload imports its approved reservation rows whose cores are free; a row whose core is already held is skipped, so re-uploads never duplicate or change a reservation. Reservation rows appear as their own group in the preview, so the admin sees exactly which reservations will be imported before confirming. Closing needs a reason, is saved as a history record and cannot be reopened in the MVP. After it is closed, reservation rows in an uploaded Excel are ignored and listed as a warning in the preview, and new reservations are made only in the dashboard.
   - Every upload shows a validation report first; nothing is saved until the admin confirms.
   - The customer is required in the Excel too. A reservation row without a customer is Rejected in the preview and not imported; the admin fixes the Excel and uploads again, and the fixed row imports then.
   - A reservation row without a reserved date still imports, with the import date as the start of its stale clock and a warning in the preview.
   - A row with a region other than North, Central, South or East Coast is Rejected in the upload report.
   - Spans are grouped into segments as the Excel states; where it does not, by chaining site pairs from the segment's site A to its site B, and any chain with more than one possible path is flagged in the report.
   - Many rows with the same two sites are normal, because one cable has many cores. The validation report warns when the same Port ID appears twice or when a cable looks listed twice between the same two sites, and the admin decides what to keep before anything is saved.
   - After the first import, the dashboard database is the source of truth and the Excel is a feed. A field edited in the dashboard is protected: a later upload that differs shows as a conflict in the preview and keeps the dashboard value unless the admin ticks the Excel value.
   - The Admin area runs an upload in three steps: Upload, Preview and Confirm. The preview groups rows as New, Changed, Conflicts, Not in this file and Rejected, each with its warnings. Rows missing from a file are left untouched and listed as Not in this file.
   - An upload never changes a reservation. If an uploaded row conflicts with a Requested or Reserved core, for example the core is marked Faulty or no longer exists, the preview flags it and the reservation goes to Needs review.
   - Admins can edit data in the app, because the Excel is a feed and not the source of truth. The MVP covers core status (Faulty or Available only; In use comes from the Excel and Reserved from the reservation flow), span details (distance, route type, region, sites A and B) and site details (name, coordinates). Everything else is v1.1. Each edit needs a reason and is saved as a new history record; a changed distance recalculates loss, and marking a Requested or Reserved core Faulty sends its reservation to Needs review.
   - Each upload is logged with who, when and what changed.

**Non-Goals**

- Joint closures on the map.
- Real-time data; the source is exported files (updated manually by admins, also after go-live), some will be added manually to database.
- Editing reservations in place: overwriting a saved reservation's customer, date or cores. Changes are added as new records, so history stays complete.
- A loss budget.
- Free-text customer entry without the similar-name warning.

## 3. AI System Requirements

Not applicable: the MVP has no AI features. Route options come from graph search on the span network (NetworkX), so there are no AI tool requirements or output-quality evaluations.

## 4. Technical Specifications

The stack is one choice per layer, packaged with Docker Compose, with a Python API between the files and the database.

**Architecture Overview**

```text
 1. Files            Excel and KMZ files
                     (spans, cores, measurements, routes)
                            |
                            | upload
                            v
 2. Admin page       upload, validation report, admin confirms before saving
                            |
                            v
 3. FastAPI backend  validate and clean | KMZ conversion (one route per segment)
    (Python)         routing (NetworkX) | reservation rules (3-month stale
                     check, daily reminder job)
                            |
              +-------------+--------------+
              | read and write             | daily digest
              v                            v
 4. PostgreSQL + PostGIS       5. SMTP relay
    reservations, customers,      company-domain sender, access TBD
    measurements as history

 6. React app        planner and admin screens, MapLibre map (self-hosted
                     tiles); reads and writes through the FastAPI backend
```

How to read it:

1. An admin uploads Excel and KMZ files on the Admin page.
2. The FastAPI backend validates and cleans them, shows a report, and saves only after the admin confirms.
3. Routing, reservation rules and the daily reminder job all run in the same backend.
4. Data is stored in PostgreSQL with PostGIS, and measurements are kept as history.
5. The React app (planner and admin screens, and the map) reads and writes only through the backend.
6. The reminder job sends the stale-reservation digest through the SMTP relay.

Files enter through the Admin page, the Python API validates and stores them, and the app reads and writes everything through the same API.

**Stack**

| Layer | Choice |
| --- | --- |
| Frontend | React + TypeScript (Vite), Tailwind CSS, shadcn/ui, Recharts |
| Map | MapLibre GL JS with OpenStreetMap data, PMTiles extract capped at zoom 14, self-hosted glyphs, sprites and light and dark basemaps, no external map API |
| Backend | Python + FastAPI; also handles Excel and KMZ conversion and cleaning, routing with NetworkX, reservation rules and the daily reminder job |
| Database | PostgreSQL with PostGIS |
| Deployment | Docker Compose on a company-managed server; the exact host is confirmed with IT before go-live |

**Integration Points**

| Integration | Purpose | Status |
| --- | --- | --- |
| Excel exports from the source system | Sites (some with latitude and longitude), spans, segments, cores, ports, measurements; schema built from the column headers; after the first import a feed, not the source of truth | Real data not yet available |
| KMZ files | Route coordinates, one KMZ route per segment, matched to Excel; join key TBD | Tested with mock KMZ data; real files to come |
| SMTP relay | Daily stale-reservation email digest; email to admins on each new reservation request | Sender address must be registered under the company domain; access and registration TBD, and they decide whether email ships in the MVP |
| Daily scheduler | Digest and stale checks | In-app scheduler (APScheduler) inside the FastAPI container; it records its last run, so a restart never sends the digest twice |
| Authentication | Sign-in and roles | Local accounts first; enterprise SSO later |

**Data Model Foundation**

The planning side comes first: reservations, customers and planners as separate tables, with reservations as insert-only rows. Around it: sites (data centers and TOCs), spans with route type (Bespoke, Trunk, Metro) and region (North, Central, South, East Coast), segments (several spans end to end), cores, ports, and measurements kept as history. Site names are unique across all regions, and many sites can share a region. The four regions stay as they are; new values come by migration when real data shows them. Measurements also store test method and field team. Ports connect through cores to another site. The app assigns its own internal ID to every site, span and segment. A circuit ID comes from another system and is an optional field on the core, because one span carries many circuits; uploads match spans by the two sites, and ports by Port ID. Site is the general term for a site, a building or the equipment in it, and measurements are stored per span. After the first import the dashboard database is the source of truth and the Excel is a feed; fields edited in the dashboard are protected from later uploads, and every edit is kept as history with a reason.

**Non-Functional Requirements**

- Up to 50 concurrent users; potentially around 100 points of interest.
- Time zone: all date logic (the 3-month stale rule, the daily digest's "today") and date display use Asia/Kuala_Lumpur. Timestamps are stored in UTC (timestamptz).
- Light and dark themes; text contrast of at least 4.5:1 (WCAG 2.1 AA).
- Keyboard-operable navigation, controls and side panels. Automated tests cover the reservation flow (request, approve, reject, release, correct), upload validation and the loss bands; the UI also gets a manual check in light and dark themes.

**Security & Privacy**

- A tightly monitored enterprise with several admins: every upload, reservation request, approval, release and data edit is attributable to a user and kept as history.
- Customer names are business data; no data leaves the network, since tiles, fonts and sprites are self-hosted.
- Secrets such as database and SMTP credentials live in environment variables, never in the repository.
- Nothing is deleted in the MVP; all history is kept. Compliance requirements and retention rules are checked with IT later.

## 5. Risks & Roadmap

All five MVP items are planned for 31 October 2026, about 11 days from this draft, so the cut order matters more than the dates.

**Phased Rollout**

1. **MVP, by 31 October 2026:** fiber health (cores and ports, reservations and link loss) and route planning; the MapLibre map with KMZ routes; Reserve cores with admin approval; admin upload with a preview step; admin editing of core status, spans and sites; email digest; login and roles. If time runs short, the email digest moves to v1.1 first; the next cut is the real KMZ routes on the map, with the simple map as the fallback; after that, span and site editing moves to v1.1 and core status editing stays. Gate to ship: tested on real exported data.
2. **v1.1:** email digest and admin request emails if cut or the SMTP relay is not ready (the in-app Needs review list ships first either way); undo of a finished upload; a mini map in the upload step to compare a new KMZ route with existing routes (idea, to decide); verification of reservation data; editing of ports, customers and other data in the app; PMTiles zoom detail review.
3. **v2.0:** joint closures on the map; scheduled imports; production shipping model.

**Technical Risks**

| Risk | Impact | Mitigation |
| --- | --- | --- |
| Five features in about 11 days, built with AI assistance by one person | MVP slips | Fixed cut order, starting with the email digest; build the UI (inventory and reservations) first, then the map, admin upload and email |
| Login slips past the MVP | Reserved-by cannot be trusted; admin upload is open; admin-only approval and release cannot be enforced | Build minimal login right after the approval flow, with a dev-only header standing in for the user until then; if it still slips, protect the Admin page at network level and hold approvals until login lands |
| Real data not yet available; the schema comes from Excel headers and the port data in the mock is not real; Excel stays manually updated after go-live | Matching on site pairs and Port IDs, or loss calculations break on first or later uploads | Upload validation report; test with a real export as soon as one is available; an upload never overwrites reservations made in the dashboard |
| SMTP relay access unconfirmed; the sender address must be registered under the company domain | Email digest slips | In-app Needs review list, approval requests and bell count ship first |
| First use of PostGIS, MapLibre and PMTiles | Map work overruns | Time-box the map; fall back to the logical SVG map from the v6 mock |
| Work laptop installs need an admin password; Docker Desktop is present but WSL has no Linux distro | Setup delays | Group installs into ticket bundles by source (npm, PyPI, Docker, system installers) and use the existing Docker engine |
