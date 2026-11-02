import { expect, test, type Page } from "@playwright/test";
import { pickSegment, signIn } from "./helpers";

const SEGMENT = "DEV Kuala Lumpur DC - DEV Cyberjaya DC";
const nav = (page: Page) => page.getByRole("navigation", { name: "Main" });

test("tabs by role: planner sees Inventory and My reservations; admin (via dev switcher) also Approvals and Upload", async ({ page }) => {
  await signIn(page, "planner1");
  await expect(nav(page).getByRole("button", { name: "Inventory" })).toHaveAttribute("aria-current", "page");
  await expect(nav(page).getByRole("button", { name: "Reserve" })).toHaveCount(0); // reserving opens from the segment
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

test("selecting a segment from the segment list writes the hash and shows its diagram and cores; the hash restores it", async ({ page }) => {
  await signIn(page);
  await pickSegment(page, SEGMENT);
  await expect(page.getByRole("region", { name: "Segment list" }).getByRole("button", { pressed: true })).toContainText(SEGMENT);
  await expect(page.getByRole("heading", { name: "Cores", exact: true })).toBeVisible();
  await expect(page).toHaveURL(new RegExp(`#segment=${encodeURIComponent(SEGMENT)}$`));

  const other = await page.context().newPage();
  await other.goto(`/#segment=${encodeURIComponent(SEGMENT)}`);
  await expect(other.locator("#segment-h", { hasText: SEGMENT })).toBeVisible();
  await expect(other.getByRole("region", { name: "Segment list" }).getByRole("button", { pressed: true })).toContainText(SEGMENT);
});

test("Inventory has no Inspector and no eyebrow labels", async ({ page }) => {
  await signIn(page);
  await pickSegment(page, SEGMENT);
  await expect(page.getByRole("region", { name: "Inspector" })).toHaveCount(0);
  await expect(page.locator("main")).not.toContainText("Selected segment");
});
