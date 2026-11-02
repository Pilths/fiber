import { expect, test } from "@playwright/test";
import { openReserve, signIn } from "./helpers";

// Dev seed: Cyberjaya DC to Kuantan Hut has several paths; the search shows the best one.
test.use({ viewport: { width: 1440, height: 900 } });

test("route search, pick a segment in the diagram: totals, one Cores table with chips, ranges and core details", async ({ page }) => {
  // The option with the most segments first, so the diagram shows a long chain.
  await page.route("**/api/routes?*", async (r) => {
    const j = (await (await r.fetch()).json()) as { options: { segments: unknown[] }[] };
    r.fulfill({ json: { ...j, options: j.options.toSorted((x, y) => y.segments.length - x.segments.length) } });
  });
  await signIn(page);
  await expect(page.getByRole("region", { name: "Inspector" })).toHaveCount(0);
  const search = page.getByRole("region", { name: "Route search" });
  await search.getByLabel("Route A").fill("DEV Cyberjaya DC");
  await search.getByLabel("Route B").fill("DEV Kuantan Hut");
  await search.getByRole("button", { name: "Search" }).click();
  await expect(page.getByTestId("route-found")).toHaveText(/^\d+ segments?, [\d.]+ km$/);

  const diagram = page.getByTestId("segment-diagram");
  const segs = diagram.getByRole("list", { name: "Segments on the route" }).getByRole("button");
  await expect(segs.first()).toHaveAttribute("aria-pressed", "true");
  const n = await segs.count();
  await expect(diagram.getByTestId("route-totals")).toHaveText(new RegExp(`^Segments${n}Distance[\\d.]+ km(Total|Calculated) loss[\\d.]+ dBAverage loss per km[\\d.]+ dB/km$`));
  await expect(diagram).not.toContainText("No distance");

  const last = segs.filter({ hasText: /\d km/ }).last(); // a segment with a distance, so it has a calculated loss
  const name = (await last.getAttribute("aria-label"))!.replace(/^Segment /, "");
  await last.click();
  await expect(last).toHaveAttribute("aria-pressed", "true");
  await expect(page.locator("#segment-h")).toHaveText(name);
  await expect(page.locator("body")).not.toContainText("Worst core");

  // One Cores table: chips with counts, columns, holders first, ranges collapsed.
  const table = page.getByRole("table", { name: `Cores of ${name}` });
  await expect(table.locator("thead th")).toHaveText(["Cores", "Status", "Customer", "Planner", "SRF", "Planned", "Age", "Ports"]);
  const chips = page.getByRole("group", { name: "Filter cores" });
  await expect(chips.getByRole("button")).toHaveText([/^All \d+$/, /^Free \d+$/, /^In use \d+$/, /^Unassigned \d+$/]);
  const statuses = await table.locator("tbody > tr > td:nth-child(2)").allInnerTexts();
  const firstFree = statuses.findIndex((t) => t.startsWith("Available"));
  if (firstFree >= 0) expect(statuses.slice(firstFree).every((t) => t.startsWith("Available"))).toBe(true); // holders first
  await chips.getByRole("button", { name: /^Free/ }).click();
  await expect(table.locator("tbody > tr > td:nth-child(2)").filter({ hasNotText: "Available" })).toHaveCount(0);
  await expect(table.locator("tbody")).not.toContainText("None"); // empty cells show "-"
  await chips.getByRole("button", { name: /^All/ }).click();

  // A run of cores expands to one row per core; a row click opens core details.
  const run = table.getByRole("button", { name: /^Cores \d+-\d+, show each core$/ }).first();
  if (await run.count()) {
    const [lo, hi] = /(\d+)-(\d+)/.exec((await run.getAttribute("aria-label"))!)!.slice(1).map(Number);
    await run.click();
    await expect(run).toHaveAttribute("aria-expanded", "true");
    await expect(table.getByRole("button", { name: `Core ${hi} details`, exact: true })).toBeVisible();
    expect(hi).toBeGreaterThan(lo);
  }
  await table.locator("tbody > tr").first().click();
  await expect(page.getByRole("dialog", { name: /^Core \d+ on / })).toBeVisible();
  await page.keyboard.press("Escape");
  await page.evaluate(() => scrollTo(0, 0)); // the sticky header stays at the top of the full-page shot
  await page.screenshot({ path: "e2e/screenshots/network-detail.png", fullPage: true });
});

test("Reserve cores on the segment diagram opens the core grid with the chosen bar", async ({ page }) => {
  await signIn(page);
  await openReserve(page, /^DEV Kuala Lumpur DC - DEV Cyberjaya DC/);
  await expect(page.getByRole("grid", { name: "Cores" })).toBeVisible();
  await expect(page.getByRole("heading", { name: /^Allocations/ })).toHaveCount(0); // merged into the Cores table
  await page.screenshot({ path: "e2e/screenshots/reserve-tab.png", fullPage: true });
});
