import { expect, test, type Page } from "@playwright/test";
import { pickSegment, signIn } from "./helpers";

// Fiber cut (a segment state) on the segment diagram. Responses are mocked, so dev data never changes.
const KLBJ = /^DEV Kuala Lumpur DC - DEV Bukit Jalil TOC/;

test.use({ viewport: { width: 1440, height: 900 } });
// A save reloads the segment; let mocked fetches still in flight end quietly.
test.afterEach(({ page }) => page.unrouteAll({ behavior: "ignoreErrors" }));

const diagram = (page: Page) => page.getByTestId("segment-diagram");
const actions = (page: Page) => page.getByTestId("segment-actions");

// Patch the real segment detail and admin segment responses with the given fields.
async function mock(page: Page, segment: object) {
  await page.route(/\/api\/segments\/\d+$/, async (r) => r.fulfill({ json: { ...(await (await r.fetch()).json()), ...segment } }));
  await page.route(/\/api\/admin\/segments\/\d+$/, async (r) =>
    r.request().method() === "GET" ? r.fulfill({ json: { ...(await (await r.fetch()).json()), ...segment } }) : r.fallback());
}
const pick = (page: Page) => pickSegment(page, KLBJ);

test("a normal segment: no Cut chip, no Reserve cores button (reserving is via Site A to B), no loss alert", async ({ page }) => {
  await mock(page, { fiber_cut: false });
  await signIn(page);
  await pick(page);
  await expect(diagram(page).locator(".pill.h-red")).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Reserve cores" })).toHaveCount(0);
  await expect(actions(page)).toHaveCount(0); // planner, no route found: no empty actions row
  await expect(page.getByTestId("loss-alert")).toHaveCount(0);
  await diagram(page).screenshot({ path: "e2e/screenshots/diagram-normal.png" });
});

test("fiber cut: Cut chip on a dashed red line; planner has no Restore", async ({ page }) => {
  await mock(page, { fiber_cut: true, free_to_reserve: 0 });
  await signIn(page);
  await pick(page);
  const d = diagram(page);
  await expect(d.locator(".pill.h-red").first()).toHaveText("Cut"); // symbol and word, not colour alone
  await expect(d.locator(".border-dashed.border-red")).toHaveCount(1);
  await expect(actions(page).getByRole("button", { name: "Restore" })).toHaveCount(0);
  await d.screenshot({ path: "e2e/screenshots/diagram-cut.png" });
});

test("fiber cut: admin Restore opens the segment dialog unticked with focus on the reason", async ({ page }) => {
  await mock(page, { fiber_cut: true, free_to_reserve: 0 });
  let posted: unknown = null;
  await page.route(/\/api\/admin\/segments\/\d+$/, (r) => {
    if (r.request().method() !== "POST") return r.fallback();
    posted = r.request().postDataJSON();
    return r.fulfill({ json: {} });
  });
  await signIn(page, "admin1");
  await pick(page);
  await actions(page).getByRole("button", { name: "Restore" }).click();
  const dlg = page.getByRole("dialog", { name: /^Edit segment/ });
  const reason = dlg.getByLabel("Reason (optional)");
  await expect(reason).toBeFocused();
  await expect(dlg.getByRole("checkbox", { name: /Fiber cut/ })).not.toBeChecked();
  await reason.fill("E2E: repaired");
  await dlg.getByRole("button", { name: "Save" }).click();
  await expect(dlg).toBeHidden();
  expect(posted).toEqual({ reason: "E2E: repaired", fiber_cut: false });
});

test("Edit segment: ticking Fiber cut sends fiber_cut true with the reason", async ({ page }) => {
  await mock(page, { fiber_cut: false });
  let posted: unknown = null;
  await page.route(/\/api\/admin\/segments\/\d+$/, (r) => {
    if (r.request().method() !== "POST") return r.fallback();
    posted = r.request().postDataJSON();
    return r.fulfill({ json: {} });
  });
  await signIn(page, "admin1");
  await pick(page);
  await actions(page).getByRole("button", { name: "Edit segment" }).click();
  const dlg = page.getByRole("dialog", { name: /^Edit segment/ });
  const box = dlg.getByRole("checkbox", { name: /Fiber cut/ });
  await expect(box).not.toBeChecked();
  await box.check();
  await dlg.getByLabel("Reason (optional)").fill("E2E: cable cut at km 4");
  await dlg.getByRole("button", { name: "Save" }).click();
  await expect(dlg).toBeHidden();
  expect(posted).toEqual({ reason: "E2E: cable cut at km 4", fiber_cut: true });
});
