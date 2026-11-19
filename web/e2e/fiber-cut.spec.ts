import { expect, test, type Page, type Route } from "@playwright/test";
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
  const patched = async (route: Route) => {
    const real = await (await route.fetch()).json();
    return route.fulfill({ json: { ...real, ...segment } });
  };
  await page.route(/\/api\/segments\/\d+$/, patched);
  await page.route(/\/api\/admin\/segments\/\d+$/, async (route) => {
    if (route.request().method() === "GET") {
      return patched(route);
    }
    return route.fallback();
  });
}
const pick = (page: Page) => pickSegment(page, KLBJ);

test("a normal segment: no Cut chip, no Reserve cores button (reserving is via Site A to B)", async ({ page }) => {
  await mock(page, { fiber_cut: false });
  await signIn(page);
  await pick(page);
  await expect(diagram(page).locator(".pill.h-red")).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Reserve cores" })).toHaveCount(0);
  await expect(actions(page)).toHaveCount(0); // planner, no route found: no empty actions row
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

test("fiber cut: admin Restore opens the segment dialog unticked with focus on the remarks", async ({ page }) => {
  await mock(page, { fiber_cut: true, free_to_reserve: 0 });
  let posted: unknown = null;
  await page.route(/\/api\/admin\/segments\/\d+$/, (route) => {
    if (route.request().method() !== "POST") {
      return route.fallback();
    }
    posted = route.request().postDataJSON();
    return route.fulfill({ json: {} });
  });
  await signIn(page, "admin1");
  await pick(page);
  await actions(page).getByRole("button", { name: "Restore" }).click();
  const dlg = page.getByRole("dialog", { name: /^Edit segment/ });
  const remarks = dlg.getByLabel("Remarks (optional)");
  await expect(remarks).toBeFocused();
  await expect(dlg.getByRole("checkbox", { name: /Fiber cut/ })).not.toBeChecked();
  await remarks.fill("E2E: repaired");
  await dlg.getByRole("button", { name: "Save" }).click();
  await expect(dlg).toBeHidden();
  expect(posted).toEqual({ remarks: "E2E: repaired", fiber_cut: false });
});

test("Edit segment: ticking Fiber cut sends fiber_cut true with the remarks", async ({ page }) => {
  await mock(page, { fiber_cut: false });
  let posted: unknown = null;
  await page.route(/\/api\/admin\/segments\/\d+$/, (route) => {
    if (route.request().method() !== "POST") {
      return route.fallback();
    }
    posted = route.request().postDataJSON();
    return route.fulfill({ json: {} });
  });
  await signIn(page, "admin1");
  await pick(page);
  await actions(page).getByRole("button", { name: "Edit segment" }).click();
  const dlg = page.getByRole("dialog", { name: /^Edit segment/ });
  const box = dlg.getByRole("checkbox", { name: /Fiber cut/ });
  await expect(box).not.toBeChecked();
  await box.check();
  await dlg.getByLabel("Remarks (optional)").fill("E2E: cable cut at km 4");
  await dlg.getByRole("button", { name: "Save" }).click();
  await expect(dlg).toBeHidden();
  expect(posted).toEqual({ remarks: "E2E: cable cut at km 4", fiber_cut: true });
});
