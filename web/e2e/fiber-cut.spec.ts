import { expect, test, type Page } from "@playwright/test";
import { contrast, pickSpan, signIn } from "./helpers";

// Inspector alerts: fiber cut (span state) and high loss. Responses are mocked, so dev data never changes.
const KLBJ = /^DEV Kuala Lumpur DC - DEV Bukit Jalil TOC/;

test.use({ viewport: { width: 1440, height: 900 } });
// A save reloads the span; let mocked fetches still in flight end quietly.
test.afterEach(({ page }) => page.unrouteAll({ behavior: "ignoreErrors" }));

const inspector = (page: Page) => page.getByRole("region", { name: "Inspector" });

// Patch the real span detail, admin span and loss responses with the given fields.
async function mock(page: Page, span: object, loss?: object) {
  await page.route(/\/api\/spans\/\d+$/, async (r) => r.fulfill({ json: { ...(await (await r.fetch()).json()), ...span } }));
  await page.route(/\/api\/admin\/spans\/\d+$/, async (r) =>
    r.request().method() === "GET" ? r.fulfill({ json: { ...(await (await r.fetch()).json()), ...span } }) : r.fallback());
  if (loss) await page.route(/\/api\/loss\/spans\/\d+$/, async (r) => r.fulfill({ json: { ...(await (await r.fetch()).json()), ...loss } }));
}
const pick = (page: Page) => pickSpan(page, KLBJ);
const measured = (level: string, db: number, pct: number) => ({ status: "measured", level, measured_db: db, deviation_pct: pct, worst_core_number: 12, measured_cores: 3, total_cores: 24 });

test("no alert for a normal span", async ({ page }) => {
  await mock(page, { fiber_cut: false }, measured("green", 3.5, 1.2));
  await signIn(page);
  await pick(page);
  const i = inspector(page);
  await expect(i.getByTestId("inspector-loss")).toContainText("core 12: 3.50 dB+1.2%, 3 of 24 cores measured");
  await expect(i.getByTestId("fiber-cut")).toHaveCount(0);
  await expect(i.getByTestId("loss-alert")).toHaveCount(0);
  await expect(i.locator("dl")).not.toContainText("Fiber cut");
  await i.screenshot({ path: "e2e/screenshots/inspector-normal.png" });
});

test("red loss level: red alert strip and red loss row", async ({ page }) => {
  await mock(page, { fiber_cut: false }, measured("red", 7.4, 29.5));
  await signIn(page);
  await pick(page);
  const i = inspector(page);
  const strip = i.getByTestId("loss-alert");
  await expect(strip).toHaveAttribute("data-level", "red");
  await expect(strip).toContainText("High loss: 7.40 dB measured, +29.5% over calculated");
  await expect(strip).toContainText("Over 7%");
  await expect(strip.locator("svg")).toHaveAttribute("data-icon", "fl");
  const row = i.getByTestId("inspector-loss");
  await expect(row).toHaveAttribute("data-level", "red");
  await expect(row).toHaveCSS("background-color", "rgb(254, 243, 242)");
  const r = await contrast(page, { strip: "[data-testid=loss-alert] b", row: "[data-testid=inspector-loss] b" });
  expect(r.strip).toBeGreaterThanOrEqual(4.5);
  expect(r.row).toBeGreaterThanOrEqual(4.5);
  await i.screenshot({ path: "e2e/screenshots/inspector-highloss.png" });
});

test("amber loss level: amber strip", async ({ page }) => {
  await mock(page, { fiber_cut: false }, measured("amber", 3.78, 5));
  await signIn(page);
  await pick(page);
  const strip = inspector(page).getByTestId("loss-alert");
  await expect(strip).toHaveAttribute("data-level", "amber");
  await expect(strip).toContainText("Loss above calculated: 3.78 dB measured, +5.0% over calculated");
});

test("fiber cut: banner, 0 Cut, one red bar, Fiber cut key row; planner has no Restore", async ({ page }) => {
  await mock(page, { fiber_cut: true, free_to_reserve: 0 }, measured("green", 3.5, 1.2));
  await signIn(page);
  await pick(page);
  const i = inspector(page);
  const banner = i.getByTestId("fiber-cut");
  await expect(banner).toContainText("Fiber cut");
  await expect(banner).toContainText("All cores on this span are unavailable.");
  await expect(banner.getByRole("button", { name: "Restore" })).toHaveCount(0);
  await expect(i.locator(".pill.h-red").first()).toHaveText("Cut");
  await expect(i.locator(".v-red").first()).toHaveText("0"); // the big number reads 0, red; the title chip says Cut
  const bar = i.getByTestId("free-bar").locator("span");
  await expect(bar).toHaveCount(1);
  await expect(bar).toHaveClass(/k-fault/);
  await expect(i.locator("dl")).toContainText("Fiber cut");
  await i.screenshot({ path: "e2e/screenshots/inspector-cut.png" });
});

test("fiber cut: admin Restore opens the span dialog unticked with focus on the reason", async ({ page }) => {
  await mock(page, { fiber_cut: true, free_to_reserve: 0 });
  let posted: unknown = null;
  await page.route(/\/api\/admin\/spans\/\d+$/, (r) => {
    if (r.request().method() !== "POST") return r.fallback();
    posted = r.request().postDataJSON();
    return r.fulfill({ json: {} });
  });
  await signIn(page, "admin1");
  await pick(page);
  await inspector(page).getByTestId("fiber-cut").getByRole("button", { name: "Restore" }).click();
  const dlg = page.getByRole("dialog", { name: /^Edit span/ });
  const reason = dlg.getByLabel("Reason (required)");
  await expect(reason).toBeFocused();
  await expect(dlg.getByRole("checkbox", { name: /Fiber cut/ })).not.toBeChecked();
  await reason.fill("E2E: repaired");
  await dlg.getByRole("button", { name: "Save" }).click();
  await expect(dlg).toBeHidden();
  expect(posted).toEqual({ reason: "E2E: repaired", fiber_cut: false });
});

test("Edit span: ticking Fiber cut sends fiber_cut true with the reason", async ({ page }) => {
  await mock(page, { fiber_cut: false });
  let posted: unknown = null;
  await page.route(/\/api\/admin\/spans\/\d+$/, (r) => {
    if (r.request().method() !== "POST") return r.fallback();
    posted = r.request().postDataJSON();
    return r.fulfill({ json: {} });
  });
  await signIn(page, "admin1");
  await pick(page);
  await inspector(page).getByRole("button", { name: "Edit span" }).click();
  const dlg = page.getByRole("dialog", { name: /^Edit span/ });
  const box = dlg.getByRole("checkbox", { name: /Fiber cut/ });
  await expect(box).not.toBeChecked();
  await box.check();
  await dlg.getByRole("button", { name: "Save" }).click();
  await expect(dlg.getByRole("alert")).toContainText("Enter a reason");
  expect(posted).toBeNull();
  await dlg.getByLabel("Reason (required)").fill("E2E: cable cut at km 4");
  await dlg.getByRole("button", { name: "Save" }).click();
  await expect(dlg).toBeHidden();
  expect(posted).toEqual({ reason: "E2E: cable cut at km 4", fiber_cut: true });
});
