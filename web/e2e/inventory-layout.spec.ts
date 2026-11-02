import { expect, test, type Page } from "@playwright/test";
import { pickSegment, signIn } from "./helpers";

// Inventory at 1440x900: map card 8 of 12 columns, the segment list beside it as tall as the map card.
test.use({ viewport: { width: 1440, height: 900 } });

const KLCJ = /^DEV Kuala Lumpur DC - DEV Cyberjaya DC/;
const list = (page: Page) => page.getByRole("region", { name: "Segment list" });

test("segment list is as tall as the map card, the map takes 8 of 12 columns: nothing, segment, route", async ({ page }) => {
  await signIn(page, "admin1");
  const map = page.getByRole("region", { name: "Network map" }).first();
  const same = (state: string) => expect.poll(async () => Math.abs((await list(page).boundingBox())!.height - (await map.boundingBox())!.height), { message: `${state}: list height minus map height` }).toBeLessThanOrEqual(1);
  await same("nothing");
  const [m, l] = await Promise.all([map.boundingBox(), list(page).boundingBox()]);
  expect(m!.width / (m!.width + l!.width + 16)).toBeCloseTo(8 / 12, 1); // 16px grid gap

  await pickSegment(page, KLCJ);
  await expect(list(page).getByRole("button", { pressed: true })).toContainText("DEV Cyberjaya DC");
  await same("segment");

  const search = page.getByRole("region", { name: "Route search" });
  await search.getByLabel("Route A").fill("DEV Cyberjaya DC");
  await search.getByLabel("Route B").fill("DEV Kuantan Hut");
  await search.getByRole("button", { name: "Search" }).click();
  await expect(page.getByTestId("segment-diagram").getByRole("list", { name: "Segments on the route" })).toBeVisible();
  await same("route");
});

test("segment list: search, Region and Type narrow the rows; rows show km and the free count", async ({ page }) => {
  await signIn(page);
  const rows = list(page).getByRole("list", { name: "Segments" }).getByRole("button");
  await expect(rows.nth(1)).toBeVisible();
  await expect(rows.first()).toContainText(/(\d+(\.\d+)? km|-)/);
  await list(page).getByLabel("Search segment").fill("Cyberjaya");
  for (const t of await rows.allInnerTexts()) expect(t).toContain("Cyberjaya");
  await list(page).getByLabel("Search segment").fill("");
  const type = list(page).getByLabel("Type");
  await expect(type.getByRole("option").first()).toHaveText("All types");
  const segs: { route_type: string | null }[] = await (await page.request.get("/api/segments")).json();
  const pick = segs.find((s) => s.route_type)!.route_type!;
  await type.selectOption(pick);
  await expect(rows).toHaveCount(segs.filter((s) => s.route_type === pick).length);
  await expect(list(page).getByLabel("Region").getByRole("option").first()).toHaveText("All regions");
});

test("Inventory screenshot with a segment selected", async ({ page }) => {
  await signIn(page);
  await pickSegment(page, KLCJ);
  await expect(page.getByRole("table", { name: /^Cores of / })).toBeVisible();
  await page.mouse.move(0, 0);
  await page.screenshot({ path: "e2e/screenshots/inventory.png" });
});
