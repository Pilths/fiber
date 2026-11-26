import { expect, test, type Page } from "@playwright/test";
import { signIn } from "./helpers";

test.use({ viewport: { width: 1440, height: 900 } });

async function openUpload(page: Page) {
  await signIn(page, "admin1");
  await page.getByRole("navigation", { name: "Main" }).getByRole("button", { name: "Upload" }).click();
}

const count = (page: Page, id: "segment-count" | "site-count") => page.getByTestId(id);
// Waits until the list has loaded (the count is 0 before that).
async function numberOf(page: Page, id: "segment-count" | "site-count") {
  await expect(count(page, id)).not.toHaveText(/^0 /);
  return Number((await count(page, id).innerText()).replace(/\D/g, ""));
}

test("Segments: Site filter and the No route only chip change the count", async ({ page }) => {
  await openUpload(page);
  const all = await numberOf(page, "segment-count");
  expect(all).toBeGreaterThan(0);
  await page.getByLabel("Site", { exact: true }).selectOption({ label: "DEV Cyberjaya DC" });
  await expect(count(page, "segment-count")).not.toHaveText(`${all} segments`);
  const bySite = await numberOf(page, "segment-count");
  await expect(page.getByRole("button", { name: "Add segment" })).toBeVisible();
  await page.getByRole("button", { name: "No route only" }).click();
  await expect(page.getByRole("button", { name: "No route only" })).toHaveAttribute("aria-pressed", "true");
  expect(await numberOf(page, "segment-count")).toBeLessThanOrEqual(bySite);
  await page.getByRole("button", { name: "Not registered only" }).click();
  await expect(page.getByRole("table", { name: "Segments" })).toBeVisible();
});

test("Segments: pager text shows the range", async ({ page }) => {
  await openUpload(page);
  const total = await numberOf(page, "segment-count");
  const last = Math.min(total, 50);
  await expect(page.getByTestId("pager-info").first()).toHaveText(`1-${last} of ${total}`);
  if (total > 50) {
    await page.getByRole("button", { name: "Next" }).first().click();
    await expect(page.getByTestId("pager-info").first()).toContainText(`51-`);
  }
});

test("Sites: search narrows the list; Add site with a dash shows the error", async ({ page }) => {
  await openUpload(page);
  await page.getByRole("tab", { name: "Sites" }).click();
  const all = await numberOf(page, "site-count");
  await page.getByLabel("Search sites").fill("Cyberjaya");
  await expect(count(page, "site-count")).not.toHaveText(`${all} sites`);
  await expect(page.getByRole("table", { name: "Sites" })).toContainText("DEV Cyberjaya DC");

  await page.getByRole("button", { name: "Add site" }).click();
  const box = page.getByRole("dialog", { name: "Add site" });
  await box.getByLabel("Name").fill("E2E-Dash");
  await box.getByRole("button", { name: "Add site" }).click();
  await expect(box.getByRole("alert")).toContainText(/-/);
  await box.getByRole("button", { name: "Cancel" }).click();
});

test("Sites: the Segments count opens the Segments tab filtered by that site", async ({ page }) => {
  await openUpload(page);
  await page.getByRole("tab", { name: "Sites" }).click();
  await page.getByLabel("Search sites").fill("DEV Cyberjaya DC");
  const link = page.getByRole("button", { name: "Segments of DEV Cyberjaya DC" });
  const segments = Number(await link.innerText());
  await link.click();
  await expect(page.getByRole("tab", { name: "Segments" })).toHaveAttribute("aria-selected", "true");
  await expect(page.getByLabel("Site", { exact: true })).toHaveValue(/\d+/);
  await expect(count(page, "segment-count")).toHaveText(new RegExp(`^${segments} segments?$`));
});
