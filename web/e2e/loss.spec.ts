import { expect, test, type Page } from "@playwright/test";
import { contrast, signIn } from "./helpers";

// Loss belongs to a core. Dev seed: KL DC - Bukit Jalil has a measured core; Bukit Jalil - Kuantan has no distance.
const SPANS = {
  measured: /^DEV Kuala Lumpur DC - DEV Bukit Jalil TOC/,
  noDistance: /^DEV Bukit Jalil TOC - DEV Kuantan Hut/,
};
async function pick(page: Page, name: RegExp) {
  await page.getByRole("list", { name: "Spans" }).getByRole("button", { name }).click();
  await expect(page.locator("#span-h")).toHaveText(name);
}

test.use({ viewport: { width: 1440, height: 900 } });

test("Inspector shows the worst core and how many cores are measured", async ({ page }) => {
  await signIn(page);
  await pick(page, SPANS.measured);
  const line = page.getByTestId("inspector-loss");
  await expect(line).toContainText(/core (\d+|not recorded): [\d.]+ dB/);
  await expect(line).toContainText(/\d+ of \d+ cores measured/);
  await expect(page.getByTestId("span-card")).toContainText("Worst core");
});

test("a measured core: Calculated, Latest measured, Difference, Level and its tests", async ({ page }) => {
  await signIn(page);
  await pick(page, SPANS.measured);
  await page.getByRole("button", { name: "Open span details" }).click();
  const cell = page.locator("[role=gridcell]:has(.lm)").first();
  await cell.click({ force: true }); // taken cells are aria-disabled, which Playwright treats as disabled
  const loss = page.getByTestId("core-loss");
  for (const t of ["Calculated", "Latest measured", "Difference", "Level"]) await expect(loss).toContainText(t);
  const rows = page.getByTestId("core-tests").locator("tbody tr");
  expect(await rows.count()).toBeGreaterThan(0);
  // the newest test is the latest measured value above it
  const latest = (await loss.locator("dd").nth(1).innerText()).trim();
  await expect(rows.first().locator("td").first()).toHaveText(latest);
  const pill = loss.locator(".pill");
  if (await pill.count()) {
    const r = await contrast(page, { pill: "[data-testid=core-loss] .pill" });
    expect(r.pill).toBeGreaterThanOrEqual(4.5);
  }
  await page.getByTestId("core-card").scrollIntoViewIfNeeded();
  await page.screenshot({ path: "e2e/screenshots/core-loss.png" });
});

test("no distance span: says so and never shows 0 dB", async ({ page }) => {
  await signIn(page);
  await pick(page, SPANS.noDistance);
  await expect(page.getByTestId("inspector-loss")).toContainText("No core measured");
  const span = page.getByTestId("span-card");
  await expect(span).toContainText("No distance");
  await expect(span).not.toContainText("0.00 dB");
  await page.getByRole("gridcell").first().click({ force: true });
  await expect(page.getByTestId("core-no-loss")).toHaveText("No loss test yet. No distance, so no calculated loss.");
});
