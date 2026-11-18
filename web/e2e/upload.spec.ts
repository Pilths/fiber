import { expect, test, type Page } from "@playwright/test";
import { signIn } from "./helpers";
import { xlsx, zip, type Sheet } from "./xlsx";

// Admin Upload page (TASK-045, TASK-083). Workbooks are synthetic and built per run, so the suite repeats against the
// same dev database: site master applies are mocked or discarded, the reservation uses a fresh customer and is
// released afterwards, and closing the import is mocked (it cannot be reopened).
test.use({ viewport: { width: 1440, height: 900 } });
test.describe.configure({ mode: "serial" });

const stamp = Date.now();
const XLSX = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
const SITE_HEAD = ["SITE_NAME", "LATITUDE_IN_DECIMAL", "LONGITUDE_IN_DECIMAL", "REGION", "SITE_TYPE"];
// The DC List sheet was dropped on 16 Nov 2026: a workbook that still has one shows only the Sites sheet.
const DC_HEAD = ["No", "State", "DC NAME / LINK", "LRD", "lat", "long"];
const RES_HEAD = [
  "Region", "Nodes", "Distance(KM)", "Core Secured", "Expected CV Ready", "Port Info", "Contractor", "Remark",
  "Fiber core monitoring", "Fiber montiored Y/N/WIP", "Fiber core requestor", "Fiber core request date", "Aging(days)",
  "No of core requested", "Core assignment", "Core balnce", "Core status",
];
const SEGMENT = "DEV Kuala Lumpur DC-DEV Kuantan Hut"; // dev segment 6, not used by other specs
const resRow = (customer: string | null) => [
  "East Coast", SEGMENT, null, null, null, "raw", "E2E Vendor", "e2e", null, "Y", customer, null, null, 1, null, null, null,
];

const SITE_ROWS = [
  SITE_HEAD,
  ["E2E Site One", 3.2, 101.5, "Central", "Tower"],
  ["E2E Site Two", "TBA", "TBA", "Central", "Tower"],
];

const file = (name: string, sheets: Sheet[]) => ({ name, mimeType: XLSX, buffer: xlsx(sheets) });
const nav = (page: Page) => page.getByRole("navigation", { name: "Main" });

type UploadTab = "Sites (Excel)" | "Segments (Excel)" | "Route lines (KMZ)" | "Reservations (Excel)";

async function openUpload(page: Page, tab: UploadTab) {
  await signIn(page, "admin1");
  await nav(page).getByRole("button", { name: "Upload" }).click();
  await page.getByRole("tab", { name: tab }).click();
}

// Missing 17: the 12 DEV sites plus the 5 DEV data centres (2 plus 3 cluster DCs), which belong to the Sites sheet.
test("site master preview: counts, 10% drop override", async ({ page }) => {
  await openUpload(page, "Sites (Excel)");
  await page.getByLabel("Upload a site master workbook").setInputFiles(file(`e2e-sites-${stamp}.xlsx`, [
    { name: "Cover", rows: [["synthetic test file"]] },
    { name: "Site Location", rows: SITE_ROWS },
  ]));
  const preview = page.getByTestId("sm-preview");
  await expect(preview).toBeVisible();
  const sites = page.getByTestId("sheet-sites");
  await expect(sites).toContainText("found as worksheet “Site Location”, 2 rows");
  await expect(sites.getByRole("button", { name: "Added 1" })).toBeVisible();
  await expect(sites.getByRole("button", { name: "Problem 1" })).toBeVisible();
  await expect(sites.getByRole("button", { name: "Missing 17" })).toBeVisible();
  await expect(sites).toContainText("Blocked: this sheet will not be applied unless you override");
  await expect(sites).toContainText("limit is 10%");

  await sites.getByRole("button", { name: "Problem 1" }).click();
  await expect(sites.getByRole("table")).toContainText("E2E Site Two");
  await expect(sites.getByRole("table")).toContainText("missing coordinates");
  await expect(sites.getByRole("table")).toContainText("Needs review");
  await expect(sites.getByRole("columnheader"))
    .toHaveText(["Row", "Site name", "Latitude", "Longitude", "Status or reason"]);
  const two = sites.getByRole("row", { name: /E2E Site Two/ });
  await expect(two.getByRole("cell")).toHaveText(["3", "TBA", "TBA", /^Needs review.*missing coordinates/]);
  await sites.getByRole("button", { name: "Missing 17" }).click();
  await expect(sites.getByRole("table")).toContainText("in use, stays active");

  const apply = sites.getByRole("button", { name: "Apply Site Location…" });
  await expect(apply).toBeDisabled();
  await expect(sites).toContainText("Tick Override to apply this sheet.");
  await sites.getByLabel(/^Override/).check();
  await expect(apply).toBeDisabled();
  await expect(sites).toContainText("Enter a reason for the override.");
  await sites.getByLabel("Reason for the override (required)").fill("E2E: smaller test file");
  await expect(apply).toBeEnabled();
  await sites.getByLabel(/^Override/).uncheck();
  await sites.getByRole("button", { name: "Added 1" }).click();
  await page.evaluate(() => scrollTo(0, 0));
  await page.screenshot({ path: "e2e/screenshots/upload-site-master-preview.png", fullPage: true });
  await page.screenshot({ path: "e2e/screenshots/upload-clean-site-master.png", fullPage: true });
  // never applied: would deactivate nothing, but keep the dev data as seeded
  await preview.getByRole("button", { name: "Discard preview" }).click();
});

test("site master add and update only: no Missing rows, no row-count block (not applied)", async ({ page }) => {
  await openUpload(page, "Sites (Excel)");
  const addOnly = page.getByLabel("Add and update only");
  await expect(addOnly).not.toBeChecked();
  await addOnly.check();
  await page.getByLabel("Upload a site master workbook").setInputFiles(file(`e2e-addonly-${stamp}.xlsx`, [
    { name: "Site Location", rows: SITE_ROWS },
  ]));
  const preview = page.getByTestId("sm-preview");
  await expect(preview).toContainText("Add and update only: sites not in this file are kept.");
  const sites = page.getByTestId("sheet-sites");
  await expect(sites.getByRole("button", { name: "Missing 0" })).toBeVisible();
  await expect(sites).not.toContainText("limit is 10%");
  await expect(sites.getByLabel(/^Override/)).toHaveCount(0);
  await expect(sites.getByRole("button", { name: "Apply Site Location…" })).toBeEnabled();
  await expect(addOnly).toBeChecked(); // the choice stays for the next file
  await preview.getByRole("button", { name: "Discard preview" }).click(); // never applied: the dev data stays as seeded
});

test("site master apply: DC List sheet ignored, result shown, preview survives a tab change (apply mocked)", async ({ page }) => {
  await openUpload(page, "Sites (Excel)");
  await page.getByLabel("Upload a site master workbook").setInputFiles(file(`e2e-both-${stamp}.xlsx`, [
    { name: "Site Location", rows: SITE_ROWS },
    { name: "DC List", rows: [DC_HEAD, [1, "Penang", "E2E DC Beta", "DEV Penang Tower", 5.41, 100.33]] },
  ]));
  const sites = page.getByTestId("sheet-sites");
  await expect(sites).toBeVisible();
  await expect(page.getByTestId("sheet-dcs")).toHaveCount(0);
  await expect(page.getByTestId("sm-preview")).not.toContainText("DC List");
  await sites.getByLabel(/^Override/).check();
  await sites.getByLabel("Reason for the override (required)").fill("E2E: smaller test file");

  // Switching the top tab keeps the staged preview and its choices.
  await nav(page).getByRole("button", { name: "Inventory" }).click();
  await expect(page.getByTestId("sm-preview")).toBeHidden();
  await nav(page).getByRole("button", { name: "Upload" }).click();
  await expect(sites.getByLabel(/^Override/)).toBeChecked();
  await expect(sites.getByLabel("Reason for the override (required)")).toHaveValue("E2E: smaller test file");

  // The dev site list must stay as seeded, so the apply call is mocked; the request body is checked.
  const bodies: unknown[] = [];
  const counts = { added: 1, changed: 0, deactivated: 0, kept_active: 4, protected_kept: 0, skipped: 0 };
  await page.route("**/api/admin/site-master/uploads/*/apply", async (route) => {
    bodies.push(route.request().postDataJSON());
    const sheets = { sites: { applied: true, ...counts } };
    await route.fulfill({ json: { upload_id: 1, warnings: ["E2E warning"], complete: true, sheets } });
  });
  await sites.getByRole("button", { name: "Apply Site Location…" }).click();
  const confirm = page.getByRole("dialog", { name: "Apply Site Location?" });
  await confirm.getByRole("button", { name: "Apply", exact: true }).click();
  const result = page.getByTestId("sm-result");
  await expect(result).toContainText("Site master applied");
  await expect(result).toContainText("Site Location: 1 added, 0 changed, 0 set inactive");
  await expect(result).not.toContainText("renamed");
  await expect(result).not.toContainText("DC List");
  await expect(result).toContainText("E2E warning");
  await expect(page.getByTestId("sm-preview")).toHaveCount(0);
  expect(bodies).toEqual([{ sheets: ["sites"], override_drop: { sites: true }, reason: "E2E: smaller test file" }]);
});

const SL_HEAD = ["Link", "Distance", "Route", "Section", "Type"];

test("segment list preview: header found, problem rows in the table, nothing to apply", async ({ page }) => {
  await openUpload(page, "Segments (Excel)");
  await page.getByLabel("Upload a segment list").setInputFiles(file(`e2e-segments-${stamp}.xlsx`, [
    { name: "Cover", rows: [["synthetic test file"]] },
    {
      name: "Links",
      rows: [["title row"], SL_HEAD, ["ZZQA-ZZQB", 12.5, "R1", "N-C", "Trunk"], ["bad link", "x", null, null, "Ring"]],
    },
  ]));
  const preview = page.getByTestId("sl-preview");
  await expect(preview).toContainText(`Preview of e2e-segments-${stamp}.xlsx`);
  await expect(preview).toContainText("Found as worksheet “Links”, 2 rows");
  await expect(preview.getByRole("button", { name: "New 0" })).toBeVisible();
  await expect(preview.getByRole("button", { name: "Problem 2", pressed: true })).toBeVisible();
  const table = preview.getByRole("table", { name: "Segment list: Problem rows" });
  await expect(table.getByRole("columnheader"))
    .toHaveText(["Row", "Link", "Distance (km)", "Route", "Section", "Status or reason"]);
  const one = table.getByRole("row", { name: /ZZQA-ZZQB/ });
  await expect(one.getByRole("cell"))
    .toHaveText(["3", "12.500", "R1", "N-C", /^Needs review.*site ZZQA is not in the dashboard/]);
  await expect(table.getByRole("row", { name: /bad link/ })).toContainText("distance is not a number");
  await expect(preview.getByRole("button", { name: "Apply segment list…" })).toBeDisabled();
  await expect(preview).toContainText("Nothing new or changed to apply.");
  await page.evaluate(() => scrollTo(0, 0));
  await page.screenshot({ path: "e2e/screenshots/upload-segment-list-preview.png", fullPage: true });
  await preview.getByRole("button", { name: "Discard preview" }).click();
  await expect(preview).toHaveCount(0);
});

test("segment list without the Link and Distance headers is blocked: no Apply", async ({ page }) => {
  await openUpload(page, "Segments (Excel)");
  const badSheet = { name: "Sheet1", rows: [["Nodes", "km?"], ["A-B", 1]] };
  await page.getByLabel("Upload a segment list").setInputFiles(file(`e2e-segments-bad-${stamp}.xlsx`, [badSheet]));
  const preview = page.getByTestId("sl-preview");
  await expect(preview.getByRole("alert")).toContainText("This file will not be applied");
  await expect(preview.getByRole("alert")).toContainText("No worksheet has the expected headers: Link, Distance");
  await expect(preview.getByRole("button", { name: /^Apply/ })).toHaveCount(0);
  await preview.getByRole("button", { name: "Discard preview" }).click();
});

test("segment list apply: confirm counts, result note, preview survives a tab change (calls mocked)", async ({ page }) => {
  // Dev sites have spaces in their names, so no real link can be New or Changed: the upload, rows and apply are mocked.
  await openUpload(page, "Segments (Excel)");
  const id = 987654;
  await page.route("**/api/admin/segment-list/uploads", (r) => r.fulfill({ status: 201, json: {
    upload_id: id, filename: "e2e-mock.xlsx", sheet_name: "Links", found: true, block_reason: null,
    counts: { rows: 3, new: 1, changed: 1, unchanged: 0, problem: 1 } } }));
  const row = (number: number, group: string, link: string, extra: object = {}) => ({
    id: number,
    row_number: number,
    sheet_name: "Links",
    group,
    status: "ready",
    reason: null,
    raw: {},
    parsed: {
      link,
      site_a: link.slice(0, 4),
      site_b: link.slice(5),
      distance_km: "10.000",
      route: "R2",
      section: null,
      type: "Metro",
    },
    changes: [],
    edited_in_dashboard: false,
    segment_id: null,
    ...extra,
  });
  const changedRow = row(3, "changed", "CCCC-DDDD", {
    segment_id: 9,
    edited_in_dashboard: true,
    changes: [
      { field: "distance_km", old: "9.000", new: "10.000", protected: false, note: null },
      { field: "route", old: "R1", new: "R2", protected: true, note: "edited in dashboard, file differs" },
    ],
  });
  const rowsOfGroup = (group: string | null) => {
    if (group === "new") {
      return [row(2, "new", "AAAA-BBBB")];
    }
    if (group === "changed") {
      return [changedRow];
    }
    return [];
  };
  await page.route(`**/api/admin/segment-list/uploads/${id}/rows*`, (route) => {
    const group = new URL(route.request().url()).searchParams.get("group");
    const items = rowsOfGroup(group);
    return route.fulfill({ json: { total: items.length, page: 1, page_size: 100, items } });
  });
  let body: string | null = "unset";
  await page.route(`**/api/admin/segment-list/uploads/${id}/apply`, (r) => {
    body = r.request().postData();
    const applied = { created: 1, changed: 1, protected_kept: 1, skipped: 1, warnings: ["E2E segment warning"] };
    return r.fulfill({ json: { upload_id: id, ...applied } });
  });
  const linksSheet = { name: "Links", rows: [SL_HEAD] };
  await page.getByLabel("Upload a segment list").setInputFiles(file("e2e-mock.xlsx", [linksSheet]));
  const preview = page.getByTestId("sl-preview");
  await expect(preview.getByRole("button", { name: "New 1", pressed: true })).toBeVisible();
  await expect(preview.getByRole("table")).toContainText("AAAA-BBBB");
  await preview.getByRole("button", { name: "Changed 1" }).click();
  const changed = preview.getByRole("row", { name: /CCCC-DDDD/ });
  await expect(changed).toContainText("Distance (km): 9.000 → 10.000");
  await expect(changed).toContainText("Route: R1 → R2");
  await expect(changed).toContainText("kept: edited in dashboard");

  await page.getByRole("tab", { name: "Reservations (Excel)" }).click();
  await expect(preview).toBeHidden();
  await page.getByRole("tab", { name: "Segments (Excel)" }).click();
  await expect(preview).toContainText("Preview of e2e-mock.xlsx");

  await preview.getByRole("button", { name: "Apply segment list…" }).click();
  const dialog = page.getByRole("dialog", { name: "Apply segment list?" });
  await expect(dialog).toContainText("1 new, 1 changed, 1 need review and are skipped.");
  await dialog.getByRole("button", { name: "Apply", exact: true }).click();
  await expect(dialog).toHaveCount(0);
  const result = page.getByTestId("sl-result");
  await expect(result).toContainText("Segment list applied");
  await expect(result).toContainText("1 created, 1 changed, 1 dashboard edits kept, 1 skipped.");
  await expect(result).toContainText("E2E segment warning");
  await expect(preview).toHaveCount(0);
  expect(body).toBeNull();
});

test("reservation workbook: preview, confirm, re-upload shows Already imported", async ({ page }) => {
  await openUpload(page, "Reservations (Excel)");
  const customer = `E2E Customer ${stamp}`;
  const wb = file(`e2e-res-${stamp}.xlsx`, [
    { name: "Reservation", rows: [RES_HEAD, ["E2E group"], resRow(customer), resRow(null)] },
    { name: "Monitoring", rows: [["synthetic"]] },
  ]);
  const input = page.getByLabel("Upload a Reservation workbook");
  await input.setInputFiles(wb);
  const preview = page.getByTestId("ru-preview");
  await expect(preview).toBeVisible();
  const res = page.getByTestId("ru-reservations");
  await expect(res).toContainText("Reservations to import (1)");
  const row = res.getByRole("row", { name: new RegExp(customer) });
  await expect(row).toContainText(SEGMENT);
  await expect(row).toContainText("count only 1");
  await expect(row).toContainText("E2E group");
  const warnings = preview.getByRole("list", { name: "Warnings" });
  await expect(warnings).toContainText("Sheets left out of this upload");
  await expect(warnings).toContainText("Monitoring");
  await expect(warnings).toContainText("no reserved date");
  const groups = page.getByTestId("ru-groups");
  await groups.getByRole("button", { name: "Rejected 1" }).click();
  await expect(groups.getByRole("table")).toContainText("blank requestor");
  await page.evaluate(() => scrollTo(0, 0));
  await page.screenshot({ path: "e2e/screenshots/upload-reservations-preview.png", fullPage: true });
  await page.screenshot({ path: "e2e/screenshots/upload-clean-reservations.png", fullPage: true });

  await preview.getByRole("button", { name: "Confirm import…" }).click();
  const dialog = page.getByRole("dialog", { name: "Confirm this upload?" });
  await expect(dialog).toContainText("Import 1 reservation as approved.");
  await dialog.getByRole("button", { name: "Confirm", exact: true }).click();
  const result = page.getByTestId("ru-result");
  await expect(result).toContainText("Upload confirmed");
  await expect(result).toContainText("1 reservation imported");

  await input.setInputFiles(wb);
  await expect(page.getByTestId("ru-reservations")).toContainText("Reservations to import (0)");
  await page.getByTestId("ru-groups").getByRole("button", { name: "Already imported 1" }).click();
  await expect(page.getByTestId("ru-groups").getByRole("table")).toContainText("already imported as reservation #");
  await preview.getByRole("button", { name: "Discard preview" }).click();

  // Clean up: release the count-only reservation so segment 6 keeps its free cores for the next run.
  const mine = await (await page.request.get("/api/reservations")).json() as { id: number; customer: string }[];
  const r = mine.find((x) => x.customer === customer);
  expect(r).toBeTruthy();
  expect((await page.request.post(`/api/reservations/${r!.id}/release`, { data: { cores: [] } })).ok()).toBe(true);
});

test("close reservation import needs a reason, then shows the closed state (close call mocked)", async ({ page }) => {
  await openUpload(page, "Reservations (Excel)");
  const sw = page.getByTestId("import-switch");
  await expect(sw).toContainText("Import open");
  await sw.getByRole("button", { name: "Close reservation import…" }).click();
  const dialog = page.getByRole("dialog", { name: "Close reservation import?" });
  await expect(dialog.getByLabel("Reason (required)")).toBeFocused();
  await dialog.getByRole("button", { name: "Close import" }).click();
  await expect(dialog.getByRole("alert")).toHaveText("Enter a reason for closing the import.");
  await dialog.getByLabel("Reason (required)").fill("E2E: dashboard is now the source of truth");
  await page.evaluate(() => scrollTo(0, 0));
  await page.screenshot({ path: "e2e/screenshots/upload-close-dialog.png" });

  // The real switch is one-time and cannot be reopened, so the dev database is never closed: the POST is mocked.
  let posted: unknown = null;
  await page.route("**/api/admin/reservation-import/close", async (route) => {
    posted = route.request().postDataJSON();
    const reason = "E2E: dashboard is now the source of truth";
    await route.fulfill({ json: { closed: true, closed_at: "2026-10-26T02:00:00Z", closed_by: "admin1", reason } });
  });
  await dialog.getByRole("button", { name: "Close import" }).click();
  expect(posted).toEqual({ reason: "E2E: dashboard is now the source of truth" });
  await expect(dialog).toHaveCount(0);
  await expect(sw)
    .toContainText("Reservation import closed on 26 Oct 2026, 10:00 by admin1: E2E: dashboard is now the source of truth");
  await expect(sw.getByRole("button")).toHaveCount(0);
});

test("planner does not see the Upload tab", async ({ page }) => {
  await signIn(page, "planner1");
  await expect(nav(page).getByRole("button", { name: "Upload" })).toHaveCount(0);
  expect((await page.request.get("/api/admin/reservation-import")).status()).toBe(403);
});

// A KMZ shaped like the real files: site pins and an "ex infra" line are ignored, only "propose route" is read.
// The line runs from DEV Kuala Lumpur DC to DEV Cyberjaya DC with a bend. Preview is real; apply is mocked so the
// dev road shape of that segment is not replaced.
function kmz(folder: string) {
  const path = "101.6869,3.139,0 101.70,3.03,0 101.65,2.9213,0";
  const kml = `<?xml version="1.0" encoding="UTF-8"?><kml xmlns="http://www.opengis.net/kml/2.2"><Document><Folder>
<name>Asbuilt Cable E2E</name>
<Folder><name>site</name><Placemark><name>KL</name><Point><coordinates>101.6869,3.139,0</coordinates></Point></Placemark></Folder>
<Folder><name>ex infra</name><Placemark><LineString><coordinates>101.6869,3.139,0 101.65,2.9213,0</coordinates></LineString></Placemark></Folder>
<Folder><name>${folder}</name><Placemark><name>Untitled Path</name><LineString><coordinates>${path}</coordinates></LineString></Placemark></Folder>
</Folder></Document></kml>`;
  return { name: `e2e-${stamp}.kmz`, mimeType: "application/vnd.google-earth.kmz", buffer: zip([["doc.kml", kml]]) };
}

async function openKmzTree(page: Page) {
  await openUpload(page, "Route lines (KMZ)");
  await page.getByLabel("Upload a KMZ file").setInputFiles(kmz("propose route"));
  return page.getByRole("group", { name: "Folders" });
}

test("Route lines (KMZ): preview lists the segment to draw, apply shows the count (apply mocked)", async ({ page }) => {
  const tree = await openKmzTree(page);
  await expect(tree.getByRole("checkbox", { name: /propose route/ })).toBeChecked();
  await page.getByRole("button", { name: "Preview", exact: true }).click();
  const preview = page.getByTestId("kmz-preview");
  await expect(preview).toContainText("1 line in folder “propose route”");
  const toDraw = preview.getByRole("table", { name: "Segments to draw" });
  const row = toDraw.getByRole("row", { name: /DEV Kuala Lumpur DC - DEV Cyberjaya DC/ });
  await expect(row).toBeVisible();
  await page.screenshot({ path: "e2e/screenshots/upload-kmz-preview.png", fullPage: true });
  await page.route("**/api/admin/kmz/uploads/*/apply", (route) => route.fulfill({ json: { upload_id: 1, shaped: 1 } }));
  await preview.getByRole("button", { name: "Apply KMZ…" }).click();
  await page.getByRole("dialog", { name: "Apply KMZ?" }).getByRole("button", { name: "Apply" }).click();
  await expect(page.getByTestId("kmz-result")).toContainText("1 segment line drawn on the map.");
  await expect(preview).toHaveCount(0);
});

test("Route lines (KMZ): folder tree ticks children, disables empty folders and needs a tick to preview", async ({ page }) => {
  const tree = await openKmzTree(page);
  const parent = tree.getByRole("checkbox", { name: /Asbuilt Cable E2E/ });
  const exInfra = tree.getByRole("checkbox", { name: /ex infra/ });
  const proposeRoute = tree.getByRole("checkbox", { name: /propose route/ });
  const previewButton = page.getByRole("button", { name: "Preview", exact: true });
  await expect(tree.getByRole("checkbox", { name: /site/ })).toBeDisabled();
  await expect(parent).not.toBeChecked();
  await proposeRoute.uncheck();
  await expect(previewButton).toBeDisabled();
  await parent.check();
  await expect(exInfra).toBeChecked();
  await expect(proposeRoute).toBeChecked();
  await expect(previewButton).toBeEnabled();
  await exInfra.uncheck();
  await expect(parent).not.toBeChecked();
  await expect(proposeRoute).toBeChecked();
});
