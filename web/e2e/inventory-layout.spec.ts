import { expect, test } from "@playwright/test";
import { pickSegment, signIn } from "./helpers";

// Inventory at 1440x900: map card 8 of 12 columns, the Site A to B panel beside it as tall as the map card.
test.use({ viewport: { width: 1440, height: 900 } });

const KLCJ = /^DEV Kuala Lumpur DC - DEV Cyberjaya DC/;

test("Site A to B panel is as tall as the map card, the map takes 8 of 12 columns: nothing, segment, route", async ({ page }) => {
  await signIn(page, "admin1");
  const map = page.getByRole("region", { name: "Network map" }).first();
  const panel = page.getByRole("region", { name: "Site A to B" });
  const same = (state: string) => expect.poll(async () => {
    const [m, p] = await Promise.all([map.boundingBox(), panel.boundingBox()]);
    return Math.max(Math.abs(m!.height - p!.height), Math.abs(m!.y - p!.y));
  }, { message: `${state}: panel vs map card, top and height` }).toBeLessThanOrEqual(1);
  await same("nothing");
  const [m, p] = await Promise.all([map.boundingBox(), panel.boundingBox()]);
  expect(m!.width / (m!.width + p!.width + 16)).toBeCloseTo(8 / 12, 1); // 16px grid gap
  await expect(page.getByRole("region", { name: "Segment list" })).toHaveCount(0);
  await expect(page.getByRole("region", { name: "Route options" })).toHaveCount(0); // nothing below before a search

  await pickSegment(page, KLCJ);
  await same("segment");

  await panel.getByLabel("Site A").fill("DEV Cyberjaya DC");
  await panel.getByLabel("Site B").fill("DEV Kuantan Hut");
  await panel.getByRole("button", { name: "Find route" }).click();
  await expect(page.getByTestId("segment-diagram").getByRole("list", { name: "Segments on the route" })).toBeVisible();
  await expect(panel.getByTestId("route-option").first()).toBeVisible();
  await same("route");
});

test("Inventory screenshot with a segment selected", async ({ page }) => {
  await signIn(page);
  await pickSegment(page, KLCJ);
  await expect(page.getByRole("table", { name: /^Cores of / })).toBeVisible();
  await page.mouse.move(0, 0);
  await page.screenshot({ path: "e2e/screenshots/inventory.png" });
});
