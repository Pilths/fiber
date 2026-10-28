import { expect, test, type Page } from "@playwright/test";
import { signIn } from "./helpers";
import { xlsx, type Sheet } from "./xlsx";

// Admin Upload page (TASK-045, TASK-083). Workbooks are synthetic and built per run, so the suite repeats against the
// same dev database: the site master DC file is idempotent, the rename file is never applied, the reservation uses a
// fresh customer and is released afterwards, and closing the import is mocked (it cannot be reopened).
test.use({ viewport: { width: 1440, height: 900 } });
test.describe.configure({ mode: "serial" });

const stamp = Date.now();
const XLSX = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
const SITE_HEAD = ["SITE_NAME", "LATITUDE_IN_DECIMAL", "LONGITUDE_IN_DECIMAL", "REGION", "SITE_TYPE"];
const DC_HEAD = ["No", "State", "DC NAME / LINK", "LRD", "lat", "long"];
// Dev seed DCs listed with a blank LRD: Problem rows, so they are neither applied nor Missing.
const DEV_DCS = [[1, "Selangor", "DEV Kuala Lumpur DC", null, 3.139, 101.6869], [2, "Selangor", "DEV Cyberjaya DC", null, 2.9213, 101.65]];
const ALPHA = [3, "Perak", "E2E DC Alpha", "DEV Ipoh Exchange", null, null]; // location from its site
const RES_HEAD = ["Region", "Nodes", "Distance(KM)", "Core Secured", "Expected CV Ready", "Port Info", "Contractor", "Remark",
  "Fiber core monitoring", "Fiber montiored Y/N/WIP", "Fiber core requestor", "Fiber core request date", "Aging(days)",
  "No of core requested", "Core assignment", "Core balnce", "Core status"];
const SPAN = "DEV Kuala Lumpur DC-DEV Kuantan Hut"; // dev span 6, not used by other specs
const resRow = (customer: string | null) => ["East Coast", SPAN, null, null, null, "raw", "E2E Vendor", "e2e", null, "Y", customer, null, null, 1, null, null, null];

const file = (name: string, sheets: Sheet[]) => ({ name, mimeType: XLSX, buffer: xlsx(sheets) });
const nav = (page: Page) => page.getByRole("navigation", { name: "Main" });

async function openUpload(page: Page, tab: "Site master workbook" | "Reservation workbook") {
  await signIn(page, "admin1");
  await nav(page).getByRole("button", { name: "Upload" }).click();
  await page.getByRole("tab", { name: tab }).click();
}

test("site master preview: counts per sheet, 10% drop override, blocked DC sheet", async ({ page }) => {
  await openUpload(page, "Site master workbook");
  await page.getByLabel("Upload a site master workbook").setInputFiles(file(`e2e-sites-${stamp}.xlsx`, [
    { name: "Cover", rows: [["synthetic test file"]] },
    { name: "Site Location", rows: [SITE_HEAD, ["E2E Site One", 3.2, 101.5, "Central", "Tower"], ["E2E Site Two", "TBA", "TBA", "Central", "Tower"]] },
  ]));
  const preview = page.getByTestId("sm-preview");
  await expect(preview).toContainText("Nothing is saved until you apply it.");
  const sites = page.getByTestId("sheet-sites");
  await expect(sites).toContainText("found as worksheet “Site Location”, 2 rows");
  await expect(sites.getByRole("button", { name: "Added 1" })).toBeVisible();
  await expect(sites.getByRole("button", { name: "Problem 1" })).toBeVisible();
  await expect(sites.getByRole("button", { name: "Missing 4" })).toBeVisible();
  await expect(sites).toContainText("Blocked: this sheet will not be applied unless you override");
  await expect(sites).toContainText("limit is 10%");

  const dcs = page.getByTestId("sheet-dcs");
  await expect(dcs).toContainText("worksheet not found");
  await expect(dcs.getByRole("alert")).toContainText("This sheet will not be applied");
  await expect(dcs.getByRole("alert")).toContainText("No worksheet has the expected headers: DC Name / Link, LRD");

  await sites.getByRole("button", { name: "Problem 1" }).click();
  await expect(sites.getByRole("table")).toContainText("E2E Site Two");
  await expect(sites.getByRole("table")).toContainText("missing coordinates");
  await expect(sites.getByRole("table")).toContainText("Needs review");
  await expect(sites.getByRole("columnheader")).toHaveText(["Row", "Site name", "Latitude", "Longitude", "Status or reason"]);
  const two = sites.getByRole("row", { name: /E2E Site Two/ });
  await expect(two.getByRole("cell")).toHaveText(["3", "TBA", "TBA", /^Needs review.*missing coordinates/]);
  await sites.getByRole("button", { name: "Missing 4" }).click();
  await expect(sites.getByRole("table")).toContainText("in use, stays active");

  await expect(dcs.getByRole("button", { name: /^Apply/ })).toHaveCount(0);
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
  await preview.getByRole("button", { name: "Discard preview" }).click(); // never applied: would deactivate nothing, but keep the dev data as seeded
});

test("site master add and update only: no Missing rows, no row-count block (not applied)", async ({ page }) => {
  await openUpload(page, "Site master workbook");
  const addOnly = page.getByLabel("Add and update only");
  await expect(addOnly).not.toBeChecked();
  await addOnly.check();
  await page.getByLabel("Upload a site master workbook").setInputFiles(file(`e2e-addonly-${stamp}.xlsx`, [
    { name: "Site Location", rows: [SITE_HEAD, ["E2E Site One", 3.2, 101.5, "Central", "Tower"], ["E2E Site Two", "TBA", "TBA", "Central", "Tower"]] },
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

test("site master apply: DC sheet applies, result shown, current file updates", async ({ page }) => {
  await openUpload(page, "Site master workbook");
  const name = `e2e-dcs-${stamp}.xlsx`;
  await page.getByLabel("Upload a site master workbook").setInputFiles(file(name, [
    { name: "DC List", rows: [DC_HEAD, ...DEV_DCS, ALPHA, [4, "Penang", "E2E DC Beta", "DEV Penang Tower", 5.41, 100.33]] },
  ]));
  await expect(page.getByTestId("sheet-sites").getByRole("alert")).toContainText("This sheet will not be applied");
  const dcs = page.getByTestId("sheet-dcs");
  await expect(dcs.getByRole("button", { name: "Problem 2" })).toBeVisible();
  await expect(dcs.getByRole("columnheader")).toHaveText(["Row", "DC name", "LRD", "State", "Latitude", "Longitude", "Status or reason"]);
  await expect(dcs).toContainText("Ready to apply.");
  await expect(dcs).not.toContainText("Apply Site Location first");
  await dcs.getByRole("button", { name: "Apply DC List…" }).click();
  const dialog = page.getByRole("dialog", { name: "Apply DC List?" });
  await dialog.getByRole("button", { name: "Apply", exact: true }).click();
  await expect(dialog).toHaveCount(0);
  const result = page.getByTestId("sm-result");
  await expect(result).toContainText("Site master applied");
  await expect(result).toContainText(/DC List: \d+ added, \d+ changed/);
  await expect(result).toContainText("Site Location: not applied");
  await expect(page.getByTestId("sm-preview")).toHaveCount(0);
  await expect(page.getByTestId("sm-current")).toContainText(name);
  await expect(page.getByTestId("sm-current")).toContainText("Current");
});

test("site master possible rename must be decided before Apply", async ({ page }) => {
  await openUpload(page, "Site master workbook");
  await page.getByLabel("Upload a site master workbook").setInputFiles(file(`e2e-rename-${stamp}.xlsx`, [
    { name: "DCs renamed tab", rows: [["title row"], DC_HEAD, ...DEV_DCS, ALPHA, [4, "Penang", "E2E DC Beta Renamed", "DEV Penang Tower", 5.41, 100.33]] },
  ]));
  const renames = page.getByRole("region", { name: /Possible renames/ });
  await expect(renames).toContainText("E2E DC Beta → E2E DC Beta Renamed");
  const preview = page.getByTestId("sm-preview");
  const apply = page.getByTestId("sheet-dcs").getByRole("button", { name: "Apply DC List…" });
  await expect(apply).toBeDisabled();
  await expect(preview).toContainText("Choose Rename or Keep separate for 1 possible rename.");
  await page.evaluate(() => scrollTo(0, 0));
  await page.screenshot({ path: "e2e/screenshots/upload-site-master-renames.png", fullPage: true });
  await renames.getByRole("radio", { name: "Rename" }).check();
  await expect(apply).toBeEnabled();
  await apply.click();
  const dialog = page.getByRole("dialog", { name: "Apply DC List?" });
  await expect(dialog).toContainText("Possible renames: 1 renamed, 0 kept separate.");
  await page.keyboard.press("Escape"); // not applied: the next run needs E2E DC Beta as it is
  await expect(dialog).toHaveCount(0);
  await expect(apply).toBeFocused();
});

test("site master sheets apply one at a time; the preview survives a tab change (apply calls mocked)", async ({ page }) => {
  await openUpload(page, "Site master workbook");
  await page.getByLabel("Upload a site master workbook").setInputFiles(file(`e2e-both-${stamp}.xlsx`, [
    { name: "Site Location", rows: [SITE_HEAD, ["E2E Site One", 3.2, 101.5, "Central", "Tower"], ["E2E Site Two", "TBA", "TBA", "Central", "Tower"]] },
    { name: "DC List", rows: [DC_HEAD, ...DEV_DCS, ALPHA, [4, "Penang", "E2E DC Beta", "DEV Penang Tower", 5.41, 100.33]] },
  ]));
  const sites = page.getByTestId("sheet-sites");
  const dcs = page.getByTestId("sheet-dcs");
  await sites.getByLabel(/^Override/).check();
  await sites.getByLabel("Reason for the override (required)").fill("E2E: smaller test file");
  await expect(dcs).toContainText("Apply Site Location first");

  // Switching the top tab keeps the staged preview and its choices.
  await nav(page).getByRole("button", { name: "Map" }).click();
  await expect(page.getByTestId("sm-preview")).toBeHidden();
  await nav(page).getByRole("button", { name: "Upload" }).click();
  await expect(sites.getByLabel(/^Override/)).toBeChecked();
  await expect(sites.getByLabel("Reason for the override (required)")).toHaveValue("E2E: smaller test file");

  // The dev site list must stay as seeded, so the apply calls are mocked; the request bodies are checked.
  const bodies: unknown[] = [];
  const counts = { added: 1, changed: 0, renamed: 0, deactivated: 0, kept_active: 4, protected_kept: 0, skipped: 0 };
  await page.route("**/api/admin/site-master/uploads/*/apply", async (route) => {
    const b = route.request().postDataJSON() as { sheets: string[] };
    bodies.push(b);
    const first = b.sheets[0] === "sites";
    await route.fulfill({ json: { upload_id: 1, warnings: first ? [] : ["E2E warning"], complete: !first,
      sheets: { sites: { applied: true, ...counts }, dcs: first ? { applied: false, block_reasons: [] } : { applied: true, ...counts, added: 2 } } } });
  });
  await sites.getByRole("button", { name: "Apply Site Location…" }).click();
  await page.getByRole("dialog", { name: "Apply Site Location?" }).getByRole("button", { name: "Apply", exact: true }).click();
  await expect(sites).toContainText("Site Location applied");
  await expect(sites).toContainText("1 added, 0 changed");
  await expect(sites.getByRole("button", { name: /^Apply/ })).toHaveCount(0);
  await expect(dcs).not.toContainText("Apply Site Location first");
  await dcs.getByRole("button", { name: "Apply DC List…" }).click();
  await page.getByRole("dialog", { name: "Apply DC List?" }).getByRole("button", { name: "Apply", exact: true }).click();
  const result = page.getByTestId("sm-result");
  await expect(result).toContainText("Site master applied");
  await expect(result).toContainText("Site Location: 1 added");
  await expect(result).toContainText("DC List: 2 added");
  await expect(result).toContainText("E2E warning");
  await expect(page.getByTestId("sm-preview")).toHaveCount(0);
  expect(bodies).toEqual([
    { sheets: ["sites"], override_drop: { sites: true, dcs: false }, reason: "E2E: smaller test file", renames: [] },
    { sheets: ["dcs"], override_drop: { sites: false, dcs: false }, reason: null, renames: [] },
  ]);
});

test("reservation workbook: preview, confirm, re-upload shows Already imported", async ({ page }) => {
  await openUpload(page, "Reservation workbook");
  const customer = `E2E Customer ${stamp}`;
  const wb = file(`e2e-res-${stamp}.xlsx`, [
    { name: "Reservation", rows: [RES_HEAD, ["E2E group"], resRow(customer), resRow(null)] },
    { name: "Monitoring", rows: [["synthetic"]] },
  ]);
  const input = page.getByLabel("Upload a Reservation workbook");
  await input.setInputFiles(wb);
  const preview = page.getByTestId("ru-preview");
  await expect(preview).toContainText("Nothing is saved until you confirm.");
  const res = page.getByTestId("ru-reservations");
  await expect(res).toContainText("Reservations to import (1)");
  const row = res.getByRole("row", { name: new RegExp(customer) });
  await expect(row).toContainText(SPAN);
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

  // Clean up: release the count-only reservation so span 6 keeps its free cores for the next run.
  const mine = await (await page.request.get("/api/reservations")).json() as { id: number; customer: string }[];
  const r = mine.find((x) => x.customer === customer);
  expect(r).toBeTruthy();
  expect((await page.request.post(`/api/reservations/${r!.id}/release`, { data: { cores: [] } })).ok()).toBe(true);
});

test("close reservation import needs a reason, then shows the closed state (close call mocked)", async ({ page }) => {
  await openUpload(page, "Reservation workbook");
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
    await route.fulfill({ json: { closed: true, closed_at: "2026-10-26T02:00:00Z", closed_by: "admin1", reason: "E2E: dashboard is now the source of truth" } });
  });
  await dialog.getByRole("button", { name: "Close import" }).click();
  expect(posted).toEqual({ reason: "E2E: dashboard is now the source of truth" });
  await expect(dialog).toHaveCount(0);
  await expect(sw).toContainText("Reservation import closed on 26 Oct 2026, 10:00 by admin1: E2E: dashboard is now the source of truth");
  await expect(sw.getByRole("button")).toHaveCount(0);
});

test("planner does not see the Upload tab", async ({ page }) => {
  await signIn(page, "planner1");
  await expect(nav(page).getByRole("button", { name: "Upload" })).toHaveCount(0);
  expect((await page.request.get("/api/admin/reservation-import")).status()).toBe(403);
});
