# Fiber Dashboard design

The single place for how the UI looks and where information goes. Read it before any UI or mock work.
Binding owner rules live in `CLAUDE.md` "UI rules"; this file does not repeat them.
Mockups live on the `pictures` branch. The DESIGN.md files there (under `mockups/comparison/`) describe rejected themes. Do not use them.

Status: 1 November 2026. Section 3 agreed with the owner.

## 1. Fixed constraints

- Desktop only (office computers). Minimum width 1200px; check at 1280, 1440 and 1920. Main check: 1440x900.
- WCAG 2.1 AA. Text at least 11px, text contrast at least 4.5:1, non-text contrast at least 3:1. Light theme only.
- Status and warning levels are never shown by colour alone: symbol, pattern or word.
- Everything works without the map: search and lists reach every span and route.
- The selection is in the URL hash (`#span=...`, `#route=...`).

## 2. Style tokens

Source of truth: `web/src/index.css`. Summary:

- Fonts: Geist (UI), Geist Mono (circuit IDs only), self-hosted. Tabular numerals for every number.
- Ground #f2f4f7. White cards, 1px border #e2e5ea, radius 8px, no shadows, 16px gutters, 20px card padding.
- Type: span title 32px/700 (Inspector), metric numbers 40px/700, section titles 16px/600, labels 12px/500.
- Colour only where it carries meaning: blue #1d5fbf (primary, Chosen), green #1a7f4b (free 10 or more),
  amber #b45309 on #fff7ed (Requested, low 1 to 9 free, stale, warnings), red #b42318 on #fef3f2 (cut, zero free,
  errors), slate (In service), dark ink (Reserved).
- Map: data center is a square, other site a diamond (circle in the current build). Line weight by route type:
  Trunk thick, Metro thin dashed. Each span line carries a free-core number chip.

## 3. Information architecture (agreed 1 Nov 2026, mock "8 Final")

One user: the planner, who checks core information every day. Philosophy: Simple. Words and numbers a planner
reads at a glance; no sentences.

Tabs: **Inventory | My reservations**. There is no Reserve tab; reserving opens as a box over Inventory.

### Inventory (1440x900)

| Slot | Content |
|---|---|
| Top left, 8 of 12 columns | Map, full size. Never shrunk to make room for other content. |
| Top right, 4 columns, map height | Span list: search, Region and Type filters, rows of span name, km and free count (0 in red). |
| Under the map, full width | Span diagram: keep the one the web app has now (`SpanDiagram` in `web/src/components/NetworkDetail.tsx`), not the simplified line in the FigCraft mock. "Reserve cores" button at its right end. |
| Below, full width | Cores table (see below). Rows of holders come first, so every holder is above the fold. |

Span facts are only the two site names and the distance. No numbers row, no loss, no region or type on the span
(region and type live in the span list filters).

### Cores table (one table; replaces the old core table and Allocations)

- Filter chips with counts, the only place the counts appear: All, Free, In use, Unassigned.
- Columns: Cores, Status, Customer, Planner, SRF, Planned, Age, Ports. No loss column.
- Consecutive cores of one reservation collapse into one row ("10-12"); runs of Available cores collapse into one
  row ("3-9 Available (7)"). The row's arrow expands it per core.
- Unassigned row: a reservation for a number of cores whose core numbers are not picked yet (Excel import).
  Shown as "4 cores", status "Unassigned".
- Row click opens core details (side panel): customer, planner, SRF, circuit, ports both ends, "Measured loss",
  "Calculated loss", test date, history, Keep, Release.

### Reserve box (modal over Inventory)

- Opens from "Reserve cores" on the span diagram. Page behind is dimmed; map and table stay in place.
- About 1040 wide with compact spacing (about 20px padding, 36px rows); the core list scrolls inside.
- Header: span line, free count, close. Body: "Cores needed" stepper that ticks the first N available cores;
  list of Available cores only: tick, core, ports (both ends), "Calculated loss", "Measured loss" ("Not tested"
  when none; measured above calculated shows a triangle and bold amber). Even, fixed column widths. Footer: Customer (required), Planned date, SRF ID (optional), "Reserve N cores".
- Closing with cores ticked asks "Discard N chosen cores?" (Keep editing, Discard).
- After submit: the box closes, a closable "Request #N sent" box shows, and the new Requested row is highlighted
  in the Cores table. A route reservation uses the same box with the route chain in the header.

### My reservations

Separate tab: all spans, only the planner's own reservations, with chips (All, Action needed, Pending, Stale).

### Words

| Word | Meaning |
|---|---|
| Free | cores that can be booked now (Available minus Unassigned holds) |
| In use | Requested, Reserved, In service and Unassigned |
| Verified | cores confirmed by the onsite survey (`spans.survey_cores`) |
| Total cores | cores in the cable (`spans.cable_size`), never shown as cells |
| Calculated loss | per core, from a formula the owner will provide (today's code uses distance x 0.3 dB/km as a placeholder); never drawn on the map or diagram |
| Measured loss | per core, from a physical field test by the field team (test type, date, team kept with it) |

Never label a value just "Loss": always "Calculated loss" or "Measured loss".

### Later

Sites and data centres: when `sites.details` has data, the span list gets a Spans | Sites switch and a site
gets its own detail view (Overview, Racks, 3D). Global search: results grouped as Customers, Spans, Cores,
Circuits; a core result opens its span and highlights the row.

## 4. Patterns (agreed)

- Tables: header row, status as symbol plus word, empty values shown with the shared `Blank` component.
- Filter chips with counts above a table; counts appear only there.
- After a reservation request: a closable success box "Request #N sent. Waiting for admin approval."
  No hint lines beside buttons.

## 5. Decided (dated)

- 26 Oct 2026: simplicity first, then visibility. Rejected: Impeccable navy and teal theme, decorative tube ring
  icons, span list in a left navigation.
- 31 Oct 2026: density A: key facts and the main action above the fold, tables below.
- 31 Oct 2026: Allocations columns: Cores, Status, Customer, Planner, SRF, Planned date, Age, Ports.
  Age is computed (`age_days` from the API), never stored.
- 1 Nov 2026: the Inspector does not show a "worst measured core" row.
- 1 Nov 2026: a bottom-sheet span drawer was considered and rejected (mobile pattern, hides the map).
- 1 Nov 2026: rejected layouts: one page with no map, full-screen map with floating panels, reserve inside the
  Inventory card with a shrunk map, a separate Reserve tab. Agreed: section 3.

## 6. Open

- Calculated loss formula: the owner provides it later. Ask for it before building loss in the website.
- Loss section: field tests carry type, date and team; a fuller loss view may come later. For now loss shows only
  as the two per-core values and in core details.

- Doc edits that follow from section 3: PRD story 2 (count-first picker), `CLAUDE.md` UI rules (no Reserve tab,
  reserve box) and loss rule (per-core loss in core details), PRD "Design decisions" moved here.
- Empty Planner and SRF cells: blank, or "Not recorded".

## 7. References

- Agreed prototype: `figcraft/fiber-planner-layouts.figcraft` on branch `pictures` (working copy `/home/user1/figcraft/`), page "8 Final" (8a Inventory,
  8c reserve box, 8d discard prompt, 8e after reserve). Other pages there are rejected options.
- Earlier options: `/home/user1/figcraft/fiber-inventory-vs-reserve.figcraft`. Font: `/home/user1/figcraft/fonts/`.
- Mockups, snapshots and FigCraft files: branch `pictures`.
