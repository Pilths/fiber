import { expect, test, type Page } from "@playwright/test";
import { pickSpan, signIn, tab } from "./helpers";

const SPAN = "DEV Kuala Lumpur DC - DEV Cyberjaya DC";
const nav = (page: Page) => page.getByRole("navigation", { name: "Main" });

test("tabs by role: planner sees Map and My reservations; admin (via dev switcher) also Approvals and Upload", async ({ page }) => {
  await signIn(page, "planner1");
  await expect(nav(page).getByRole("button", { name: "Map" })).toHaveAttribute("aria-current", "page");
  await expect(nav(page).getByRole("button", { name: "Reserve" })).toBeVisible();
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

test("selecting a span from Find (Reserve tab) writes the hash and shows it on the Map; the hash restores it", async ({ page }) => {
  await signIn(page);
  await tab(page, "Reserve");
  await page.getByRole("list", { name: "Spans" }).getByRole("button", { name: new RegExp(SPAN) }).click();
  await tab(page, "Map");
  await expect(page.locator("#span-h", { hasText: SPAN })).toBeVisible();
  await expect(page.getByRole("region", { name: "Inspector" })).toContainText("Free to reserve");
  await expect(page).toHaveURL(new RegExp(`#span=${encodeURIComponent(SPAN)}$`));

  const other = await page.context().newPage();
  await other.goto(`/#span=${encodeURIComponent(SPAN)}`);
  await expect(other.locator("#span-h", { hasText: SPAN })).toBeVisible();

  // Details scrolls to the span detail
  await other.getByRole("button", { name: "Open span details" }).click();
  await expect(other.getByRole("heading", { name: "Cores", exact: true })).toBeInViewport();
  await tab(other, "Reserve");
  await expect(other.getByRole("list", { name: "Spans" }).getByRole("button", { pressed: true })).toContainText(SPAN);
});

test("the Inspector has no tab strip and no eyebrow: the span name is its first line", async ({ page }) => {
  await signIn(page);
  const ins = page.getByRole("region", { name: "Inspector" });
  await expect(ins.getByRole("tab")).toHaveCount(0);
  await pickSpan(page, SPAN);
  await expect(ins.getByRole("heading", { level: 3 })).toHaveText(SPAN);
  await expect(ins).not.toContainText("Selected span");
  await expect(ins).not.toContainText("Later");
});
