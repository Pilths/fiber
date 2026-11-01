import { expect, test } from "@playwright/test";
import { signIn } from "./helpers";

// Dev seed: Cyberjaya DC to Kuantan Hut has several paths; the search shows the best one.
test.use({ viewport: { width: 1440, height: 900 } });

test("route search, pick a segment in the diagram: totals, Inspector loss facts, core table filter and row detail", async ({ page }) => {
  // The option with the most segments first, so the diagram shows a long chain.
  await page.route("**/api/routes?*", async (r) => {
    const j = (await (await r.fetch()).json()) as { options: { segments: unknown[] }[] };
    r.fulfill({ json: { ...j, options: j.options.toSorted((x, y) => y.segments.length - x.segments.length) } });
  });
  await signIn(page);
  await expect(page.getByRole("region", { name: "Find" })).toHaveCount(0); // the Map page is view only
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
  await expect(page.getByTestId("segment-card")).toHaveCount(0); // its facts live in the Inspector
  const card = page.getByTestId("segment-facts");
  await expect(card).toHaveText(/^Distance[\d.]+ kmFree cores(\d+ of \d+|-)Cable size\d+(Total|Calculated) loss[\d.]+ dB(, [^A]+)?Average loss per km[\d.]+ dB\/km$/);
  await expect(page.locator("body")).not.toContainText("Worst core");
  await expect(page.getByRole("region", { name: "Inspector" }).getByText("Segments on route")).toHaveCount(0);

  await page.getByRole("button", { name: "Go to cores" }).click();
  await expect(page.getByRole("heading", { name: `Cores of ${name}` })).toBeInViewport();
  const table = page.getByRole("table", { name: `Cores of ${name}` });
  const chips = page.getByRole("group", { name: "Filter cores by status" });
  await chips.getByRole("button", { name: /^Available/ }).click();
  const avail = Number((await chips.getByRole("button", { name: /^Available/ }).textContent())!.replace(/\D/g, ""));
  await expect(table.locator("tbody > tr[data-core]")).toHaveCount(avail);
  await expect(table.locator("tbody")).not.toContainText("None"); // empty cells show "-"
  await chips.getByRole("button", { name: /^All/ }).click();

  // a held core if the segment has one, else a core with a loss test, else the first core
  await expect(page.getByTestId("inspector-loss")).not.toContainText("Loading");
  const all = table.locator("tbody > tr[data-core]");
  const held = all.filter({ hasText: /Reserved|In service/ }), measured = table.locator("tbody > tr[data-core]:has([data-level])");
  const row = (await held.count()) ? held.first() : (await measured.count()) ? measured.first() : all.first();
  const core = await row.getAttribute("data-core");
  await row.getByRole("button", { name: `Core ${core} details` }).click();
  await expect(row.getByRole("button", { name: `Core ${core} details` })).toHaveAttribute("aria-expanded", "true");
  const detail = page.getByTestId("core-detail");
  await expect(detail).toHaveCount(1);
  const fields = detail.getByTestId("core-fields");
  await expect(fields.locator("dt")).toHaveText(["SRF ID", "Customer", "Planner", "Planned date", "Status", "Port A", "Port B", "Circuit ID", "Loss", "Average loss per km", "Difference vs calculated"]);
  await expect(fields.getByText("SRF ID", { exact: true })).toBeVisible();
  await expect(fields.getByText("Planner", { exact: true })).toBeVisible();
  await expect(fields.locator("dd").filter({ hasText: /^$/ })).toHaveCount(0); // empty values show "-"
  await expect(detail.getByTestId("core-tests").or(detail.getByTestId("core-no-loss"))).toBeVisible();
  await expect(detail.getByRole("button", { name: "History and actions" })).toBeVisible();
  await page.evaluate(() => scrollTo(0, 0)); // the sticky header stays at the top of the full-page shot
  await page.screenshot({ path: "e2e/screenshots/network-detail.png", fullPage: true });
});

test("Reserve tab: Find list, core grid with chosen bar and Allocations", async ({ page }) => {
  await signIn(page);
  await page.getByRole("button", { name: "Reserve" }).click();
  await page.getByRole("list", { name: "Segments" }).getByRole("button", { name: /^DEV Kuala Lumpur DC - DEV Cyberjaya DC/ }).click();
  await expect(page.getByRole("grid", { name: "Cores" })).toBeVisible();
  await expect(page.getByRole("heading", { name: /^Allocations/ })).toBeVisible();
  await page.screenshot({ path: "e2e/screenshots/reserve-tab.png", fullPage: true });
});
