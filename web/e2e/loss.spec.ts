import { expect, test, type Page } from "@playwright/test";
import { openCore, pickSegment, signIn } from "./helpers";

// Loss belongs to a core. Dev seed: KL DC - Bukit Jalil has a measured core; Bukit Jalil - Kuantan has no distance.
const SEGMENTS = {
  measured: /^DEV Kuala Lumpur DC - DEV Bukit Jalil TOC/,
  noDistance: /^DEV Bukit Jalil TOC - DEV Kuantan Hut/,
};
const pick = (page: Page, name: RegExp) => pickSegment(page, name);

test.use({ viewport: { width: 1440, height: 900 } });

test("segment-level views show no loss: diagram totals and Cores table", async ({ page }) => {
  await signIn(page);
  await pick(page, SEGMENTS.measured);
  await expect(page.getByTestId("route-totals")).toHaveText(/^Segments1Distance[\d.]+ km$/);
  await expect(page.getByRole("table", { name: /^Cores of / }).getByRole("columnheader", { name: /loss/i })).toHaveCount(0); // no loss column
});

test("a measured core: its Calculated loss and Measured loss in core details", async ({ page }) => {
  await signIn(page);
  await pick(page, SEGMENTS.measured);
  const segs: { id: number; site_a: string; site_b: string }[] = await (await page.request.get("/api/segments")).json();
  const seg = segs.find((s) => SEGMENTS.measured.test(`${s.site_a} - ${s.site_b}`))!;
  const loss = await (await page.request.get(`/api/loss/segments/${seg.id}`)).json();
  const core = loss.cores[0] as { core_number: number; measured_db: number; calculated_db: number | null; history: unknown[] };
  await openCore(page, core.core_number);
  const d = page.getByRole("dialog", { name: new RegExp(`^Core ${core.core_number} on `) });
  const row = (k: string) => d.locator("dt", { hasText: new RegExp(`^${k}$`) }).locator("xpath=following-sibling::dd[1]");
  await expect(row("Calculated loss")).toHaveText(/^\d+\.\d\d dB$/);
  await expect(row("Measured loss")).toContainText(core.measured_db.toFixed(2) + " dB");
  await expect(d.locator("dt", { hasText: /^Loss$/ })).toHaveCount(0); // never just "Loss"
  await expect(d.getByRole("list", { name: "Measured loss tests, newest first" }).locator("li")).toHaveCount(core.history.length);
  await d.screenshot({ path: "e2e/screenshots/core-details.png" });
});

test("no distance segment: dashes, never 0 dB", async ({ page }) => {
  await signIn(page);
  await pick(page, SEGMENTS.noDistance);
  const totals = page.getByTestId("route-totals");
  await expect(totals).toContainText("Distance-");
  await expect(totals).not.toContainText("loss");
  await expect(page.getByTestId("segment-diagram")).not.toContainText("0.00 dB");
});
