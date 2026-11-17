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

- Fonts: Geist (UI), Geist Mono (port labels and codes), self-hosted. Tabular numerals for every number.
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
| Top left, 8 of 12 columns | Map, full size. Never shrunk to make room for other content. The map card and the Site A to B panel end one 16px gutter above the window bottom (height = window minus the 60px header, the 24px top padding and 16px; at least 600px, at most 1000px), so the landing page has no scrollbar of its own. The map toolbar has zoom, Fit selection and Full screen (and the customer chip in customer mode). The Region filter and the layers (with the key) are not on the map: they are the map filters at the foot of the Site A to B panel (next row). The layers are the one place for what the map shows: Routes (Trunk, Metro, DC-DC, DC-TOC tick boxes with their key swatch, and an on/off chip per trunk route such as R1, R3) and Sites (Data centres, TOC, Trunk sites). A hidden line or site is not drawn; the selected segment or route and its end sites always show; route search still uses hidden segments. Line colour and pattern show the route type (Trunk dark grey solid, Metro purple long dash and dot, DC-DC teal double line, DC-TOC pink dashed, not verified dotted; selected blue), each over a white casing, and the layer swatches draw the same patterns; free-core health shows on the chips. The layer rows are the map key: there is no separate key on the map. Site shapes: Data centre (dark square), TOC (dark triangle), Trunk site (diamond); "Selected" (blue line) is a key row, not a toggle. Markers are small (data centre about 10px, TOC and trunk site the same size) with a click target of at least 24px; the layer rows are 20px high with 13px text. Clusters (16 Nov 2026): a cluster is a small group of nearby sites (for example several data centres within walking distance); a site is in no cluster or exactly one. Only a cluster of 2 or more sites has a sector: a thin outline 150 m around its sites (the API's buffered convex hull). A cluster of 1 site shows only its normal site marker (no label, no outline). Zoomed out, each cluster is ONE small label at the middle of its sites (16 Nov 2026, replaces the white label box that covered site names): a dark count badge about 18px high, like the crowd badge, with a thin ring in the cluster tint, and the cluster name as small text (11px, bold, the tint darkened, white halo, no box or border) to its right; the count is the site count (no free-core number); only the badge shows when the name would overlap another cluster label, a site marker or the name of a selected end site (other site names give way to the label as before); the badge covers no more than a site marker would; its 24px click target is the badge; its member sites are hidden under it and spoken in its label ("Cluster NAME, N sites: names"). Clicking the label zooms to the cluster (fit to its bbox, at least zoom 14 and no further in than about 16.5, so the member sites stand apart). Zooming in from zoom 12 to 14, the label fades out and the cluster outline (light fill fading to a thin line) and its site markers fade in; the fade follows the zoom and the switch that makes the label or the markers clickable has a dead band, so nothing flickers. Route lines stay drawn over the outline. Sites with no cluster show at every zoom. Clusters are always drawn: the map filters have no per-cluster chip (removed 16 Nov 2026). Picking a cluster in the header search fits the map to that cluster the same way (its sector bbox; a single-site cluster fits to its site). Crowding (sites not in a shown cluster label): sites closer than 16px on screen merge into a dark count badge (spoken "N sites: names"); clicking it zooms in 3 levels. While a cluster label shows, its sites are grouped by the cluster, not by pixel distance; zoomed in they crowd like any other site. Last resort: only at the map's max zoom, when sites still overlap, a crowd spreads into a stacked list to its right, one row per site with its name, joined to the spot by leader lines; each row is a site button reached by Tab. The selected segment's end sites never merge. Customer mode (header search, 16 Nov 2026): picking a customer selects all its segments (the others dim, as with any selection) and fits the map to them; each of their chips shows the customer's used cores (Reserved + In service) as a plain neutral pill like the cluster count (not a health colour, no name above it, never hidden by crowding; spoken "Segment A - B, N cores used by CUSTOMER"). The toolbar shows the customer's name with an x ("Clear customer highlight"); the toolbar wraps onto a second row when it does not fit, and the customer's name truncates with an ellipsis (full name on hover) so the picker and the x always stay inside the map. A customer with 2 or more requests that use cores (Reserved or In service; a Requested-only request with 0 used cores is not listed) also gets a request picker between them (a plain select, 16 Nov 2026): "All requests" (the default, as above, summing every request) and one entry per listed request, "SRF-0042 · 3 cores · 12 Mar" (the SRF ID or "Request #id", its used cores, its planned date when it has one). Picking a request selects only that request's segments, fits the map to them, and each pill shows that request's used cores (spoken "..., N cores used by CUSTOMER, request SRF-0042"); "All requests" brings back every segment and the summed pills. A newly picked customer always starts on All requests. The x, Esc (except on the request picker, where Esc only closes its list) or a click on bare map ends customer mode, and so does a found route or a segment or core picked in the search. Clicking a highlighted route opens that segment as usual. A customer with no segment cannot be picked. |
| Top right, 4 columns, map height | "Site A to B" panel (prototype 9e): Site A and Site B with a swap button, Cores needed, a full-width blue "Find route", Shortest distance / Most free cores toggle, then the option rows, which take the height left and scroll inside themselves (as many as the network gives, up to 5; near-copies dropped) (radio dot, Option N, segments and km, lowest free count in a coloured pill, Calculated loss; the selected one has a blue border and tint). An option with too few free cores, or a segment not verified, has its pill red with a warning symbol and sorts last, with no sentence; Reserve on this route stays disabled. Nothing below before a search. Segments are found with the header search or the map. Map filters, pinned to the panel's foot (1px top rule, always visible, same 20px side padding; prototype map-side, 16 Nov 2026): the Region filter ("All regions", full width; it dims the other segments), then two columns of tick boxes (route types with their line swatch and the trunk route chips; site kinds with their marker shape, then the Selected key row). At 1280x720 one option row shows above them, two at 1440x900. |
| Under the map, full width | Segment diagram: keep the one the web app has now (`SegmentDiagram` in `web/src/components/NetworkDetail.tsx`), not the simplified line in the FigCraft mock. The selected segment's box reaches the site dots at both ends. |
| Under the diagram, own row | "Reserve on this route" (when a route is found) and "Edit segment" (and "Restore" on a cut segment), right-aligned, all the same width. Not inside the diagram card. No row when it would be empty. Edit segment (admin) has "Use total cores" beside the verified core count (copies Total cores into it) and "Paste ports": paste the build sheet port column for the site A and/or site B end (one label per Excel cell, the first = core at "Start at core", default 1, blank cell skips; labels are FDF1-MOD2-T3-P5 or ODF1-P5, anything else is a Problem), a preview of each core with old and new ports and a check (New, Replaces, Unchanged, Problem), and Apply for all non-problem rows. |
| Below, full width | Cores table (see below). Rows of holders come first, so every holder is above the fold. |

Segment facts are only the two site names and the distance. No numbers row, no loss, no region or type on the segment
(region lives in the map filters at the foot of the Site A to B panel; type is derived and shown by the layers).

### Cores table (one table)

- Grouped by status, in this order: Requested, Reserved, In service, Unassigned, Available. Each group has a grey
  header row with a disclosure arrow, the status symbol and word, and its count (Unassigned: "N cores"), the only
  place the counts appear. Empty groups are not shown. Available starts collapsed; a focused or just-requested core
  opens its group. No filter chips.
- No table header at the top and no Status column: the group heading shows the status. Under each group heading
  sits that group's own row of column labels (12px, muted, 32px tall): Cores, Customer, Planner, SRF, Planned, Days held,
  Ports. Available shows only Cores and Ports (the other columns are always empty there). A collapsed group hides
  its labels too. No loss column.
- One `<colgroup>` with fixed widths, so columns line up down every group. Group heading 40px on the light grey
  (subtle) background, 12px gap above every group but the first. Cells and labels are centred (as in every table);
  the group heading stays left-aligned. No zebra. A Stale chip sits in the Days held cell after the number.
- One row per core everywhere (no ranges); the core number sits centred under "Cores". (Owner, 3 Nov 2026.)
- Unassigned row: a reservation for a number of cores whose core numbers are not picked yet (Excel import).
  Shown as "4 cores" in the Unassigned group.
- Row click opens core details (side panel; admin has "Add test" for a Measured loss test: dB, test date, test type, field team): customer, planner, SRF, ports both ends (an admin picks FDF with FDF ID, Mod, Tray, Port, or ODF with ODF ID, Port, each a number or letters; no free text), "Measured loss",
  "Calculated loss", test date, history, Keep, Release.

### Reserve box (modal over Inventory)

- Opens from "Reserve on this route" under the segment diagram, after a Site A to B search. All reserving goes
  through a route; a one-segment reservation is a route between that segment's two sites. Page behind is dimmed;
  map and table stay in place.
- About 1040 wide with compact spacing (about 20px padding, 36px rows); the core list scrolls inside.
- Header: the route's sites in order, close. Body: "Cores needed per segment" stepper (sets N, starts at the
  Site A to B "Cores needed"); per selected segment, a list of Available cores only: tick, core, ports (both ends), "Calculated loss", "Measured loss" ("Not tested"
  when none; measured above calculated shows a triangle and bold amber). Even, fixed column widths. Footer: Customer (required), Planned date, SRF ID (optional), "Reserve N cores".
- Closing with cores ticked asks "Discard N chosen cores?" (Keep editing, Discard).
- After submit: the box closes, a closable "Request #N sent" box shows, and the new Requested row is highlighted
  in the Cores table.
- Under the header, the route's segment diagram (site dots, line, km, site names; one line like Inventory: segments shrink to 112px, then the line scrolls sideways).
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
| Verified | cores confirmed by core verification (`segments.survey_cores`) |
| Total cores | cores in the cable (`segments.cable_size`), never shown as cells |
| Calculated loss | per core, from the owner's formula (km x 0.25 + 0.1 x km/4 + 0.5 x 2 connectors, 2 decimals); never drawn on the map or diagram |
| Measured loss | per core, from a physical field test by the field team (test type, date, team kept with it) |

Never label a value just "Loss": always "Calculated loss" or "Measured loss".

### Later

Sites and data centres: when `sites.details` has data, the segment list gets a Segments | Sites switch and a site
gets its own detail view (Overview, Racks, 3D). Global search: results grouped as Customers, Segments, Clusters, Cores; a cluster result fits the map to that cluster; a core result opens its segment and highlights the row; a customer result shows the customer on the map (customer mode, section 3).

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
  Age (shown as "Days held" since 4 Nov 2026: days since the request, a plain number) is computed (`age_days` from the API), never stored.
- 2 Nov 2026: segment actions moved out of the diagram card into their own row below it, one fixed width.
- 3 Nov 2026: route reservations: the planner chooses the cores of each segment in the Reserve box from the route's
  segment diagram; the server no longer auto-picks them.
- 3 Nov 2026: single-segment Reserve cores removed; reserve only through Site A to B.
- 2 Nov 2026: prototype "9e": the segment list beside the map is replaced by the "Site A to B" panel (the route
  row above the map is gone); Region and Type move into the map toolbar; the Cores table groups rows by status with
  counts in the group headers instead of filter chips.
- 15 Nov 2026: cluster sectors on the Inventory map (section 3, map slot): sector per cluster zoomed out, site
  markers zoomed in, a Clusters chip per cluster in Layers, count badges for crowded sites, smaller markers and
  Layers rows. Prototype: cluster-sector-preview.
- 16 Nov 2026: clusters are small groups of nearby sites, not regions: a sector only for a cluster of 2+ sites (150 m outline), one
  label per cluster with its name and site count (no free-core number) zoomed out, fade window zoom 12 to 14,
  crowd spread only at max zoom. Metro lines get their own long dash and dot pattern (Trunk stays solid).
- 16 Nov 2026: the cluster label becomes a small tinted-ring count badge with the name as small text (the white box
  covered site names); the map toolbar wraps so the customer chip and its x stay inside the map; the request picker
  lists only requests that use cores, and Esc on it no longer ends customer mode.
- 16 Nov 2026: the map row ends one gutter above the window bottom (600 to 1000px). Region, Layers and the map key
  leave the map: they merge into one always-visible map filters block pinned to the foot of the Site A to B panel
  (no Layers button, popover or bottom-left key); the route options scroll inside the space left above it.
  Prototype: map-side.
- 16 Nov 2026: the per-cluster Clusters chips leave the map filters (clusters always drawn); clusters join the
  header search as their own group, and picking one fits the map to the cluster.
- 1 Nov 2026: a bottom-sheet segment drawer was considered and rejected (mobile pattern, hides the map).
- 1 Nov 2026: rejected layouts: one page with no map, full-screen map with floating panels, reserve inside the
  Inventory card with a shrunk map, a separate Reserve tab. Agreed: section 3.

## 6. Open

- Calculated loss formula: the owner provides it later. Ask for it before building loss in the website.
- Loss section: field tests carry type, date and team; a fuller loss view may come later. For now loss shows only
  as the two per-core values and in core details.
- Empty Planner and SRF cells: blank, or "Not recorded".
- Cluster tints (16 Nov 2026: one tint per cluster, built): the palette is `--cluster-1` to `--cluster-6` in
  `web/src/index.css` (sample: red, green, blue, amber, purple, teal; cycles after 6). A cluster's tint is set by
  its place in the name-sorted list of all clusters with a sector. The tint colours the label's badge ring and
  name, and the outline. Owner to confirm
  the final colours after seeing the sample.

## 7. References

- Agreed prototype: `figcraft/fiber-planner-layouts.figcraft` on branch `pictures` (working copy `/home/user1/figcraft/`), page "8 Final" (8a Inventory,
  8c reserve box, 8d discard prompt, 8e after reserve). Other pages there are rejected options.
- Earlier options: `/home/user1/figcraft/fiber-inventory-vs-reserve.figcraft`. Font: `/home/user1/figcraft/fonts/`.
- Mockups, snapshots and FigCraft files: branch `pictures`.
