import { expect, test, type Page } from "@playwright/test";
import { pickSegment, signIn } from "./helpers";

// Loss belongs to a core. Dev seed: KL DC - Bukit Jalil has a measured core; Bukit Jalil - Kuantan has no distance.
const SEGMENTS = {
  measured: /^DEV Kuala Lumpur DC - DEV Bukit Jalil TOC/,
  noDistance: /^DEV Bukit Jalil TOC - DEV Kuantan Hut/,
};
const pick = (page: Page, name: RegExp) => pickSegment(page, name);

test.use({ viewport: { width: 1440, height: 900 } });

test("segment-level views show no per-core loss; the diagram totals keep the segment loss", async ({ page }) => {
  await signIn(page);
  await pick(page, SEGMENTS.measured);
  await expect(page.getByTestId("route-totals")).toContainText(/(Total|Calculated) loss[\d.]+ dB/);
  await expect(page.getByRole("region", { name: "Segment list" })).not.toContainText("dB");
  await expect(page.getByRole("table", { name: /^Cores of / }).locator("thead")).not.toContainText("Loss"); // no loss column
});

// Per-core loss moves to core details in step C (docs/build-layout-plan.md); the inline row detail is gone.
test.fixme("a measured core: its Calculated loss and Measured loss in core details", async () => {});

test("no distance segment: dashes, never 0 dB", async ({ page }) => {
  await signIn(page);
  await pick(page, SEGMENTS.noDistance);
  const totals = page.getByTestId("route-totals");
  await expect(totals).toContainText("Distance-");
  await expect(totals).toContainText(/loss-Average loss per km-/);
  await expect(page.getByTestId("segment-diagram")).not.toContainText("0.00 dB");
});
