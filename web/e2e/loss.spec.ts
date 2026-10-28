import { expect, test, type Page } from "@playwright/test";
import { contrast, signIn } from "./helpers";

// Dev seed: span 1 below calculated, 3 amber, 4 red, 5 off scale, 7 no distance.
const SPANS = {
  below: /^DEV Kuala Lumpur DC - DEV Cyberjaya DC/,
  amber: /^DEV Kuala Lumpur DC - DEV Bukit Jalil TOC/,
  red: /^DEV Kuala Lumpur DC - DEV Ipoh Exchange/,
  off: /^DEV Ipoh Exchange - DEV Penang Tower/,
  noDistance: /^DEV Bukit Jalil TOC - DEV Kuantan Hut/,
};
const card = (page: Page) => page.getByTestId("loss-card");
async function pick(page: Page, name: RegExp) {
  await page.getByRole("list", { name: "Spans" }).getByRole("button", { name }).click();
  await expect(card(page).getByRole("heading", { name: /^Loss of/ })).toBeVisible();
  await expect(card(page).getByText("Latest measured")).toBeVisible();
}

test.use({ viewport: { width: 1440, height: 900 } });

test("each level shows a pill with its own symbol and word, below the taken-cores table", async ({ page }) => {
  await signIn(page);
  const seen: Record<string, string | null> = {};
  for (const [level, word, key] of [["amber", "Over 3%", "amber"], ["red", "Over 7%", "red"], ["off_scale", "Off scale (over 10%)", "off"], ["green", "Below calculated", "below"]] as const) {
    await pick(page, SPANS[key]);
    const pill = card(page).locator(`.pill[data-level=${level}]`);
    await expect(pill).toHaveText(word);
    seen[level] = await pill.locator("svg").getAttribute("data-icon");
    // contrast of the pill text on its own background
    const r = await contrast(page, { pill: `[data-testid=loss-card] .pill[data-level=${level}]` });
    expect(r.pill, `${level} ${r.pill.toFixed(2)}`).toBeGreaterThanOrEqual(4.5);
  }
  expect(new Set(Object.values(seen)).size).toBe(4); // four symbols, never colour alone
  // placement: the Loss card comes after "Allocations"
  const held = await page.getByRole("region", { name: /^Allocations/ }).boundingBox();
  const loss = await card(page).boundingBox();
  expect(loss!.y).toBeGreaterThan(held!.y);
});

test("amber span: metrics and history newest first", async ({ page }) => {
  await signIn(page);
  await pick(page, SPANS.amber);
  const c = card(page);
  await expect(c).toContainText("3.60 dB");
  await expect(c).toContainText("12 km × 0.3 dB/km");
  await expect(c).toContainText("3.78 dB");
  await expect(c).toContainText("+5.0% of calculated");
  const rows = c.getByTestId("loss-history").locator("tbody tr");
  expect(await rows.count()).toBeGreaterThan(0);
  expect(await rows.count()).toBeLessThanOrEqual(5);
  // the first history row is the latest measurement shown above it
  await expect(rows.first()).toContainText("3.78 dB");
  await expect(rows.first().locator("th")).toHaveText((await c.getByText(/^\d{4}-\d{2}-\d{2}, /).textContent())!.slice(0, 10));
  await c.locator(".card-h").scrollIntoViewIfNeeded();
  await page.screenshot({ path: "e2e/screenshots/loss-amber.png" });
});

test("no distance span: says so and never shows 0 dB", async ({ page }) => {
  await signIn(page);
  await page.getByRole("list", { name: "Spans" }).getByRole("button", { name: SPANS.noDistance }).click();
  const c = card(page);
  await expect(c).toContainText("No distance in the Excel, so no calculated loss.");
  await expect(c).toContainText("No distance");
  await expect(c).not.toContainText("0.00 dB");
  await expect(c).not.toContainText(/\b0 dB/);
  await expect(page.getByTestId("inspector-loss")).toContainText("Not measured");
  await c.scrollIntoViewIfNeeded();
  await page.screenshot({ path: "e2e/screenshots/loss-no-distance.png" });
});

test("Inspector loss line and See loss moves focus to the Loss card", async ({ page }) => {
  await signIn(page);
  await pick(page, SPANS.amber);
  const line = page.getByTestId("inspector-loss");
  await expect(line).toContainText("3.78 dB measured, +5.0%");
  await expect(line.locator(".pill[data-level=amber]")).toHaveText("Over 3%");
  await line.scrollIntoViewIfNeeded();
  await page.screenshot({ path: "e2e/screenshots/inspector-loss.png" });
  await line.getByRole("button", { name: "See loss" }).click();
  const h = card(page).getByRole("heading", { name: /^Loss of/ });
  await expect(h).toBeFocused();
  await expect(h).toBeInViewport();
  // Find list marks amber-or-worse spans with a symbol and text
  await expect(page.getByRole("list", { name: "Spans" }).getByRole("button", { name: SPANS.red })).toContainText("Loss Over 7%");
});
