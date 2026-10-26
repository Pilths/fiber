import { expect, test, type Page } from "@playwright/test";
import { signIn } from "./helpers";

const SPAN = "DEV Kuala Lumpur DC - DEV Cyberjaya DC";
const nav = (page: Page) => page.getByRole("navigation", { name: "Main" });

test("tabs by role: planner sees Map and My reservations; admin (via dev switcher) also Approvals and Upload", async ({ page }) => {
  await signIn(page, "planner1");
  await expect(nav(page).getByRole("button", { name: "Map" })).toHaveAttribute("aria-current", "page");
  await expect(nav(page).getByRole("button", { name: /My reservations/ })).toBeVisible();
  await expect(nav(page).getByRole("button", { name: /Approvals/ })).toHaveCount(0);
  await expect(nav(page).getByRole("button", { name: /Upload/ })).toHaveCount(0);

  await page.getByRole("button", { name: /Planner/ }).click();
  const menu = page.getByRole("menu", { name: "Account" });
  await expect(menu.getByRole("menuitem", { name: "Users" })).toHaveCount(0);
  await expect(menu.getByRole("menuitem", { name: "Sign out" })).toBeVisible();
  await menu.getByLabel("Dev user").selectOption("admin1");
  await expect(nav(page).getByRole("button", { name: /Approvals/ })).toBeVisible();
  await expect(nav(page).getByRole("button", { name: /Upload/ })).toBeVisible();
  await page.getByRole("button", { name: /Admin/ }).click();
  await expect(page.getByRole("menu", { name: "Account" }).getByRole("menuitem", { name: "Users" })).toBeVisible();
});

test("selecting a span from Find shows the cores section and writes the hash; the hash restores it", async ({ page }) => {
  await signIn(page);
  await page.getByRole("list", { name: "Spans" }).getByRole("button", { name: new RegExp(SPAN) }).click();
  await expect(page.getByRole("heading", { name: `Cores of ${SPAN}` })).toBeVisible();
  await expect(page.getByRole("tabpanel", { name: "Cores" })).toContainText("Free to reserve");
  await expect(page).toHaveURL(new RegExp(`#span=${encodeURIComponent(SPAN)}$`));

  const other = await page.context().newPage();
  await other.goto(`/#span=${encodeURIComponent(SPAN)}`);
  await expect(other.getByRole("heading", { name: `Cores of ${SPAN}` })).toBeVisible();
  await expect(other.getByRole("list", { name: "Spans" }).getByRole("button", { pressed: true })).toContainText(SPAN);

  // Go to cores focuses the first Available core
  await other.getByRole("button", { name: "Go to cores" }).click();
  await expect(other.locator('[role=gridcell][data-status="Available"]').first()).toBeFocused();
});

test("Site and Services tabs are disabled but focusable", async ({ page }) => {
  await signIn(page);
  for (const name of ["Site", "Services"]) {
    const tab = page.getByRole("tab", { name: new RegExp(`^${name}`) });
    await expect(tab).toHaveAttribute("aria-disabled", "true");
    await expect(tab).toContainText("Later");
    await tab.focus();
    await expect(tab).toBeFocused();
  }
  await expect(page.getByRole("tab", { name: "Cores" })).toHaveAttribute("aria-selected", "true");
});
