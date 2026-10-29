import { expect, test } from "@playwright/test";
import { signIn } from "./helpers";

// Dev seed: Cyberjaya DC to Kuantan Hut has several paths; the search shows the best one.
test.use({ viewport: { width: 1440, height: 900 } });

test("route search, pick a span in the diagram: totals, Span card loss, core table filter and row detail", async ({ page }) => {
  await signIn(page);
  await expect(page.getByRole("region", { name: "Find" })).toHaveCount(0); // the Map page is view only
  const search = page.getByRole("region", { name: "Route search" });
  await search.getByLabel("Route A").fill("DEV Cyberjaya DC");
  await search.getByLabel("Route B").fill("DEV Kuantan Hut");
  await search.getByRole("button", { name: "Search" }).click();
  await expect(page.getByTestId("route-found")).toHaveText(/^\d+ spans?, [\d.]+ km$/);

  const diagram = page.getByTestId("span-diagram");
  const segs = diagram.getByRole("list", { name: "Spans on the route" }).getByRole("button");
  await expect(segs.first()).toHaveAttribute("aria-pressed", "true");
  const n = await segs.count();
  await expect(diagram.getByTestId("route-totals")).toHaveText(new RegExp(`^${n} spans?, [\\d.]+ km, total loss [\\d.]+ dB( calculated)?, average [\\d.]+ dB/km(, \\d+ spans? without distance not counted)?$`));

  const last = segs.filter({ hasText: /\d km/ }).last(); // a span with a distance, so it has a calculated loss
  const name = (await last.locator(".sr-only").first().textContent())!.replace(/,$/, "");
  await last.click();
  await expect(last).toHaveAttribute("aria-pressed", "true");
  await expect(page.locator("#span-h")).toHaveText(name);
  const card = page.getByTestId("span-card");
  await expect(card).toContainText(/Total loss[\d.]+ dB/);
  await expect(card).toContainText(/Average loss per km([\d.]+ dB\/km|No distance)/);
  await expect(card).toContainText("Cores measured");

  await page.getByRole("button", { name: "Open span details" }).click();
  await expect(page.getByRole("heading", { name: "Cores", exact: true })).toBeInViewport();
  const table = page.getByRole("table", { name: `Cores of ${name}` });
  const chips = page.getByRole("group", { name: "Filter cores by status" });
  await chips.getByRole("button", { name: /^Available/ }).click();
  const avail = Number((await chips.getByRole("button", { name: /^Available/ }).textContent())!.replace(/\D/g, ""));
  await expect(table.locator("tbody > tr[data-core]")).toHaveCount(avail);
  await chips.getByRole("button", { name: /^All/ }).click();

  // a core with a loss test if the span has one, else the first core
  await expect(page.getByTestId("inspector-loss")).not.toContainText("Loading");
  const measured = table.locator("tbody > tr[data-core]:has([data-level])");
  const row = (await measured.count()) ? measured.first() : table.locator("tbody > tr[data-core]").first();
  const core = await row.getAttribute("data-core");
  await row.getByRole("button", { name: `Core ${core} details` }).click();
  await expect(row.getByRole("button", { name: `Core ${core} details` })).toHaveAttribute("aria-expanded", "true");
  const detail = page.getByTestId("core-detail");
  await expect(detail).toHaveCount(1);
  await expect(detail).toContainText("Circuit ID");
  await expect(detail.getByTestId("core-tests").or(detail.getByTestId("core-no-loss"))).toBeVisible();
  await expect(detail.getByRole("button", { name: "History and actions" })).toBeVisible();
  await page.evaluate(() => scrollTo(0, 0)); // the sticky header stays at the top of the full-page shot
  await page.screenshot({ path: "e2e/screenshots/network-detail.png", fullPage: true });
});

test("Reserve tab: Find list, core grid with chosen bar and Allocations", async ({ page }) => {
  await signIn(page);
  await page.getByRole("button", { name: "Reserve" }).click();
  await page.getByRole("list", { name: "Spans" }).getByRole("button", { name: /^DEV Kuala Lumpur DC - DEV Cyberjaya DC/ }).click();
  await expect(page.getByRole("grid", { name: "Cores" })).toBeVisible();
  await expect(page.getByRole("heading", { name: /^Allocations/ })).toBeVisible();
  await page.screenshot({ path: "e2e/screenshots/reserve-tab.png", fullPage: true });
});
