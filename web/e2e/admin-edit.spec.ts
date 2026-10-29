import { expect, test, type Page } from "@playwright/test";
import { signIn } from "./helpers";

// Session 8: core detail drawer, admin edits (TEST-011) and reservation history (TEST-021).
// Every edit here is reversed in the same test; nothing is deleted, so the history rows stay.
const KLCJ = /^DEV Kuala Lumpur DC - DEV Cyberjaya DC/; // core 1 Reserved by planner1 (approved)
const KLBJ = /^DEV Kuala Lumpur DC - DEV Bukit Jalil TOC/; // cores 20 and 21 are free
const CJBJ = /^DEV Cyberjaya DC - DEV Bukit Jalil TOC/; // distance 18.2 km, changed and reverted

test.use({ viewport: { width: 1440, height: 900 } });

const pick = async (page: Page, name: RegExp) => {
  await page.getByRole("list", { name: "Spans" }).getByRole("button", { name }).click();
  await expect(page.getByRole("grid", { name: "Cores" })).toBeVisible();
};
const cell = (page: Page, n: number) => page.getByRole("gridcell", { name: new RegExp(`^Core ${n}:`) });
const drawer = (page: Page) => page.getByRole("dialog", { name: /^Core \d+ on / });

test("core drawer: opens from a taken core with history, Keep for the owner, Esc returns focus", async ({ page }) => {
  await signIn(page, "planner1");
  await pick(page, KLCJ);
  await cell(page, 1).focus();
  await page.keyboard.press("Enter");
  const d = drawer(page);
  await expect(d).toBeVisible();
  await expect(d.getByRole("heading", { level: 2 })).toHaveText("Core 1 on DEV Kuala Lumpur DC - DEV Cyberjaya DC");
  await expect(d.getByTestId("core-status")).toContainText("Reserved");
  await expect(d).toContainText("DEV Telco Alpha");
  const hist = d.getByRole("list", { name: "Core history, newest first" });
  await expect(hist).toContainText("Requested by DEV planner1");
  await expect(hist).toContainText("Approved by DEV admin1");
  await expect(hist.getByRole("listitem").last()).toContainText("Requested by");
  await expect(d.getByRole("button", { name: "Request release of core 1" })).toBeVisible();
  await expect(d.getByRole("button", { name: /^Mark / })).toHaveCount(0); // planners cannot edit status
  await d.getByRole("button", { name: "Keep" }).click();
  await expect(hist.getByRole("listitem").first()).toContainText("Kept by DEV planner1");
  await page.screenshot({ path: "e2e/screenshots/core-drawer.png" });
  await page.keyboard.press("Escape");
  await expect(d).toBeHidden();
  await expect(cell(page, 1)).toBeFocused();

  // the taken-cores table opens the same drawer
  await page.getByRole("table", { name: "Allocations on this span" }).getByRole("button", { name: "Core 2 details" }).click();
  await expect(drawer(page).getByRole("heading", { level: 2 })).toHaveText(/^Core 2 on/);
});

test("planner sees no Keep on others' cores and no edit buttons", async ({ page }) => {
  await signIn(page, "planner2");
  await pick(page, KLCJ);
  await cell(page, 1).click({ force: true }); // taken cells are aria-disabled (not selectable), which Playwright treats as disabled
  const d = drawer(page);
  await expect(d).toContainText("DEV Telco Alpha");
  await expect(d.getByText(/^DEV planner1, reservation #\d+$/)).toBeVisible(); // Reserved by: from GET /api/cores/{id}
  await expect(d).toContainText("No events on this core that you can see"); // another planner's reservation
  await expect(d.getByRole("button", { name: "Keep" })).toHaveCount(0);
  await expect(d.getByRole("button", { name: /Request release/ })).toHaveCount(0);
  await d.getByRole("button", { name: "Close core detail" }).click();
  const inspector = page.getByRole("region", { name: "Inspector" });
  await expect(inspector.getByRole("button", { name: "Edit span" })).toHaveCount(0);
  await expect(inspector.getByRole("button", { name: /^Edit site/ })).toHaveCount(0);
});

test("taken-cores table tags stale cores", async ({ page }) => {
  await signIn(page, "admin1");
  const rs: { stale: boolean; cores: { core_id: number; held: boolean }[] }[] = await (await page.request.get("/api/reservations")).json();
  const core = rs.filter((r) => r.stale).flatMap((r) => r.cores).find((c) => c.held);
  test.skip(!core, "Dev data has no stale reservation holding a core; not faking one by changing server data.");
  const c: { number: number; span_name: string } = await (await page.request.get(`/api/cores/${core!.core_id}`)).json();
  await pick(page, new RegExp(`^${c.span_name}`));
  const row = page.getByRole("table", { name: "Allocations on this span" }).getByRole("row").filter({ has: page.getByRole("button", { name: `Core ${c.number} details` }) });
  await expect(row).toContainText(/Stale: no keep for over 3 months since /);
});

test("admin edits span distance with a reason; calculated loss follows; then reverts", async ({ page }) => {
  await signIn(page, "admin1");
  await pick(page, CJBJ);
  const loss = page.getByTestId("loss-card");
  await expect(loss).toContainText("5.46 dB");

  const edit = async (km: string, reason: string) => {
    await page.getByRole("region", { name: "Inspector" }).getByRole("button", { name: "Edit span" }).click();
    const dlg = page.getByRole("dialog", { name: /^Edit span/ });
    await dlg.getByLabel("Distance (km)").fill(km);
    await dlg.getByRole("button", { name: "Save" }).click();
    await expect(dlg.getByRole("alert")).toContainText("Enter a reason"); // reason empty: blocked before sending
    await dlg.getByLabel("Reason (required)").fill(reason);
    return dlg;
  };
  let dlg = await edit("18.3", "E2E: re-measured route");
  await dlg.getByText(/^History/).click();
  await page.screenshot({ path: "e2e/screenshots/edit-span.png" });
  await dlg.getByRole("button", { name: "Save" }).click();
  await expect(dlg).toBeHidden();
  await expect(loss).toContainText("5.49 dB");

  dlg = await edit("18.2", "E2E: revert");
  await dlg.getByRole("button", { name: "Save" }).click();
  await expect(dlg).toBeHidden();
  await expect(loss).toContainText("5.46 dB");
  await page.getByRole("region", { name: "Inspector" }).getByRole("button", { name: "Edit span" }).click();
  await page.getByRole("dialog", { name: /^Edit span/ }).getByText(/^History/).click();
  await expect(page.getByTestId("edit-history").getByRole("listitem").first()).toContainText("Reason: E2E: revert");
});

test("lowering the survey count below taken cores is refused in plain words", async ({ page }) => {
  await signIn(page, "admin1");
  await pick(page, KLCJ);
  await page.getByRole("region", { name: "Inspector" }).getByRole("button", { name: "Edit span" }).click();
  const dlg = page.getByRole("dialog", { name: /^Edit span/ });
  await dlg.getByLabel("Survey count").fill("1");
  await dlg.getByLabel("Reason (required)").fill("E2E: should be refused");
  await dlg.getByRole("button", { name: "Save" }).click();
  await expect(dlg.getByRole("alert")).toContainText(/^Cores 2, .* are allocated or have history and cannot be removed/);
  await dlg.getByRole("button", { name: "Cancel" }).click();
  await expect(page.getByRole("region", { name: /^Cores of/ })).toContainText("24 surveyed of 144");
});

test("admin opens a site from the Inspector: fields, reason required, history", async ({ page }) => {
  await signIn(page, "admin1");
  await pick(page, KLCJ);
  await page.getByRole("button", { name: "Edit site DEV Cyberjaya DC" }).click();
  const dlg = page.getByRole("dialog", { name: "Edit site DEV Cyberjaya DC" });
  await expect(dlg.getByLabel("Name")).toHaveValue("DEV Cyberjaya DC");
  await expect(dlg.getByLabel("Latitude")).toHaveValue("2.9213");
  await dlg.getByLabel("Active").uncheck();
  await expect(dlg).toContainText("A site used by a span cannot be deactivated");
  await dlg.getByRole("button", { name: "Save" }).click();
  await expect(dlg.getByRole("alert")).toContainText("Enter a reason");
  await dlg.getByLabel("Reason (required)").fill("E2E: try to deactivate");
  await dlg.getByRole("button", { name: "Save" }).click();
  await expect(dlg.getByRole("alert").first()).toContainText("used by a span");
  await dlg.getByText(/^History/).click();
  await page.screenshot({ path: "e2e/screenshots/edit-site.png" });
  await page.keyboard.press("Escape");
  await expect(dlg).toBeHidden();
  await expect(page.getByRole("button", { name: "Edit site DEV Cyberjaya DC" })).toBeFocused();
});

test("reservation History disclosure lists events in order", async ({ page }) => {
  await signIn(page, "planner1");
  await page.getByRole("button", { name: /My reservations/ }).click();
  const card = page.getByRole("region", { name: "My reservations" }).getByTestId("reservation").filter({ hasText: "DEV Telco Alpha" }).filter({ hasText: "Approved" }).first();
  await card.getByText("History", { exact: true }).click();
  const items = card.getByTestId("res-history").getByRole("listitem");
  await expect(items.first()).toContainText("Requested by DEV planner1");
  await expect(items.nth(1)).toContainText("Approved by DEV admin1");
});

test("admin edits a core's ports with a reason, then puts them back", async ({ page }) => {
  await signIn(page, "admin1");
  await pick(page, KLBJ);
  await cell(page, 21).focus();
  await page.getByRole("button", { name: "Core 21 details" }).click();
  const d = drawer(page);
  const dlg = page.getByRole("dialog", { name: "Ports of core 21" });
  const a = dlg.getByLabel("Port at DEV Kuala Lumpur DC");
  const b = dlg.getByLabel(/^Port at DEV Bukit Jalil/);
  await d.getByRole("button", { name: /^(Add|Edit) ports$/ }).click();
  const [oldA, oldB] = [await a.inputValue(), await b.inputValue()]; // prefilled with the current labels
  await a.fill("E2E-KL-21");
  await b.fill("");
  await dlg.getByRole("button", { name: "Save" }).click();
  await expect(dlg.getByRole("alert")).toContainText("Enter a reason");
  await dlg.getByLabel("Reason (required)").fill("E2E: ports from site survey");
  await dlg.getByRole("button", { name: "Save" }).click();
  await expect(dlg).toBeHidden();
  await expect(d).toBeVisible(); // closing the nested dialog leaves the drawer open
  await expect(d).toContainText("E2E-KL-21 to Not recorded");
  await expect(d.getByRole("list", { name: "Core history, newest first" })).toContainText("port_a changed to E2E-KL-21");

  await d.getByRole("button", { name: "Edit ports" }).click();
  await a.fill(oldA);
  await b.fill(oldB);
  await dlg.getByLabel("Reason (required)").fill("E2E: undo");
  await dlg.getByRole("button", { name: "Save" }).click();
  await expect(dlg).toBeHidden();
  await expect(d).toContainText(oldA || oldB ? `${oldA || "Not recorded"} to ${oldB || "Not recorded"}` : "Add ports");
});

test("one Unassigned row per reservation; admin assign dialog limits the choice", async ({ page }) => {
  await signIn(page, "admin1");
  await pick(page, CJBJ);
  const table = page.getByRole("table", { name: "Allocations on this span" });
  const rows = table.getByTestId("unassigned-row");
  const n = await rows.count();
  expect(n).toBeGreaterThan(0);
  await expect(page.getByRole("group", { name: "Filter allocations by status" }).getByRole("button", { name: /^Unassigned/ })).toHaveText(`Unassigned ${n}`);
  const remaining = Number(await rows.first().getByRole("rowheader").innerText());
  let posted: unknown = null;
  await page.route("**/api/reservations/*/assign", (r) => { posted = r.request().postDataJSON(); return r.fulfill({ json: {} }); });
  await rows.first().getByRole("button", { name: "Assign cores" }).click();
  const dlg = page.getByRole("dialog", { name: /^Assign cores to / });
  await expect(dlg).toContainText(`Choose up to ${remaining}`);
  const cores = dlg.getByRole("group", { name: "Available cores" }).getByRole("button");
  test.skip(await cores.count() <= remaining, "Not enough Available cores on this span to test the limit.");
  for (let i = 0; i < remaining; i++) await cores.nth(i).click();
  await expect(cores.nth(remaining)).toBeDisabled();
  await expect(cores.nth(0)).toHaveAttribute("aria-pressed", "true");
  await dlg.getByRole("button", { name: new RegExp(`^Assign ${remaining} cores?$`) }).click();
  await expect(dlg).toBeHidden();
  expect((posted as { cores: number[] }).cores).toHaveLength(remaining);
});
