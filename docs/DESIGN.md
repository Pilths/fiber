# Fiber Dashboard design

The single place for how the UI looks and where information goes. Read it before any UI or mock work.
Binding owner rules live in `CLAUDE.md` "UI rules"; this file does not repeat them.
Mockups live on the `pictures` branch. The DESIGN.md files there (under `mockups/comparison/`) describe rejected themes. Do not use them.

Status: 1 November 2026. Section 3 agreed with the owner.

## 1. Fixed constraints

- Desktop only (office computers). Minimum width 1200px; check at 1280, 1440 and 1920. Main check: 1440x900.
- WCAG 2.1 AA. Text at least 11px, text contrast at least 4.5:1, non-text contrast at least 3:1. Light theme only.
- Status and warning levels are never shown by colour alone: symbol, pattern or word.
- Everything works without the map: search and lists reach every segment and route.
- The selection is in the URL hash (`#segment=...`, `#route=...`).

## 2. Style tokens

Source of truth: `web/src/index.css`. Summary:

- Fonts: Geist (UI), Geist Mono (circuit IDs only), self-hosted. Tabular numerals for every number.
- Ground #f2f4f7. White cards, 1px border #e2e5ea, radius 8px, no shadows, 16px gutters, 20px card padding.
- Type: segment title 32px/700, metric numbers 40px/700, section titles 16px/600, labels 12px/500.
- Colour only where it carries meaning: blue #1d5fbf (primary), green #1a7f4b (free 10 or more),
  amber #b45309 on #fff7ed (Requested, low 1 to 9 free, stale, warnings), red #b42318 on #fef3f2 (cut, zero free,
  errors), slate (In service), dark ink (Reserved).
- Map: data center is a square, other site a diamond (circle in the current build). Line weight by route type:
  Trunk thick, Metro thin dashed. Each segment line carries a free-core number chip.

## 3. Information architecture (agreed 1 Nov 2026, mock "8 Final")

One user: the planner, who checks core information every day. Philosophy: Simple. Words and numbers a planner
reads at a glance; no sentences.

Tabs: **Inventory | My reservations**. There is no Reserve tab; reserving opens as a box over Inventory.

### Inventory (1440x900)

| Slot | Content |
|---|---|
| Top left, 8 of 12 columns | Map, full size. Never shrunk to make room for other content. Region and Type filters ("All regions", "All types") sit in the map toolbar beside Layers, zoom, Fit selection and Full screen; they dim the other segments. |
| Top right, 4 columns, map height | "Route A to B" panel (prototype 9e), content scrolls inside: Route A and Route B with a swap button, Cores needed, a full-width blue "Find route", Shortest distance / Most free cores toggle, then up to 3 option rows (radio dot, Option N, segments and km, lowest free count in a coloured pill, Calculated loss; the selected one has a blue border and tint). Nothing below before a search. Segments are found with the header search or the map. |
| Under the map, full width | Segment diagram: keep the one the web app has now (`SegmentDiagram` in `web/src/components/NetworkDetail.tsx`), not the simplified line in the FigCraft mock. The selected segment's box reaches the site dots at both ends. |
| Under the diagram, own row | "Reserve on this route" (when a route is found) and "Edit segment" (and "Restore" on a cut segment), right-aligned, all the same width. Not inside the diagram card. No row when it would be empty. |
| Below, full width | Cores table (see below). Rows of holders come first, so every holder is above the fold. |

Segment facts are only the two site names and the distance. No numbers row, no loss, no region or type on the segment
(region and type live in the map toolbar filters).

### Cores table (one table)

- Grouped by status, in this order: Requested, Reserved, In service, Unassigned, Available. Each group has a grey
  header row with a disclosure arrow, the status symbol and word, and its count (Unassigned: "N cores"), the only
  place the counts appear. Empty groups are not shown. Available starts collapsed; a focused or just-requested core
  opens its group. No filter chips.
- No table header at the top and no Status column: the group heading shows the status. Under each group heading
  sits that group's own row of column labels (12px, muted, 32px tall): Cores, Customer, Planner, SRF, Planned, Age,
  Ports. Available shows only Cores and Ports (the other columns are always empty there). A collapsed group hides
  its labels too. No loss column.
- One `<colgroup>` with fixed widths, so columns line up down every group. Group heading 40px on the light grey
  (subtle) background, 12px gap above every group but the first. Cells and labels are centred (as in every table);
  the group heading stays left-aligned. No zebra. A Stale chip sits in the Age cell after the number.
- One row per core everywhere (no ranges); the core number sits centred under "Cores". (Owner, 3 Nov 2026.)
- Unassigned row: a reservation for a number of cores whose core numbers are not picked yet (Excel import).
  Shown as "4 cores" in the Unassigned group.
- Row click opens core details (side panel): customer, planner, SRF, circuit, ports both ends, "Measured loss",
  "Calculated loss", test date, history, Keep, Release.

### Reserve box (modal over Inventory)

- Opens from "Reserve on this route" under the segment diagram, after a Route A to B search. All reserving goes
  through a route; a one-segment reservation is a route between that segment's two sites. Page behind is dimmed;
  map and table stay in place.
- About 1040 wide with compact spacing (about 20px padding, 36px rows); the core list scrolls inside.
- Header: the route's sites in order, close. Body: "Cores needed per segment" stepper (sets N, starts at the
  Route A to B "Cores needed"); per selected segment, a list of Available cores only: tick, core, ports (both ends), "Calculated loss", "Measured loss" ("Not tested"
  when none; measured above calculated shows a triangle and bold amber). Even, fixed column widths. Footer: Customer (required), Planned date, SRF ID (optional), "Reserve N cores".
- Closing with cores ticked asks "Discard N chosen cores?" (Keep editing, Discard).
- After submit: the box closes, a closable "Request #N sent" box shows, and the new Requested row is highlighted
  in the Cores table.
- Under the header, the route's segment diagram (site dots, line, km, site names; wraps like Inventory).
  At open no segment is selected and no core is ticked; the area below shows only "Choose a segment". Clicking a
  segment selects it (blue box) and shows that segment's Available cores list (same columns as above); double-click,
  or Enter/Space, on the selected segment unselects it. Ticks are kept per segment. "Cores needed per segment" sets N
  only (no auto-tick); each segment shows an "x of N" pill under its line, amber until x = N, then green; more than N
  cannot be ticked. "Reserve N cores" is enabled when every segment has exactly N ticked; one request with all cores.

### My reservations

Separate tab: all segments, only the planner's own reservations, with chips (All, Action needed, Pending, Stale).

### Words

| Word | Meaning |
|---|---|
| Free | cores that can be booked now (Available minus Unassigned holds) |
| In use | Requested, Reserved, In service and Unassigned |
| Verified | cores confirmed by the onsite survey (`segments.survey_cores`) |
| Total cores | cores in the cable (`segments.cable_size`), never shown as cells |
| Calculated loss | per core, from the owner's formula (km x 0.25 + 0.1 x km/4 + 0.5 x 2 connectors, 2 decimals); never drawn on the map or diagram |
| Measured loss | per core, from a physical field test by the field team (test type, date, team kept with it) |

Never label a value just "Loss": always "Calculated loss" or "Measured loss".

### Later

Sites and data centres: when `sites.details` has data, the segment list gets a Segments | Sites switch and a site
gets its own detail view (Overview, Racks, 3D). Global search: results grouped as Customers, Segments, Cores,
Circuits; a core result opens its segment and highlights the row.

## 4. Patterns (agreed)

- Tables: header row, status as symbol plus word, empty values shown with the shared `Blank` component.
- Filter chips with counts above a table (My reservations); counts appear only there. The Cores table uses status
  group headers instead.
- After a reservation request: a closable success box "Request #N sent. Waiting for admin approval."
  No hint lines beside buttons.

## 5. Decided (dated)

- 26 Oct 2026: simplicity first, then visibility. Rejected: Impeccable navy and teal theme, decorative tube ring
  icons, segment list in a left navigation.
- 31 Oct 2026: density A: key facts and the main action above the fold, tables below.
- 31 Oct 2026: Cores table columns: Cores, Status, Customer, Planner, SRF, Planned date, Age, Ports.
  Age is computed (`age_days` from the API), never stored.
- 2 Nov 2026: segment actions moved out of the diagram card into their own row below it, one fixed width.
- 3 Nov 2026: route reservations: the planner chooses the cores of each segment in the Reserve box from the route's
  segment diagram; the server no longer auto-picks them.
- 3 Nov 2026: single-segment Reserve cores removed; reserve only through Route A to B.
- 2 Nov 2026: prototype "9e": the segment list beside the map is replaced by the "Route A to B" panel (the route
  row above the map is gone); Region and Type move into the map toolbar; the Cores table groups rows by status with
  counts in the group headers instead of filter chips.
- 1 Nov 2026: a bottom-sheet segment drawer was considered and rejected (mobile pattern, hides the map).
- 1 Nov 2026: rejected layouts: one page with no map, full-screen map with floating panels, reserve inside the
  Inventory card with a shrunk map, a separate Reserve tab. Agreed: section 3.

## 6. Open

- Calculated loss formula: the owner provides it later. Ask for it before building loss in the website.
- Loss section: field tests carry type, date and team; a fuller loss view may come later. For now loss shows only
  as the two per-core values and in core details.

- Empty Planner and SRF cells: blank, or "Not recorded".

## 7. References

- Agreed prototype: `figcraft/fiber-planner-layouts.figcraft` on branch `pictures` (working copy `/home/user1/figcraft/`), page "8 Final" (8a Inventory,
  8c reserve box, 8d discard prompt, 8e after reserve). Other pages there are rejected options.
- Earlier options: `/home/user1/figcraft/fiber-inventory-vs-reserve.figcraft`. Font: `/home/user1/figcraft/fonts/`.
- Mockups, snapshots and FigCraft files: branch `pictures`.
