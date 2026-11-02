# Plan: build the agreed layout (DESIGN.md section 3)

Owner go-ahead 2 November 2026. Source of truth: `docs/DESIGN.md` section 3 and the FigCraft mock
`figcraft/fiber-planner-layouts.figcraft` page "8 Final" (branch `pictures`). One step per session if tokens are short.
Each session: read this file, do the next unticked step, run its test, tick it, commit on `dev`.

Owner extra: fix the spacing of every table (even column widths, one cell padding, headers aligned with their values,
numbers right-aligned, no big empty gaps).

## Steps

- [x] A. Inventory page: tabs Inventory | My reservations (no Reserve tab; Approvals, Upload, Users stay for admins);
      map 8 of 12 columns with the segment list card beside it (search, Region, Type, rows of name, km, free count);
      `SegmentDiagram` under the map with a "Reserve cores" button; one merged Cores table replacing the core table
      and Allocations (chips All, Free, In use, Unassigned; columns Cores, Status, Customer, Planner, SRF, Planned,
      Age, Ports; holders first; consecutive cores of one reservation and runs of Available cores grouped into one
      expandable row; Unassigned row; row click opens core details). Shared table spacing fix for all tables.
      Test: lint, typecheck, e2e updated for the new page.
- [x] B. Reserve box: modal over Inventory, about 1040 wide; header segment line, free count, close; "Cores needed"
      stepper ticking the first N Available cores; list of Available cores (tick, Core, Ports both ends, Calculated
      loss, Measured loss, "Not tested", triangle and bold amber when measured is above calculated); footer Customer
      (required), Planned date, SRF ID (optional), "Reserve N cores"; discard prompt; success box and highlighted
      Requested row after submit. Route reservation uses the same box. Test: lint, typecheck, e2e.
- [x] C. Core details: rows "Calculated loss" and "Measured loss" (never just "Loss"); remove leftovers of the old
      Inspector and Reserve tab code. Test: lint, typecheck, full e2e, pytest.
- [x] D. Copy to `main` (same excludes as in `docs/rename-and-branches-plan.md` step 1c), push `dev` and `main`.
