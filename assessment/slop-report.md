# Code audit: backend, web, Docker and database

Date: 18 Nov 2026. Branch: `dev`, including uncommitted work in progress.

Three read-only auditors ran in parallel. Each covered one area. Nothing was executed (no tests, no `alembic check`, no lint). Findings marked **Verified** were checked against the code by grep after the audit. All other findings are the auditors' reading and need a check before a fix, above all any deletion.

Legacy files kept on purpose until production were skipped: `seed.py`, `excel_check`, `parse_workbook`.

## Summary

| Area | High | Medium | Low | Coverage |
|---|---|---|---|---|
| Backend (`api/app`, `api/tests`) | 3 | 8 | 20 | Partial, see list at end of section |
| Web (`web/src`, `web/e2e`) | 3 | 12 | 7 | Full, except generated and config files |
| Docker and database | 4 | 7 | 10 | Full for compose, Dockerfiles, migrations, `models.py` |

Main themes:

1. **Duplication in uploads, on both sides.** The four upload kinds (Site master, Segment list, Reservation, KMZ) each re-implement staging, locking, finishing, `data_edits` writes, paged rows and the preview card, in the backend and in the web.
2. **Two code styles.** Newer modules follow the CLAUDE.md style. Older ones (`ingest/reservation_upload.py`, `ingest/segment_list.py`, `history.py`, the upload screens, `Reservations.tsx`, `AdminEdit.tsx`) do not. This is cleanup-session work, not feature work.
3. **Drift risks.** `models.py` differs from the migrations. The web hand-types API responses that have no `response_model`. Several env reads live outside `environment.py`.
4. **The compose stack is a dev stack.** It conflicts with the rule that the same setup runs on production.
5. **e2e tests that cannot fail, or that depend on DEV seed numbers and shared state.**

---

## 1. Backend (`api/app`, `api/tests`)

### Confirmed from the first pass
- Inline SQL is widespread (about 86 `text("...")` calls in 19 files). Worst: `ingest/reservation_upload.py`, `ingest/segment_list.py`, `ingest/reservation_import.py`, `history.py`, `auth/*`, the upload routers. `ingest/site_master/*`, `kmz_router.py`, `load_kmz.py` and `reservations/service.py` already use named SQL constants and are the model to copy.
- N+1 query in `reservation_upload.py:173-176` (one SELECT per measurement). More at `:154` and `:157` (per segment; the second calls `inventory.list_segments` per segment).
- Upload routers are copy-pasted (upload, rows paging, apply, `ApplyError` to `HTTPException`).
- Short names in `reservation_upload.py`, `segment_list.py`, `history.py`, `auth/*`.
- Username check and the user INSERT are duplicated in `auth/admin.py:69` and `create_admin.py:31`.
- `APP_ENV` is read outside `environment.py` in `seed_dev_loss.py:17` and `seed_dev_network.py:172`.
- `_SAME` SQL prefix concatenated with caller text at `reservation_upload.py:187`.

### High

**B-H1. Two coding styles side by side in `ingest/`.**
- `ingest/site_master/*` follows CLAUDE.md: named SQL, full names, small functions, a `model / evaluate / stage / apply` layout.
- `segment_list.py` and `reservation_upload.py` do not: lines of 150+ characters (`reservation_upload.py:154`, `:342-350`), `# type: ignore` markers, a nested ternary (`history.py:77`).
- `confirm()` in `reservation_upload.py:342-403` is about 60 lines with 8 jobs (lock, validate, wins, evaluate, segments, measurements, reservations, summary).
- `_segment_items` (`reservation_upload.py:126-180`) mixes parsing, DB reads, diffing, and removing from a list while iterating a copy of it.
- Fix: apply the site_master layout to the other two modules in the cleanup session.

**B-H2. Upload duplication goes below the routers.**
- Each upload kind has its own copy of: `INSERT INTO uploads ... RETURNING id`, `UPDATE uploads SET status='confirmed'`, and the select-for-update fetch of the upload.
- The `data_edits` INSERT is written 7 or more times: `reservation_upload.py:57`, `:375`; `segment_list.py:255`; `site_master/apply.py:41`, `:48`; `admin_edits/history.py:26`; `auth/admin.py:54`; `create_admin.py:37`. `admin_edits/history.py:log_edits` already exists and no ingest module uses it.
- `ApplyError` lives in `site_master/apply.py:198`. `segment_list` and `reservation_upload` import it from there, so site_master became the shared core by accident.
- `reservation_upload_router.py:34-97` has no response models (every route returns `dict[str, Any]`). This is the root cause of web finding W-H2.
- Fix: one `ingest/uploads.py` with `insert_upload`, `lock_staged_upload`, `finish_upload` and `ApplyError`. Send all `data_edits` writes through `log_edits`. Add response models. No router base class.

**B-H3. Module dependencies point the wrong way.**
- `admin_edits/segments.py:13` and `admin_edits/ports.py:12` import write helpers (`add_cores`, `port`) from `ingest/reservation_import.py`, a module documented as the import write path. `admin_edits/segments.py:16` imports `conflict` from `reservations/service`.
- `test_reservation_races.py:10` must import `inventory.service` first because "inventory and reservations import each other". That is an import cycle worked around in a test.
- `segment_list.py:20` imports `REASON` from `reservation_upload`. Ingest modules depend on each other sideways.
- Fix: move `add_cores`, `port`, `find_segment`, `ensure_segment` to a neutral module (for example `app/segments.py`) and `conflict` to a shared errors module. Break the inventory/reservations cycle with a third module. Keep shared constants in one place.

### Medium

**B-M1. `DB` and `Admin` annotated types redefined** in `auth/admin.py:14-15` and `history.py:18` instead of imported from `auth/deps.py:64-65`. `auth/admin.py` repeats the `(body or ReasonBody()).reason` unwrap three times; make `ReasonBody()` the default.

**B-M2. Env reads outside `environment.py`:** `SESSION_HOURS` at `auth/router.py:54` (read on every login), `LOG_LEVEL` at `observability.py:19` (**Verified**), `DEV_PASSWORD` in `seed_dev.py:53`. `conftest.py:13` sets `ALLOW_DEV_HEADER` with `setdefault`; if the test container ever has `APP_ENV` other than `development`, header-login tests fail as 401 with no clear cause. Add an assertion.

**B-M3. `load_kmz.py` is both a CLI and a library.**
- `kmz_router` imports six names from a module documented as a command-line script.
- `run()` (`:403-427`) re-implements the router's stage and apply, with a different summary shape.
- `SEGMENT_BY_ID_SQL` runs once per item (N+1) only to feed `save_shape`, which needs data `SEGMENTS_SQL` already returns. Same per-item SELECT in `kmz_router._apply` (`:158`).
- `parse_lines`, `folder_nodes` and `child_folders` walk the folder tree in near-identical ways. `folder_tree` rebuilds `lines_in_folder` at every level (quadratic on deep KMZ files; fine for current data).
- `OWN_ROUTE_SQL` and `OWN_SHAPE_SQL` repeat the same subquery.
- `kmz_router.upload` accepts `folder` and `folder_ids` (two ways to say one thing), and `block_reason` is assigned twice (`:120-126`), the second overwriting the first.
- Fix: split into `kmz/parse.py`, `kmz/graph.py`, `kmz/store.py`, with `load_kmz.py` as a thin CLI. Pass the segment row to `save_shape` and drop `SEGMENT_BY_ID_SQL`.

**B-M4. `observability.py` (work in progress).**
- `logged_apply` logs `HTTPException` refusals (404, 409) as "failed" at WARNING, but its docstring says a refusal "is an end, not a crash". Log refusals at INFO, or change the docstring.
- Routers wrap `logged_apply` in their own `try/except ApplyError`, so handling is in two layers. `reservation_upload_router.close` is not wrapped at all.
- `logger.exception("%s -> unhandled error", f"...")` formats a string and then passes it as an argument.
- No tests for `logged_apply` or `add_request_log`.

**B-M5. `reservations/service.py`.**
- `load()` takes `where` and `order` as SQL fragments; `needs_review` appends to `where`. The docstring says "never user text", but one careless change makes it injectable.
- `needs_review` has three `if` blocks that can add the same reservation up to three times, with no comment saying whether that is intended.
- `assert segment is not None` used as a not-found guard (`reservations/service.py:300`, `admin_edits/ports.py:140`, **Verified**). Asserts are removed under `python -O`. Raise `HTTPException(404)`.
- Old wording "surveyed" in `_not_bookable` docstring (`service.py:273`), `reservation_import.py:33`, `:41`, and the `SegmentItem.survey` / `db_survey` attributes. The UI term is "verified".

**B-M6. `admin_edits/ports.py` paste logic is over-built.**
- `_paste_problems` loops `while found_new` and passes six arguments to `_label_problem`. Cap the loop or document how many passes are expected.
- `_port_for_site` passes a throwaway `{}` counts dict. The mutated `counts` out-parameter in `reservation_import.port`, `ensure_segment` and `place_reservation` should become a return value or a dataclass.
- `SET_CORE_PORT_SQL`, `SITE_OF_END`, `PORT_ENDS` and `CORE_PORTS_SQL` encode the same A/B mapping several ways.

**B-M7. Two history modules.** `history.py` (reservation and core history) and `admin_edits/history.py` (`/api/history`) share a name and both query `data_edits`. `core_history` calls `_visible` per reservation and uses `HTTPException` as control flow; `events()` runs 4 queries per reservation (N+1). `HistoryRow.at: Any` loses the `datetime` type. Rename the first to `reservations/history.py`.

**B-M8. Tests.**
- Test modules import helpers from each other (`test_kmz_upload.py:6-7` from `test_auth` and `test_load_kmz`; `test_reservation_races.py:15` from `test_reservations`). Move helpers to `tests/helpers.py` or conftest fixtures.
- Five test modules define a near-identical `admin` fixture. Put one in conftest.
- `test_reservation_races.py` commits to the real test DB and cleans up with `TRUNCATE users, sites, customers CASCADE`. `make_pending_reservation` runs outside the `try`, so a failure there leaves rows. The `WAITING_SQL` check counts any lock waiter in the database. The winning side of each race is raw SQL, not the service. Only two races are covered; `keep`, `release` and `assign` use the same `_lock` and have no race test.

### Low
- **B-L1.** `auth/router.py:19` hashes `DUMMY_HASH` with argon2 at import time, slowing every import and test collection. Compute it lazily.
- **B-L2.** `auth/router.py:21` raises one shared `BAD_LOGIN` exception instance many times. Use a function.
- **B-L3.** `site_master_router.current` (`:107-122`) sorts in SQL and again in Python, and returns `dict[str, Any]` with no response model.
- **B-L4.** Single-sheet code keeps multi-sheet machinery after the DC List sheet was removed (commit 9b10531): `SHEETS` with one entry, `Literal["sites"]` lists, the "stay staged until no sheet left" logic, the `dc_list` class on `DbSite`, and the one-key loop in `site_master/evaluate.py:evaluate()`. The web client uses some of these field names, so check `schema.d.ts` before removing.
- **B-L5.** Underscore-private helpers imported across modules: `site_master/model.py` `_can_apply`, `_fmt`, `_num`, `_cell_text`; `_json` from legacy `ingest/excel.py` imported by `segment_list.py:19` and `site_master/parse.py:8`. Move `_json` to `checks.py` before legacy code goes.
- **B-L6.** `checks.py` functions possibly used only by legacy `excel_check`: `check_requestor`, `duplicate_names`, `check_known_sites`, and the `REGIONS` misspelling aliases. Low confidence; grep callers first.
- **B-L7.** `reservation_upload.py`: `_flags` uses parameter keys `cust`, `pd`, `gl`, `ad`; `claims` and `sites` are passed to `_reservation_row` and never used; `GROUPS`/`ROW_GROUP` copy the router's `Group` list (third copy); `_dump` falls back to `float(v)` for any non-date type.
- **B-L8.** The `"conflicts"` group may be dead. **Partly verified:** it is listed and checked (`reservation_upload.py:270`, `:393`, router `:17`), but no line was found that sets it. `if r.group in ("conflicts",)` is a one-element tuple. Grep every place a group is set before removing.
- **B-L9.** `reservation_upload.py:9`, `:19`: the module docstring lists parked features. Keep that list in the docs.
- **B-L10.** Advisory lock number `7001` is inline in `close_import`. Name it.
- **B-L11.** `reservation_upload_router.upload` (`:52-53`) shows `ValueError` text but only the class name for other errors. The other routers always show the class name. The router-level broad `except Exception` blocks (`segment_list_router.py:92`, `site_master_router.py:73`, `reservation_upload_router.py:51`) also lose the cause; call `logger.exception` first.
- **B-L12.** `main.py:26-27` runs `configure_logging()` and `check_startup_environment()` at import time, which is why conftest must set env vars first. Use a FastAPI `lifespan` hook.
- **B-L13.** `kmz_router.upload` has a mutable default `folder_ids = []` (harmless under FastAPI, flagged by linters).
- **B-L14.** `reservations/service.py:20`: `TZ = "'Asia/Kuala_Lumpur'"` with embedded quotes, interpolated into f-string SQL. Keep the time zone in one SQL function or view.
- **B-L15.** `segment_list.py:25-26` accepts extra header aliases (`segment`, `km`, `links`). The `sitea` alias is parsed and never used, so the `Site A` column may be dead input. Medium confidence.
- **B-L16.** `environment.py`: `ALLOW_DEV_HEADER == "1"` parsed twice (lines 17, 33); an unset variable is reported as "unsafe", say "missing"; string built with `+` instead of an f-string.
- **B-L17.** Change records are plain dicts mutated in steps (`reservation_upload.py:163-171`, `segment_list.py:249`), leading to `"blocked" not in c` checks. A small dataclass fits.
- **B-L18.** Trailing-underscore names `hash_` (`auth/router.py:38`) and `rows_` (`site_master_router.py:109`); the one-line tuple assignment with a conditional at `create_admin.py:22`.

### Backend files not read
`db.py`, `link_type.py`, `port_label.py`, `ingest/excel.py`, `load_data.py`, `admin_edits/sites.py`, `admin_edits/measurements.py`, `inventory/*`, `loss/*`, `map/*`, `routing/*`, `reservations/router.py`, `reservations/schemas.py`, and most tests (`test_auth`, `test_schema`, `test_load_kmz`, `test_load_data`, `test_create_admin`, `test_loss`, `test_segment_list`, `test_measurements`, `test_reservations`, `test_reservation_upload`, `test_routing`, `test_paste_ports`, `test_admin_edits`, `test_customer_usage`, `test_ingest`, `test_site_master`, `test_api`, `test_map`). `models.py` is covered in section 3.

---

## 2. Web (`web/src`, `web/e2e`)

Overall: newer code is clean and follows the style rules (map and cluster libs, `useReserveBox`, `useCustomerPicker`, `useAuthGate`, `MeasurementDialog`, `PastePortsDialog`, `ReserveBox`, `RoutePlanner`, and the new `useKmzUpload` and `KmzFolderTree`). The debt is in older files and is mostly duplication, not wrong behaviour.

### High

**W-H1. Four upload flows re-implement the same machinery.**
- Only Site master and KMZ have a hook. `SegmentListUpload.tsx` (81-171) and `ReservationUpload.tsx` (212-313) keep staged/busy/error/confirming/result state and handlers inline.
- The "paged rows by group" fetch exists three times with its own stale flag: `SegmentListUpload.Rows` (21-32), `useSheetRows` (`useSiteMasterUpload.ts` 43-79), `ReservationUpload.useRows` (45-56).
- Copied four times: the "Preview of {filename}" card with "Discard preview", the confirm dialog, the `GROUPS` icon and label table, and the "Status or reason" cell (`SegmentListUpload.tsx` 63-66 and `SiteMasterUpload.tsx` 157-160 are identical).
- Fix: `usePagedRows(url, params)`, an `UploadPreviewCard`, and hooks for the other two flows in the `useKmzUpload` shape.

**W-H2. The typed API client is bypassed.**
- 14 `as unknown as` casts (**Verified**). `ReservationUpload.tsx` 7-19 hand-types the whole Reservation workbook API, because those routes have no response models (backend B-H2).
- Hand-written response shapes also in `useRoutePlanner.ts` 5-31, `useSiteMasterUpload.ts` 11-35, `mapLayers.ts` 3-32, `mapHooks.ts` 22-40, `AdminEdit.tsx` 65, `useKmzUpload.ts` 66, 101.
- `api/client.ts` 113-114 (`resAction`) casts `api.post` to build URLs from a template string, defeating types for seven actions.
- Fix: add `response_model` to those backend routes, regenerate `schema.d.ts`, delete the casts and hand types. This is the largest drift risk in the web.

**W-H3. Style-rule debt in older files** (cleanup-session work; counts approximate).
- One-line `if`: `api/client.ts`, `status.ts`, `AdminEdit.tsx` (9 places), `NetworkDetail.tsx`, `ReservationUpload.tsx`, `Reservations.tsx`, `Auth.tsx`, `Upload.tsx`, `upload-parts.tsx`, `Users.tsx`, and e2e `helpers.ts`, `fiber-cut.spec.ts`, `xlsx.ts`.
- `cond && action()`: `AdminEdit.tsx` 113, 207; `SegmentListUpload.tsx` 30; `ReservationUpload.tsx` 52; `NetworkDetail.tsx` 87; `upload-parts.tsx` 89.
- Statements joined with `;`: `upload-parts.tsx` 41-49, `ReservationUpload.tsx` 225, 239, 288, `SegmentListUpload.tsx` 29, 89, `Reservations.tsx` 89, `AssignDialog.tsx` 16, `xlsx.ts` 29-33.
- Nested ternaries: `Reservations.tsx` 25-26 (3 levels), 138; `CoreDrawer.tsx` 131-132; `Users.tsx` 157-159; `Upload.tsx` 31; `NetworkDetail.tsx` 92.
- Short names throughout `AdminEdit`, `Reservations`, `NetworkDetail`, `SegmentListUpload`, `SiteMasterUpload`, `Users`.
- Oversized components with state not in a hook: `App.tsx` (362 lines, 8 components), `Reservations.tsx` (365 lines, four features), `ReservationUpload.tsx` (313 lines), `EditSegmentDialog`, `EditSiteDialog`.
- Fix: one mechanical pass per file group; enforce what oxlint can.

### Medium

**W-M1. Shared UI parts missing or misplaced.** `Dialog` and `Note` live in `upload-parts.tsx` but are used by six non-upload components. `Users.tsx` 68-95 hand-rolls its own `<dialog>` and loses focus return. The red error box class is pasted in 14 places and also defined as `ERROR_CLASS` in three files and `PORT_ERROR_CLASS` in `CoreDrawer.tsx` 153. The form label class is redefined in seven places. Fix: `components/ui/` with `Dialog`, `Note`, `ErrorBanner`, and a form label class or `FormField`.

**W-M2. Format helpers duplicated with different behaviour under one name.**
- `when` in `lib/status.ts:45` (throws on null) and `lib/utils.ts:4` (null-safe, no `hourCycle`) (**Verified**).
- `Intl.DateTimeFormat` built in 7 places. `ReservationUpload.tsx` 39 uses UTC, against the Kuala Lumpur display rule.
- `plural` in `utils.ts` and `mapLayers.ts:121` with different number formatting. `formatKm` in `KmzUpload.tsx` and `RoutePlanner.tsx` with different output.
- Fix: one `lib/format.ts`.

**W-M3. Hash routing split over three hooks** (`useInventory` owns `#segment=`, `useRoutePlanner` owns `#route=`, `useDashboardView` owns `#users`). Each calls `history.replaceState` and clears another's hash, so the result depends on effect order. Fix: one `lib/hash.ts` or `useHashState`.

**W-M4. Six or more variants of "fetch in an effect with a stale flag".** `useLoad` already exists but is private to `Reservations.tsx`. Move it to `lib/` and use it everywhere.

**W-M5. Dead interaction in the UI.** `App.tsx:265` passes `onSite={() => {}}` (**Verified**). `NetworkMap.tsx` 114-116 tells keyboard users to "Tab to a chip or site and press Enter to select", but site buttons (`MapSites.tsx` 34) do nothing on the Inventory map. Wire them or make sites non-interactive and drop the prop.

**W-M6. Map libs: circular type imports and magic numbers.** `mapGeometry.ts` and `clusterLayout.ts` import types from each other and from the `useNetworkMap` hook. `NAME_CHAR_PX = 6.5`, `7.2` and the `reservedAreas` pixel boxes guess font metrics and toolbar size. `useNetworkMap.ts` has 4 `exhaustive-deps` disables. The SVG fallback itself is deliberate. Fix: `mapTypes.ts`; measure toolbar and key rectangles.

**W-M7. `App.tsx` and `useInventory` are overloaded.** `useInventory` returns about 25 members and builds a new `planner` object each render (201-207). `InventoryView` takes 10 props. Non-null assertions at 92 and 202. Render-phase `setState` in `useInventory` 144-153, `useCustomerHighlight` 59-61, `CoresTable` 160-165, `useClusterLayer`. Fix: split into selection, route and detail hooks; memoize `planner`.

**W-M8. `Reservations.tsx` duplication.** `Card` and `ApprovalRow` repeat the same summary lines (compare 104-112 with 324-327) and the reason-input block. Extract `ReservationSummary`.

**W-M9. UI rule breaks.**
- Possible subtext under titles or controls: `SegmentListUpload.tsx` 165; `SiteMasterUpload.tsx` 240, 256; `ReservationUpload.tsx` 87, 304; `Users.tsx` 25, 84, 113; `Auth.tsx` 87, 93; `AssignDialog.tsx` 32; `AdminEdit.tsx` 252-254; `Reservations.tsx` 97-100; `KmzUpload.tsx` 77-80. Some may be "a fact that appears nowhere else"; review each.
- `ReservationUpload.tsx` 179 says "loss measurement(s)"; the rule is "Measured loss".
- `.later` CSS class (`index.css` 133) is left over from the banned "Later" tab.

**W-M10. e2e assertions that cannot fail.**
- `fiber-cut.spec.ts:29` expects `loss-alert` to have count 0; no element in `src` has that test id (**Verified**).
- Negative checks for long-removed features: `fiber-cut.spec.ts` 27; `route.spec` 14, 33, 40, 59, 73; `shell.spec` 40, 42-43.
- `reserve-box.spec.ts` 102-104 loops over `.all()` and passes on an empty list.
- `admin-edit.spec.ts` 57-68 and 326 skip themselves when DEV data lacks the needed state.
- Fix: delete the dead-feature checks or keep one "removed UI stays removed" test; assert count above 0 before loops.

**W-M11. e2e tests flaky or tied to seed data by design.**
- Fixed sleeps: 7 `waitForTimeout` calls (**Verified**) plus `settle` sleeps, mostly in `map.spec` and `customer-mode.spec`. Use `expect.poll` or map idle events.
- Hard-coded seed numbers: `DRAWN = 22`, "Missing 17", "2 segments not on the map", `toBe(24)` (`admin-edit.spec` 111), segment ids 1 and 5, request ids in `customer-mode.spec`.
- Shared DEV DB with parallel workers: `reserve-box` and `route.spec` book from the same segments (`route.spec` 99 says so). `reserve-box.spec` 118 withdraws with `.first()`, which may hit another test's reservation. `auth.spec` creates an `e2e${Date.now()}` user each run and never removes it. `map.spec` 396-437 moves a site and restores it in `finally`; a crash leaves bad coordinates.
- Fix: read expected counts from the API, give each test its own segments, run shared-state tests serially.

**W-M12. e2e tests that mirror the code.** `customer-mode.spec.ts` 44-52 re-implements `requestOptionText` and `shortDate`, so a bug in one passes in both. `admin-edit.spec.ts` imports `portLabel` and runs a pure unit test (166-192) inside Playwright. `upload.spec.ts` 332 asserts "1 segment lines drawn", locking in a plural bug. `admin-edit.spec.ts` 235 is titled "reason required" although reasons are optional since 5 Nov 2026. The segment lookup helper is repeated in six specs.

### Low
- **W-L1. Dead CSS:** `.hint`, `.link`, `.later`, `.core-available:hover`, part of the `.core` grid, and unused shadcn token aliases in `index.css` 5-90. Medium confidence.
- **W-L2. Misnamed files:** `LossCard.tsx` holds only `Blank`; `FindCard.tsx` holds `FreeBadge` and `MapFilters`; `NetworkDetail.tsx` holds diagram, chain and cores table. `NotSurveyed`, `isShort`, `surveyed` should say "verified" (API field names stay).
- **W-L3. Dead fields and exports:** `SegmentFilter.q` (always `""`), `Found.km` (low confidence), `inputCls` (used once), `AdminEdit.FIELD.route_type` (route type is never edited), and unused exports `EditHistory`, `ResHistory`, `Leg`, `Basemap`, `CameraUpdate`, `PMTILES`, `GLYPH_PROBE`.
- **W-L4. New KMZ files (work in progress):** `DEFAULT_FOLDER = "propose route"` copies the backend default (`useKmzUpload.ts` 8); `{folder: ""}` meaning "every line" is an unwritten contract (69); `pick` and `preview` repeat the reset steps; `apply` has no busy flag, so a double click sends twice (same in `SegmentListUpload`); "{total} segment lines drawn" is wrong for 1; `KmzFolderTree` has no tree semantics (`role="tree"`).
- **W-L5. "Toggle in a Set" helper written five times:** `Reservations.Card`, `AssignDialog`, `MapPanels`, `useReserveBox`, `useKmzUpload`.
- **W-L6. Small accessibility and consistency items:** nested same-label regions in `RoutePlanner.tsx` 217-218; `Header.tsx` takes `me: Me | null` though it only renders when signed in; `main.tsx` quote and semicolon style differs; `MIN_W` declared after use in `NetworkDetail.tsx`; hand-rolled tablist keys in `Upload.tsx`.
- **W-L7. e2e hygiene:** about 20 screenshots written every run, some duplicated; unbraced `while` in `helpers.openCore`.

### Checked and fine
Dual SVG and MapLibre rendering (deliberate); `DEV_USERS` gated on `import.meta.env.DEV`; tab set matches the role model and has no Reserve tab; core status words and "Calculated loss"/"Measured loss" labels are correct (except W-M9); Inventory layout matches the CLAUDE.md summary.

### Web files not read
`schema.d.ts` (generated), `malaysiaOutline.json`, config and test setup files, `package.json`, oxlint config, `docs/DESIGN.md`.

---

## 3. Docker and database

### High

**D-H1. `models.py` has drifted from the migrations (Verified).** `models.py:241` allows upload kinds `excel`, `kmz`, `site_master`. The database constraint (`0001_baseline.py:557`) also allows `segment_list`, a live feature. Fix: add `"segment_list"` to the model; run `alembic check` before shipping.

**D-H2. The compose file is a dev stack, but the rules say it runs unchanged on production.**
- `docker-compose.yml:23` runs `uvicorn --reload` (**Verified**), overriding the Dockerfile `CMD`.
- `./api` and `./web` are bind-mounted over the images (`:24`, `:44-46`).
- `web/Dockerfile:15` runs the Vite dev server.
- No `restart:` policy, no production override, no web build stage.
- Fix: add a small production override (no mounts, no reload, `restart: unless-stopped`, built web assets), or record in `architecture.md` that production runs the dev stack on purpose. This is an owner decision.

**D-H3. `SESSION_SECRET` is a placeholder that nothing reads (Verified).** `.env.example:13` has `SESSION_SECRET=change-me`. No code reads it or any `SMTP_*` variable. Sessions use a hashed cookie token. Fix: remove the dead variables from `.env.example`, or add them to `SECRETS_THAT_MUST_BE_CHANGED` if a feature will use them.

**D-H4. Most foreign-key columns have no index.** Missing on: `reservation_cores.core_id`, `core_holds.reservation_id`, `reservations.customer_id`, `planner_id`, `unassigned_segment_id`, `release_cores.core_id`, `assign_cores.core_id`, `route_segments.segment_id`, `upload_rows.upload_id`, `cores.port_a_id`, `cores.port_b_id`, `reservation_events.user_id`, `routes.site_a_id`, `routes.site_b_id`. Several sit under `reservation_state_v`, `reservation_unassigned_v` and the My reservations list. Fix: one migration `0005` adding them, with matching `Index(...)` in `models.py`.

### Medium

**D-M1. Views, append-only triggers and `forbid_change` exist only as raw SQL in `0001_baseline.py`.** `models.py` knows nothing of them, so `alembic check` cannot see drift. Fix: a pointer comment in `models.py` and a test that the triggers exist (query `pg_trigger`). Do not move them into the ORM.

**D-M2. Constraint names differ between model and database.** Unnamed `UniqueConstraint`s at `models.py:128` and `:144`; the database has `route_routes_*` names left from an old table name. Name them in the model or rename in a migration.

**D-M3. `segments.region` is dead but still constrained.** A `ponytail:` note at `models.py:102` says it is unused, yet `segments_region_ck` (`:94`) still enforces four values. `routes.site_pair_ix`, `Site.lrd_site_id` and `Site.active` may also be leftovers (not traced). Grep, then drop.

**D-M4. A core's ports are not tied to its segment's end sites.** `cores.port_a_id` and `port_b_id` (`models.py:148-149`) can point at any port. Check in the service layer that each port is at one of the segment's sites and that A and B differ.

**D-M5. Image pinning is mixed.** `postgis/postgis` is pinned by digest; `python:3.14.8-slim`, `node:24.22.1-slim` and `protomaps/go-pmtiles:v1.31.2` (`scripts/get-tiles.sh:30`) use tags only. Pin by digest or record the choice in `architecture.md`.

**D-M6. Containers run as root and `.dockerignore` files are thin.** Neither Dockerfile sets `USER`. `api/.dockerignore` lists only `__pycache__` and `.venv`, so `COPY . .` puts `api/data/` (real data files, git-ignored) into the image. `web/.dockerignore` lets `public/map/malaysia.pmtiles` (about 600 MB), fonts, `test-results` and `playwright-report` into the build context. Fix: add `data/`, `*.pmtiles`, `test-results`, `playwright-report`, `.pytest_cache`, `.git`.

**D-M7. Database requires a reason that the rules make optional.** `reservation_events_corrected_ck` (`models.py:205-207`) and `data_edits_reason_ck` (`:291`) reject blank reasons. That is fine only if every write path stores "no reason given" for a blank reason, including seeds and `load_data`. Confirm it.

### Low
- **D-L1.** Hand-rolled `Geometry` type (`models.py:25-32`) is acceptable without `geoalchemy2`; `self.kind, self.srid = kind, srid` breaks one-step-per-line.
- **D-L2.** `models.py` style: helpers `_id`, `_fk`, `_in`; lines over 120 characters at `:78`, `:167`, `:257`, `:275`. Cleanup session.
- **D-L3.** `.env.example` repeats the DB password in `POSTGRES_PASSWORD` and `DATABASE_URL`. Optional: build `DATABASE_URL` in compose.
- **D-L4.** `.env.example` defaults to `APP_ENV=development` and `ALLOW_DEV_HEADER=1`. Safe, because the API refuses to start outside development with the dev header on, but the file should say a production `.env` must set `APP_ENV=production`.
- **D-L5.** API port 8000 is published on all interfaces (`docker-compose.yml:25-27`). Bind to `127.0.0.1` unless remote access is intended.
- **D-L6.** `db.py` is minimal and fine; timestamps are `timestamptz`; the Kuala Lumpur zone is applied in the views.
- **D-L7.** Migrations are clean: the squashed baseline is justified; `0002`-`0004` are small and reversible; per-site port uniqueness, the `circuit_id` drop, the one-segment-per-site-pair index (`LEAST/GREATEST`) and the `core_holds` primary-key lock all match the rules.
- **D-L8.** `scripts/e2e-changed.mjs:12` regex `/Map|map|basemap|clusterLayout/` is unanchored and can match unrelated paths.
- **D-L9.** `scripts/get-tiles.sh` uses GNU-only `date -d yesterday` and depends on a daily Protomaps build that is not pinned.
- **D-L10.** Compose `additional_contexts: certs: ./certs` needs the folder; it is committed (`certs/README.md`, **Verified**), so no action.

### Docker and database files not read
`docs/architecture.md`, `docs/PRD.md`, `api/requirements*.lock`, `.gitignore`, `web/package.json`. No root `.dockerignore` exists. Code that uses the tables was not read, so "no deletion" and raw-SQL claims were checked against the schema only.

---

## Suggested order

1. **Quick, low-risk fixes:** D-H1 (`segment_list` in `models.py`), D-H3 (remove dead env vars), D-M6 (`.dockerignore` entries), B-M5 assert-to-404, W-M10 (delete assertions that cannot fail), W-M9 "Measured loss" wording.
2. **Owner decision:** D-H2 (production compose or documented dev stack), D-L5 (port binding).
3. **One migration:** D-H4 indexes, with D-M2 and D-M3 if wanted.
4. **Upload consolidation, backend then web:** B-H2 with response models, then W-H2 (regenerate `schema.d.ts`, drop casts), then W-H1.
5. **Cleanup session:** B-H1, B-H3, W-H3 and the remaining Medium and Low items.
6. **Audit gaps:** run a second pass on the unread backend packages and tests listed in section 1.
