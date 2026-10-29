import { expect, test } from "@playwright/test";
import { signIn } from "./helpers";

// Dev seed: Cyberjaya DC to Kuantan Hut has several paths; the search shows the best one.
test.use({ viewport: { width: 1440, height: 900 } });

test("route search, pick a span on the route, Details, pick a core: core info and its loss", async ({ page }) => {
  await signIn(page);
  const search = page.getByRole("region", { name: "Route search" });
  await search.getByLabel("Route A").fill("DEV Cyberjaya DC");
  await search.getByLabel("Route B").fill("DEV Kuantan Hut");
  await search.getByRole("button", { name: "Search" }).click();
  await expect(page.getByTestId("route-found")).toHaveText(/^\d+ spans?, [\d.]+ km$/);

  const rows = page.getByRole("list", { name: "Spans on route" }).getByRole("button");
  await expect(rows.first()).toBeVisible();
  const last = rows.last();
  const name = (await last.locator("span").first().textContent())!;
  await last.click();
  await expect(last).toHaveAttribute("aria-pressed", "true");
  await expect(page.locator("#span-h")).toHaveText(name);

  await page.getByRole("button", { name: "Open span details" }).click();
  await expect(page.getByRole("heading", { name: "Cores", exact: true })).toBeInViewport();

  await expect(page.getByTestId("inspector-loss")).not.toContainText("Loading");
  // a core with a loss test if the span has one, else the first core
  const measured = page.locator("[role=gridcell]:has(.lm)");
  const cell = (await measured.count()) ? measured.first() : page.getByRole("gridcell").first();
  const n = (await cell.locator(".n").textContent())!;
  await cell.click({ force: true }); // taken cells are aria-disabled, which Playwright treats as disabled
  await expect(cell).toHaveAttribute("data-current", "true");
  const card = page.getByTestId("core-card");
  await expect(card.getByRole("heading", { name: `Core ${n} of ${name}` })).toBeVisible();
  await expect(card).toContainText("Status");
  await expect(card).toContainText("Circuit ID");
  await expect(card.getByTestId("core-loss").or(card.getByTestId("core-no-loss"))).toBeVisible();
  await page.screenshot({ path: "e2e/screenshots/network-detail.png", fullPage: true });
});
