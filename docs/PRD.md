# Fiber Dashboard PRD

Last updated: 26 October 2026

## 1. Executive Summary

The MVP gives planners one web dashboard to find free cores, reserve them, and check link loss, ready for use by 31 October 2026.

**Problem Statement:** Cable management, core reservations and dB loss are tracked from Excel exports of the source system. Planners cannot quickly see which cores are free, which reservations have gone stale, or where measured loss differs from calculated loss.

**Proposed Solution:** A web dashboard for up to 50 concurrent users. The main areas are fiber health (cores and ports, reservations, link loss) and route planning, where a planner finds a route and sends a Reserve cores request that an admin approves. One map page is the home and holds the whole span and route workflow (see Design decisions). Data is loaded from Excel files by an admin (the Reservation workbook and the site master workbook, uploaded separately); real KMZ import is later.

**Success Criteria** (agreed targets):

| Measure | Target | How measured |
| --- | --- | --- |
| Find and reserve free cores | A planner submits a reservation request in 2 minutes or less | Timed test with 3 planners on mock data, then real data |
| No forgotten reservations | 100% of reservations older than 3 months appear in the Action needed list (tagged Stale) and trigger a daily reminder until kept or released | Automated test plus a count of stale items older than 4 months, target 0 |
| Measured loss coverage | At least 80% of spans have a measured reading | Share of spans with at least one measurement, shown in the dashboard |
| Reservations in one place | 100% of new reservations created in the dashboard after go-live. | Count of reservations recorded outside the dashboard, target 0 |

## 2. User Experience & Functionality

The MVP serves two personas through eight user stories; login and roles stays in the MVP, because approval, release and attribution need it.

**Design decisions** (owner, 26 October 2026; mocks in `docs/mockups/comparison/`)

- Desktop only (office computers). Minimum width 1200px; checked at 1280, 1440 and 1920. No mobile or tablet layouts.
- Simplicity first, then visibility. Reference mocks: `map/index.html` (the chosen page), `v4/index.html` (style source), `route/index.html` (route planning ribbon). Rejected: the Impeccable theme (navy and teal), decorative tube ring icons, and a span list in the left navigation.
- Fixed constraints: WCAG 2.1 AA, status and warning levels never shown by colour alone, light theme only (dark theme is Later / parked), text at least 11px, text contrast at least 4.5:1, non-text contrast at least 3:1.
- **One main page.** The map page is the home and holds the whole span workflow. The old Spans and Routes pages are merged into it. No left sidebar. The top bar has: logo mark top left ("Fiber / Malaysia network"); tabs Map, My reservations, Approvals (admin only, amber waiting count) and Upload (admin only); global search ("Find a span, site, customer, circuit or core"); and the account (avatar, name, role, menu) top right. The account menu has Sign out, and for admins a "Users" item that opens the users screen (admin only).
- **Map page layout.** Top row: map card (left, about 8 of 12 columns) and a right column with a Find card and an Inspector card. The Find card has a toggle "Span or site" | "Route A to B" and the filters Region and Route type, with "n of N spans". The Inspector has tabs per object type: Cores (live), and Site and Services (shown disabled with a "Later" tag; placeholders for DC internals and bandwidth). The map has a Layers control: Dark fibre (the only enabled layer), Services and Data centres (disabled, "Later").
- **Section under the top row** follows the selection, full width:
  - Span selected: "Cores of <span>" with the cores grid (12 per row, plain-text tube labels), a legend with counts, the "N not surveyed" note, and a chosen bar (chosen-core chips, Clear, Customer, Planned date, Reserve). The chosen bar stays pinned to the viewport bottom while the grid is in view. Below it, the "Held on this span" table with status filter chips and counts, expandable grouped rows, count-only rows, and a "Stale" tag for reservations past the stale rule. After the held table comes a short "Loss" block for the span (calculated and measured loss where available). Exact placement is decided in the mock.
  - Route selected: the 2D route ribbon with a loss line or column under it (loss per span, plus the route total), a per-span table and "Reserve on this route". Exact placement of the loss line is decided in the mock.
  - A "Collapse map" control shrinks the map to a strip.
- **Shareable selection.** The selection is written to the URL hash (`#span=AABB-BBCC`, `#route=AABB-DDEE`).
- **Works without the map.** Everything must work if the map or tiles fail: search and lists reach every span and route.
- **Map drawing (MVP)** is a schematic of straight span lines over the self-hosted basemap. KMZ shapes are not in the MVP; one mock route with a drawn shape (two spans between three sites) proves the line-shape path end to end. A data center is a square and any other site a diamond. Line weight shows route type: trunk thick, metro thin, bespoke dashed. Each span carries a free-cores chip with a symbol: check for 10 or more, triangle for 1 to 9, cross with "0 full", dash for "not surveyed".
- **2D route ribbon:** sites left to right as nodes, spans as links with name, km, a free-cores badge and a small bar. The bottleneck (lowest free) is marked with a triangle and the word. A span with fewer free cores than needed is red cross-hatched with a cross and the word "short", and Reserve is disabled with a sentence naming the short span. Long routes wrap to more rows with a "cont." marker. A hidden text list gives the route for screen readers, and arrow keys move between spans.
- **Style tokens (from v4):** fonts Geist (UI) and Geist Mono (circuit IDs only), self-hosted like all assets; ground #f2f4f7; white cards with a 1px border #e2e5ea, radius 8px, no shadows, 16px gutters, 20px padding, even card heights; tabular numerals everywhere; type scale: span title 32px/700 on the detail, metric numbers 40px/700, section titles 16px/600, labels 12px/500. Colour only where it carries meaning: blue #1d5fbf (primary, info, Chosen); green #1a7f4b (healthy, free to reserve 10 or more); amber #b45309 on #fff7ed (warnings, Requested, low 1 to 9 free, stale, near-name customer warning); red #b42318 on #fef3f2 (faulty, short, zero free, errors); slate (neutral, in use); dark ink (Reserved). Status is never colour alone: symbol, pattern and word.
- **Features taken from the v6 mock for the MVP** (the mock itself is not built): global search across customer, circuit, core and span; My reservations list with chips All, Stale and Planned in 30 days, and age in days; a Action needed count badge; core detail with history, Keep and Release (needs a reservation history endpoint, TASK-077); core status filter chips with counts; ports at both ends in the held table (the Excel's real paired ports, never assumed to be the same port at both ends); region and route type filters; keyboard support.
- Out or later: link loss tab in the Inspector (loss is shown in the bottom section instead, see story 4), dark theme, per-span core override on route reservations.
- UI and design work is done by Opus 5.5 or Fable subagents (see `CLAUDE.md`).

**Terms**

- **Site:** the general term for any place a span ends: a site, a building in it or the equipment in that building, such as a data center or TOC. Every site has latitude and longitude in the Excel. One site is one place with one 4-letter LRD code. A data center (DC) is a site of kind 'data_center' that is linked to its LRD site row from the site list, not a separate place; the map shows the linked site as a data center.
- **Nodes:** an Excel column name only, used by the parser. It is not a domain or database term, because it means different things to different people. Its value is a site pair `LRD-LRD` and becomes a span.
- **Span:** a connection between two sites (site A and site B). The app gives every span its own ID. A span carries many cores, and each core in use can carry its own circuit.
- **Segment:** a named route made of several spans end to end, with sites in between; each KMZ route shows one segment. A segment is a label for display and the line on the map. Routing runs over spans, not segments. Several segments may share the same two end sites.
- **Core:** one fibre core in a span's cable, connecting a port at site A to a port at site B. Its circuit ID, which comes from another system, is an optional field on the core.

Confirmed by the data owner (21 October 2026): two sites have at most one span; one span carries many cores.

To confirm against the mock files arriving 22 October 2026: KMZ routes are named `<site A> - <site B>`, but several segments can share the same two end sites, so a KMZ name may match more than one segment. Such routes go to the validation report.

**User Personas**

- **Planner:** finds free cores, requests reservations for customers, plans routes, and reviews stale reservations.
- **Admin:** one of several admins in a tightly monitored enterprise; approves, rejects and releases reservations, uploads and updates Excel data (KMZ later), and manages access. Roles beyond planner and admin: TBD.

**User Stories and Acceptance Criteria**

1. As a planner, I want to search by customer, circuit, core or span and see its port grid, so that I find free cores without opening Excel.
   - Global search matches customer, span, circuit ID and core.
   - Spans are labelled by their two sites and show their free cores and status mix; planners can filter by region and route type.
   - Each core's status is visible at a glance, and status is never shown by colour alone (for example hatched for Reserved, crossed for Faulty, outlined for Available).
   - The core table shows customer, circuit ID (when available), planned date, and the ports at both ends.
   - Only surveyed cores are shown. A cable is usually 144 cores, but the data knows only the cores found at the onsite survey (Excel "Core Secured", stored as `spans.survey_cores`). A span gets one core cell per surveyed core, numbered 1 to the survey count. Cores with known port ranges show their port labels; the others have blank ports until known. The cable size (`spans.cable_size`, default 144, admin-editable) is info only and never shown as cells. The span shows a line "N cores not surveyed" for the rest.
   - A span with no survey count is "not surveyed" and cannot be booked until an admin enters a count (a span edit with a reason). When the admin raises the count, more cells appear; nothing is rebuilt.
   - The cores grid shows 12 cells per row (one tube per row) with plain-text tube labels, a legend with counts, and core status filter chips with counts.
   - A span also shows "+N reserved, not assigned" for count-only reservations (see story 2) and a "free to reserve" figure, which is Available cells minus the remaining unassigned cores of active reservations on that span.
2. As a planner, I want to request cores for a customer with a planned date, so that capacity is held once an admin approves it.
   - Reserve cores is available on a span (the chosen bar under the cores grid: chosen cores, Customer, Planned date, Reserve) and on a route ("Reserve on this route"). Submitting it sends a request; nothing is reserved until an admin approves.
   - The customer is required. It is picked from a customer table; the Reserve form warns and blocks submission without a customer. Adding a new customer warns about similar existing names, and the admin sees a new-customer flag on the request.
   - Each reservation records the customer, planner, planned date, request date, and the admin who approved or rejected it.
   - Reservations are append-only: no editing in place. A change, approval or release is a new record, and earlier records stay as history.
   - On a span, the planner chooses cores manually by selecting available cells in the cores grid; in use, reserved and faulty cores cannot be selected, and the chosen bar shows the chosen cores.
   - On a route, the planner enters the cores needed per span, and the reservation takes that many on every span, assigned from the first free cores on each span by default. Changing the cores per span (a per-span override) is Later / parked. If any span has fewer free cores than needed, Reserve is disabled with a sentence naming the short span.
   - Nobody, planner or admin, can book more cores on a span than its free to reserve figure; the API answers 409.
   - A count-only reservation holds a number of cores on a span without naming them (`unassigned_cores = N`). It comes from the Excel import (a core count and no Core assignment). It marks no cell, but it lowers free to reserve. An admin later assigns specific cores with the `assign` action (admin only), which adds cores and holds and saves an 'assigned' event. The remaining unassigned count is `unassigned_cores` minus the cores added by 'assigned' events, derived because reservations are insert-only. Assign only adds cores to an unassigned count, so cores are still never corrected or swapped. Releasing a count-only reservation releases its remaining unassigned count with it.
   - A new request holds its cores as Requested until an admin approves or rejects it; approval reserves them and rejection frees them.
   - Admins are notified of each new request in the app (the amber waiting count on the Approvals tab) and by email; the email moves to v1.1 first if time runs short.
   - Only an admin can approve, reject or release a reservation.
   - A pending request with mistakes is rejected by the admin, with a reason, and the planner creates a new one.
   - An approved reservation can be corrected by an admin, only for customer and planned date. The correction needs a reason and is saved as a new 'corrected' event; it replaces what is shown, while the old values stay in history.
   - Cores are never corrected or swapped. Wrong cores mean release and a new request.
   - A route reservation is one request across all its spans, approved or rejected as a whole; a rejection needs a reason the planner can see.
   - If two planners select the same core, the first request submitted wins; the second planner sees which cores are taken and picks again.
   - An admin can submit a request too. A different admin approves it when more than one admin exists; with a single admin, that admin approves it. The history shows the approving admin's name in both cases.
   - Planners track their own requests in the My reservations list, with chips All, Stale and Planned in 30 days (and Pending and Rejected), the age in days, and an Action needed count badge. A core's detail shows its reservation history, with Keep and Release (this needs a reservation history endpoint, TASK-077).
   - Pending requests never expire; admins see them oldest first with their age, and the Approvals tab shows how many are waiting.
   - A planner can withdraw their own pending request; the withdrawal is saved as a new record and the held cores are freed at once.
3. As a planner, I want stale reservations flagged and reminded, so that none is forgotten.
   - A reservation is stale 3 months after it was approved. An imported reservation with no reserved date starts at its import date, and the upload preview warns the admin. Keeping it restarts the 3-month clock, and each keep is saved as a new history record.
   - Stale reservations appear in the Stale chip and the Action needed count badge on My reservations; so do reservations hit by an upload conflict or a core marked Faulty.
   - The 3-month rule and "today" in the daily digest use the Asia/Kuala_Lumpur time zone.
   - The planner keeps a stale reservation or sends a release request; only an admin releases it. A release request appears in Approvals and its waiting count, the cores stay Reserved until an admin releases them, and a declined release needs a reason the planner can see.
   - A release request chooses which spans (cores) of a route reservation to free; the rest stays reserved. Releasing all its cores ends the reservation.
   - Release is not deletion. It adds a 'released' event; the reservation, its cores and all events stay forever, and only the core's lock is freed. The event history is the log.
   - A daily email digest per planner repeats until each is kept or released; the digest moves to v1.1 first if time runs short, while the in-app list and count badges stay.
   - The held table on a span tags reservations past the stale rule above as "Stale".
4. As a planner, I want to compare calculated and measured loss per span, so that I can find high-loss spans.
   - Calculated loss is distance x 0.3 dB per km in the MVP. The formula lives in backend code, so it can change later, for example to add splice and connector losses. Distance comes from the Excel, per span; a segment's distance is the sum of its spans. A span with no distance has no calculated loss and shows no distance, never 0 dB.
   - Every measurement is kept as history; the latest is shown. Measurements are stored per span. A segment shows how many of its spans are measured (x of y); how it summarises its spans' levels is left to design.
   - For each measured span, planners see calculated loss, measured loss and the deviation in percent from calculated, with a warning level: green 0 to 3%, amber 3 to 7%, red 7 to 10%, and anything above 10% red and marked off-scale. The form is open: a chart, a list of spans sorted with the highest warning first, or both. The user must be able to see every span in the list, none hidden or cut off.
   - The MVP has no link loss tab in the map page Inspector (Later). Loss is shown in the bottom section of the map page. For a route, a loss line or column sits under the route ribbon: loss per span, plus the route total. For a single span, a short "Loss" block sits below the cores section, after the held table, with calculated and measured loss where available. Exact placement is decided in the mock. The requirements above still hold, and story 4 stays in the MVP in this form.
   - Each warning level has a label or shape, so colour is never the only signal. Thresholds are fixed for now; editable thresholds: TBD.
   - Deviation = (measured - calculated) / calculated; a measured value below calculated counts as green.
   - The difference in dB and percent, last test date, and measured or calculated-only status are available per span. The source data has test method and field team, which the backend cleans; both are stored and shown per span.
5. As a planner, I want to pick two buildings and see route options, so that I can choose a route with enough free cores.
   - Routing runs over spans: each span joins two sites, weighted by km. Segments stay as labels for display and as the KMZ line on the map.
   - The route planner (in the Find card, "Route A to B") takes From, To, Optimise for (Shortest distance or Most free cores; no "lowest loss" until loss data exists) and Cores needed per span.
   - Up to 3 route options are shown, each with its spans in order as building A to building B, with each span's km and free cores, grouped under their segment label where there is one. Each option shows total km, estimated dB, and the fewest free cores on any span of the path (the bottleneck, shown).
   - Options are ranked by the Optimise for choice: shortest km, or most free cores (the fewest free cores on any span of the path, higher is better). Options without enough cores come last, and the best option carries a "Best match" tag.
   - The user must be able to see every option returned (up to 3), none hidden or cut off. A selected route shows as the 2D route ribbon (see Design decisions).
   - From and To list all sites, so any site can route to any site, including starting or ending a route inside a segment.
   - A route's estimated loss is the sum of its spans.
   - Each option shows loss confidence, as measured spans out of spans on the path.
   - An option with fewer free cores than needed is flagged.
   - Invalid input clears the results and shows an inline error on the field.
6. As a planner, I want to see real routes on a map, so that I understand where spans run.
   - MapLibre GL JS draws each span as a straight line between its two sites over the self-hosted basemap, with the drawing rules in Design decisions (data center square, other site diamond, line weight by route type, free-cores chip). Clicking a span selects it and fills the Inspector and the cores section. KMZ shapes are not in the MVP map: spans are straight lines. One mock route with a drawn shape (two spans between three sites, stored as a segment line) is drawn in place of its straight lines to prove the line-shape path works end to end. Real KMZ import is Later / parked; segments stay labels.
   - Basemap colours come from the UI colour palette (light theme); the UI is built first and the map follows.
   - By default the map shows only sites that have spans, plus span lines. The other sites (about 36,000 from the Site Location sheet) are an optional clustered layer. No tile or response caching in the MVP; performance is tested after the MVP and cached only if slow.
   - Site coordinates come from the Excel where available. For real KMZ import (Later), each KMZ route is matched to a segment by the site A and site B in its name (`<site A> - <site B>`); the exact format is confirmed against the mock files. Because several segments can share the same two end sites, a name may match more than one segment. Routes that cannot be matched, or match more than one segment, are listed in the validation report. A site without valid coordinates takes its position from the end of a KMZ route that touches it; with neither, it is listed but not drawn on the map. Spans and routing still work for it.
7. As an admin, I want users to sign in with roles, so that reservations and uploads are attributable.
   - Roles: planner and admin. Sign-in starts with local accounts; enterprise SSO is a later option. Admins create accounts and reset passwords; there is no self-signup, and a password change is forced at first login. Accounts are deactivated, never deleted: history keeps the user's name, their pending requests stay in the admin queue, and their stale digests go to all admins.
   - Stays in the MVP, because admin-only approval and release need sign-in, and it is built right after the approval flow so it is never the story left for last.
   - Admins get admin functions (Approvals and Upload as top tabs, Users) that planners never see, and can use every planner function too.. Users is reached from an admin-only item in the account menu (top right), which opens the users screen.
8. As an admin, I want to upload Excel files, so that data updates without a developer. (KMZ upload is Later.)
   - A separate admin area, outside the planner functions (the Upload tab).
   - Python validates and cleans each file and reports rejected rows. Excel stays manually updated after go-live, so uploads repeat: a re-upload updates existing records and adds new ones without duplicates; spans are matched by their two sites, in either order (two sites have at most one span), segments by their two end sites, and ports by Port ID; a circuit ID in a row attaches to its core.
   - New measurements are appended to history, never overwritten. Reservations are imported from Excel only until the import is closed. The admin upload area has an optional one-time switch, "Close reservation import". Until it is closed, every upload imports its approved reservation rows whose cores are free; a row whose core is already held is skipped, so re-uploads never duplicate or change a reservation. Reservation rows appear as their own group in the preview, so the admin sees exactly which reservations will be imported before confirming. Closing needs a reason, is saved as a history record and cannot be reopened in the MVP. After it is closed, reservation rows in an uploaded Excel are ignored and listed as a warning in the preview, and new reservations are made only in the dashboard.
   - Every upload shows a validation report first; nothing is saved until the admin confirms.
   - **Site master upload (replace-file model).** The site master is its own workbook, separate from the Reservation workbook, and is uploaded on its own. It has two worksheets: the LRD sites sheet (site_name, latitude_in_decimal, longitude_in_decimal, region, other columns) and the DC list sheet (header "DC Name / Link", LRD, lat, long, state, other columns). Every DC is also listed in the site list.
     - Each worksheet is found by its headers, not its name: the sites sheet is the one with site_name, latitude_in_decimal and longitude_in_decimal; the DC sheet is the one with "DC Name / Link" and LRD. Header matching ignores case and spacing. If no sheet matches, that part is blocked with a clear message naming the expected headers.
     - The admin uploads the new file. It goes to staging (nothing is written yet) and is compared with the database per sheet: Added (insert), Changed (update, kept as data edit history with the upload as the reason), Missing from the file (marked inactive, never deleted; if a span or reservation uses it, it stays active and shows a warning) and Problem (Needs review). Sites key on site_name (the 4-letter LRD code); DCs key on "DC Name / Link".
     - The preview shows summary counts first, then filters Added, Changed, Missing and Problem (about 36,000 site rows). The admin applies it. The applied file becomes the "current file", shown with name, upload date, uploader and row counts. Previous uploads are kept for comparison.
     - Whole-file checks block that sheet: empty, required headers missing, duplicate keys, or the new sheet has 10% or more fewer rows than the database (the admin can override with a confirmation). A failing DC sheet does not block a good sites sheet.
     - A DC missing from the new file while a new DC appears with the same LRD and coordinates is flagged "possible rename" for the admin to decide.
     - The values empty, "TBA", "N/A", "NA", "-" and "TBC" count as blank, not as invalid text.
     - A DC row links to its site through the LRD column and adds the DC details; it does not create a new place. If its own lat/long is blank or invalid, the DC uses the linked site's coordinates, labelled "location from site <LRD>". If the linked site has no valid coordinates either, the row is Needs review and the DC is not drawn on the map. A site with invalid coordinates is Needs review and not drawn on the map, but spans and routing still work for it.
     - The per-row checks above still apply (coordinate box, region spelling map, unknown region is Needs review). A parser failure never blocks the import and nothing is guessed. A field edited in the dashboard is protected from uploads; the preview shows "edited in dashboard, file differs".
     - Undo of a site master upload is not in the MVP. Previous uploads are kept for comparison; the undo or rollback button is Later / parked.
     - The Reservation workbook (Reservation sheet) and the site master workbook (sites sheet and DC sheet) are two separate uploads. The sample file holds all four sheets together for convenience only. Each upload is recognised by its sheets' headers, not by file or sheet name.
   - The customer is required in the Excel too. A reservation row without a customer is Rejected in the preview and not imported; the admin fixes the Excel and uploads again, and the fixed row imports then.
   - A reservation row without a reserved date still imports, with the import date as the start of its stale clock and a warning in the preview.
   - Every upload row is kept raw in staging with its sheet name and row number, and gets a status: Ready, Needs review or Rejected, with a reason shown in the preview. Needs review means a row the admin must look at before it can import; Rejected means it cannot import until the Excel is fixed. The admin fixes a row in the dashboard with a reason (kept as history and protected from later uploads), or cleans the Excel and uploads again.
   - Parsing is layered: the raw text is always kept and parsed fields are added on top. A parser failure never blocks the import; the row goes to Needs review.
   - A region spelling variant (for example "Nothern") is mapped to North, Central, South or East Coast. A region value that cannot be mapped goes to Needs review with a reason, never a silent guess.
   - A site or DC with latitude and longitude outside a Southeast Asia box (roughly latitude -11 to 21, longitude 92 to 141; Malaysia is latitude 0.8 to 7.4, longitude 99.6 to 119.3) goes to Needs review, because swapped values, 0,0 and typos would plot in the wrong place and break distances.
   - A standalone checker, `python -m app.ingest.excel_check <file>`, reads a workbook and prints a report of bad coordinates, unknown sites, malformed or unpairable port ranges, blank requestors, unknown region spellings and duplicate site names. The upload preview uses the same check functions.
   - Spans are grouped into segments as the Excel states; where it does not, by chaining site pairs from the segment's site A to its site B, and any chain with more than one possible path is flagged in the report.
   - Many rows with the same two sites are normal, because one cable has many cores. The validation report warns when the same Port ID appears twice or when a cable looks listed twice between the same two sites, and the admin decides what to keep before anything is saved.
   - After the first import, the dashboard database is the source of truth and the Excel is a feed. A field edited in the dashboard is protected: a later upload that differs shows as a conflict in the preview and keeps the dashboard value unless the admin ticks the Excel value.
   - The Admin area runs an upload in three steps: Upload, Preview and Confirm. The preview groups rows as New, Changed, Conflicts, Not in this file, Needs review and Rejected, each with its warnings and row status. Rows missing from a file are left untouched and listed as Not in this file. The site master upload below is the exception: it uses the replace-file model.
   - An upload never changes a reservation. If an uploaded row conflicts with a Requested or Reserved core, for example the core is marked Faulty or no longer exists, the preview flags it and the reservation goes to the Action needed list.
   - Admins can edit data in the app, because the Excel is a feed and not the source of truth. The MVP covers core status (Faulty or Available only; In use comes from the Excel and Reserved from the reservation flow), span details (distance, route type, region, sites A and B, survey count, cable size) and site details (name, coordinates). Everything else is v1.1. Each edit needs a reason and is saved as a new history record; a changed distance recalculates loss, and marking a Requested or Reserved core Faulty sends its reservation to Needs review.
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
| Frontend | React + TypeScript (Vite), Tailwind CSS, shadcn/ui, Recharts; Geist and Geist Mono fonts, self-hosted |
| Map | MapLibre GL JS with OpenStreetMap data, PMTiles extract capped at zoom 14, self-hosted glyphs, sprites and a light basemap, no external map API |
| Backend | Python + FastAPI; also handles Excel and KMZ conversion and cleaning, routing with NetworkX, reservation rules and the daily reminder job |
| Database | PostgreSQL with PostGIS |
| Deployment | Docker Compose on a company-managed server; the exact host is confirmed with IT before go-live |

**Integration Points**

| Integration | Purpose | Status |
| --- | --- | --- |
| Excel exports from the source system | Sites (all with latitude and longitude), spans, segments, cores, ports, measurements; schema built from the column headers; after the first import a feed, not the source of truth | Sample workbook received 22 October 2026 (see Sample Excel workbook below); real data not yet available |
| KMZ files | Route coordinates, one KMZ route per segment, matched to Excel; join key TBD | Later. The MVP map uses straight lines plus one mock route with a drawn shape; real KMZ import and real files come later |
| SMTP relay | Daily stale-reservation email digest; email to admins on each new reservation request | Sender address must be registered under the company domain; access and registration TBD, and they decide whether email ships in the MVP |
| Daily scheduler | Digest and stale checks | In-app scheduler (APScheduler) inside the FastAPI container; it records its last run, so a restart never sends the digest twice |
| Authentication | Sign-in and roles | Local accounts first; enterprise SSO later |

**Data Model Foundation**

The planning side comes first: reservations, customers and planners as separate tables, with reservations as insert-only rows. Around it: sites (data centers and TOCs), spans with route type (Bespoke, Trunk, Metro) and region (North, Central, South, East Coast), segments (several spans end to end), cores, ports, and measurements kept as history. Site names are unique across all regions, and many sites can share a region. A site has an active flag: a site missing from a site master upload is marked inactive, never deleted. The four regions stay as they are; new values come by migration when real data shows them. Measurements also store test method and field team. Ports connect through cores to another site. The app assigns its own internal ID to every site, span and segment. A circuit ID comes from another system and is an optional field on the core, because one span carries many circuits; uploads match spans by the two sites, and ports by Port ID. Site is the general term for a site, a building or the equipment in it, and measurements are stored per span. Migration 0004 is part of Session 4 (Phase 5): `spans.cable_size` (default 144, info only), `reservations.unassigned_cores` (int, not null, default 0, set at insert) and the event type 'assigned'. After the first import the dashboard database is the source of truth and the Excel is a feed; fields edited in the dashboard are protected from later uploads, and every edit is kept as history with a reason.

**Sample Excel workbook**

Walked through with the data owner on 22 to 24 October 2026 (`Sample/Sample Excel Structure.xlsx`, four sheets in one file for convenience; in real use the Reservation workbook and the site master workbook are separate files). Real data is uncleaned, so the rules below keep raw values and flag what they cannot read.

| Sheet | MVP | Rows |
| --- | --- | --- |
| Reservation | Imported (the only operational sheet) | About 102 |
| Monitoring | Not imported; the planner says the data is not accurate. v1.1 or later | |
| Site Location (sites sheet) | Imported as sites (site master upload) | About 36,000 |
| DC List (DC sheet) | Imported as DCs, linked to their LRD site (site master upload) | About 100 |

Reservation sheet (header on row 1):

- **Region:** some blocks are merged cells, others repeat per row. Merged cells are filled forward. Spelling variants (for example "Nothern") map to North, Central, South or East Coast; an unknown value is Needs review with a reason.
- **Nodes:** `AABB-BBCC`, split on '-' and matched to a span by the unordered site pair. The suffix "(additional core)" means another reservation on the same span: it is stripped to match the span, and the reservation gets an `additional` flag. An unknown site code is Needs review.
- **Distance(KM):** the span's distance comes from this sheet.
- **Core Secured:** the number of cores found available at the onsite survey (core verification). Stored on the span as `survey_cores`. It sets how many core cells the span shows.
- **Expected CV Ready:** the core verification date (an Excel serial date). Stored on the reservation as `cv_ready_date`.
- **Port Info:** physical labels from both sites, free text with checklists, quality comments, sometimes dB loss and distance. Stored raw only in the MVP. Parsing it is a nice-to-have for later.
- **Contractor, Remark:** free text, stored raw.
- **Fiber core monitoring:** one of two 3-letter codes the data owner cannot disclose. Stored as free text; the dashboard suggests values already in use. The codes are never hardcoded.
- **Fiber monitored Y/N/WIP:** stored as is (Y, N or WIP) and displayed only; its meaning is still vague.
- **Fiber core requestor:** a company name or "internal usage", free text, uncleaned, may contain comments. It becomes the reservation customer. The customer stays required, so a blank requestor is Rejected. The preview shows near-matches by trigram similarity so the admin can merge customers.
- **Fiber core request date:** the reservation date.
- **Aging(days):** ignored on import; computed live in Asia/Kuala_Lumpur from the reservation date.
- **No of core requested and Core assignment:** the real reservation. Core assignment holds port ranges per site, for example `AABB Tray 1 P1-P2` and `BBCC MOD B P23-24`. The two sites' ranges are paired in order (P1 with P23, P2 with P24). A length mismatch or a malformed range (for example `P23-282`) makes the row Needs review. Never guessed.
  - Core assignment blank and a count present: a count-only reservation. The row is Ready and imports as a reservation with `unassigned_cores = N` and no specific cores.
  - Core assignment blank and the count blank: Needs review.
  - Open question: whether real rows have blank or short Core assignment. To be checked by running `excel_check` on the real file on the work laptop. If every real row lists its cores, a blank Core assignment could become Needs review instead of a count-only reservation.
- **Core balance:** computed; ignored on import. It is Core Secured minus assigned, which matches the dashboard's free to reserve logic.
- **Title rows** (for example "DWDM Trunk Route 1", "DWDM Route 2", "Company A project") are group labels. They apply to the rows below until the next title and are stored as `group_label` on each reservation.

Site Location sheet (the sites sheet; found by its headers, not its name or position): in the sample the header is on row 4 (rows 1 to 3 are a title and blank). Every row is a site. Columns: SITE_NAME, LATITUDE_IN_DECIMAL, LONGITUDE_IN_DECIMAL, then 2G, 3G, 4G, REMOTE VSAT, CPE, PDH Microwave, SITE_TYPE, STRUCTURE_TYPE, PMSHIP, SHARING_TYPE, STRUCTURE_HEIGHT, DESCRIPTION, CREATED_BY, CREATED_WHEN, MODIFIEDBY, MODIFIEDWHEN, STRUCTURE_OWNER. Name, kind, location and region are real columns on the site. Every other column goes into one `details` JSON field, shown in the site panel, so a new Excel column needs no schema change. All sites are expected to have latitude and longitude; the coordinate check above applies.

DC List sheet (the DC sheet; found by its headers): columns No, State, City, Cluster, DC NAME / LINK, LRD, E2E Status, Fiber Leg, lat, long. A DC is a site of kind 'data_center', linked to its LRD site row, not a separate place. A DC may have its own latitude and longitude, which can differ from its LRD site; when its own are blank or invalid it uses the linked site's, labelled "location from site <LRD>". E2E Status, Fiber Leg (the number of cables entering the DC), State, City and Cluster go in `details`.

**Non-Functional Requirements**

- Up to 50 concurrent users. About 36,000 sites, about 100 DCs, hundreds of sites with spans, and up to about 100,000 cores. This is small for PostgreSQL with indexes (pg_trgm GIN on site names, btree on `cores.span_id`, GiST on site location).
- Time zone: all date logic (the 3-month stale rule, the daily digest's "today") and date display use Asia/Kuala_Lumpur. Timestamps are stored in UTC (timestamptz).
- Desktop only, minimum width 1200px, checked at 1280, 1440 and 1920. Light theme only. Text contrast of at least 4.5:1 and non-text contrast of at least 3:1 (WCAG 2.1 AA).
- Keyboard-operable navigation, controls and panels. Automated tests cover the reservation flow (request, approve, reject, release, correct), upload validation and the loss bands; the UI also gets a manual check at the four widths.

**Security & Privacy**

- A tightly monitored enterprise with several admins: every upload, reservation request, approval, release and data edit is attributable to a user and kept as history.
- Customer names are business data; no data leaves the network, since tiles, fonts and sprites are self-hosted.
- Secrets such as database and SMTP credentials live in environment variables, never in the repository.
- Nothing is deleted in the MVP; all history is kept. Compliance requirements and retention rules are checked with IT later.

## 5. Risks & Roadmap

All five MVP items are planned for 31 October 2026, about 11 days from this draft, so the cut order matters more than the dates.

**Phased Rollout**

1. **MVP, by 31 October 2026:** fiber health (cores and ports, reservations and link loss) and route planning; the MapLibre map page (straight span lines, plus one mock route with a drawn shape; real KMZ import is later); Reserve cores with admin approval; admin upload with a preview step, including the site master replace-file upload; admin editing of core status, spans and sites; email digest; login and roles. If time runs short, the email digest moves to v1.1 first; the next cut is the MapLibre basemap, with a plain SVG map of sites and straight span lines as the fallback; after that, span and site editing moves to v1.1 and core status editing stays. Gate to ship: tested on real exported data.
2. **v1.1:** email digest and admin request emails if cut or the SMTP relay is not ready (the in-app Action needed list ships first either way); a mini map in the upload step to compare a new KMZ route with existing routes (idea, to decide); verification of reservation data; import of the Monitoring sheet once the planner confirms the data is accurate; parsing of the Port Info text; editing of ports, customers and other data in the app; PMTiles zoom detail review.
3. **v2.0:** joint closures on the map; scheduled imports; production shipping model.

**Later / parked** (decided or proposed on 26 October 2026; not MVP)

1. **Excel export of reservations** in the Reservation sheet layout: region blocks, title rows, LRD-LRD pairs with "(additional core)", core assignment, ports, contractor, remark, requestor and request date. It adds a Fiber ID column so re-uploads match exactly, and a header note "Generated from Fiber on <date>. Make changes in the dashboard."
2. **Idea:** the web app holds the reservation Excel and appends or modifies its rows when reservations are made in the dashboard, keeping both in sync.
3. **Reservation uploads while Excel and dashboard are both in use:** compare each row with the dashboard and label it New, Same, Differs, Clash or Missing. The dashboard is never overwritten automatically. Open question: how an upload may "modify" a reservation. Proposal: customer and date through a 'corrected' event chosen by the admin; core differences need release and a new reservation; missing rows only warn. The "Close reservation import" switch stays as an optional one-time admin action.
4. **Open question (count-only reservations):** whether real rows have blank or short core assignments (see the Sample Excel workbook section).
5. **Link loss tab** in the Inspector (needs measurement data), and a "lowest loss" route option once loss data exists.
6. **Dark theme.**
7. **Per-span core override** on route reservations (changing the cores per span).
8. **Inspector tabs Site and Services, map layers Services and Data centres** (shown disabled with a "Later" tag; placeholders for DC internals and bandwidth).
9. **Undo of a site master upload** (rollback to a previous upload). The MVP keeps previous uploads for comparison only.
10. **Real KMZ import** and KMZ route shapes on the map in place of straight lines. The MVP proves the path with one mock route.
11. **Optional Reservation workbook columns** Core status (mark a core Faulty), Loss (dB) and Tested on (append a measurement). The parser reads them when present, but the real sheet has none; agree the names with the planners first.

**Technical Risks**

| Risk | Impact | Mitigation |
| --- | --- | --- |
| Data is uncleaned: free-text requestors, merged cells, region typos, malformed port ranges and bad coordinates in the sample workbook | Bad rows save silently, plot in the wrong place or create wrong reservations | Raw staging with a status per row (Ready, Needs review, Rejected), the `excel_check` command, and the same checks in the upload preview; nothing is guessed |
| Five features in about 11 days, built with AI assistance by one person | MVP slips | Fixed cut order, starting with the email digest; build the UI (inventory and reservations) first, then the map, admin upload and email |
| Login slips past the MVP | Reserved-by cannot be trusted; admin upload is open; admin-only approval and release cannot be enforced | Build minimal login right after the approval flow, with a dev-only header standing in for the user until then; if it still slips, protect the Admin page at network level and hold approvals until login lands |
| Real data not yet available; the schema comes from Excel headers and the port data in the mock is not real; Excel stays manually updated after go-live | Matching on site pairs and Port IDs, or loss calculations break on first or later uploads | Upload validation report; test with a real export as soon as one is available; an upload never overwrites reservations made in the dashboard |
| SMTP relay access unconfirmed; the sender address must be registered under the company domain | Email digest slips | In-app Action needed list, approval requests and bell count ship first |
| First use of PostGIS, MapLibre and PMTiles | Map work overruns | Time-box the map; fall back to a plain SVG map of sites and straight span lines, without a basemap |
| Work laptop installs need an admin password; Docker Desktop is present but WSL has no Linux distro | Setup delays | Group installs into ticket bundles by source (npm, PyPI, Docker, system installers) and use the existing Docker engine |
| The map page now holds the whole span and route workflow, and the map is time-boxed to one day | The main page slips or the map blocks the workflow | Search and lists reach every span and route without the map; the SVG fallback keeps the page usable |
