import { expect, test, type Page } from "@playwright/test";
import { contrast, pickSpan, signIn } from "./helpers";

// Loss belongs to a core. Dev seed: KL DC - Bukit Jalil has a measured core; Bukit Jalil - Kuantan has no distance.
const SPANS = {
  measured: /^DEV Kuala Lumpur DC - DEV Bukit Jalil TOC/,
  noDistance: /^DEV Bukit Jalil TOC - DEV Kuantan Hut/,
};
const pick = (page: Page, name: RegExp) => pickSpan(page, name);

test.use({ viewport: { width: 1440, height: 900 } });

test("Inspector shows the worst core and how many cores are measured", async ({ page }) => {
  await signIn(page);
  await pick(page, SPANS.measured);
  const line = page.getByTestId("inspector-loss");
  await expect(line).toContainText(/Worst corecore (\d+|not recorded)(, [+-][\d.]+%)?/);
  await expect(page.getByTestId("span-facts")).toContainText(/Cores measured\d+ of \d+/);
});

test("a measured core: its loss in the core table, its tests in the row detail", async ({ page }) => {
  await signIn(page);
  await pick(page, SPANS.measured);
  await page.getByRole("button", { name: "Go to cores" }).click();
  const row = page.locator("tr[data-core]:has([data-level])").first();
  const n = await row.getAttribute("data-core");
  const latest = /[\d.]+ dB/.exec(await row.locator("td").last().innerText())![0];
  await row.getByRole("button", { name: `Core ${n} details` }).click();
  const rows = page.getByTestId("core-detail").getByTestId("core-tests").locator("tbody tr");
  expect(await rows.count()).toBeGreaterThan(0);
  // the newest test is the latest measured value in the row
  await expect(rows.first().locator("td").first()).toHaveText(latest);
  const r = await contrast(page, { pill: "tr[data-core] .pill" });
  expect(r.pill).toBeGreaterThanOrEqual(4.5);
  await page.getByTestId("core-detail").scrollIntoViewIfNeeded();
  await page.screenshot({ path: "e2e/screenshots/core-loss.png" });
});

test("no distance span: says so and never shows 0 dB", async ({ page }) => {
  await signIn(page);
  await pick(page, SPANS.noDistance);
  await expect(page.getByTestId("inspector-loss")).toContainText("Not measured");
  const span = page.getByTestId("span-facts");
  await expect(span).toContainText("No distance");
  await expect(span).not.toContainText("0.00 dB");
  await page.getByRole("button", { name: "Core 1 details" }).click();
  await expect(page.getByTestId("core-no-loss")).toHaveText("No loss test yet. No distance, so no calculated loss.");
});
