import { expect, type Page } from "@playwright/test";

export const DEV_PASSWORD = process.env.DEV_PASSWORD ?? "dev-password-123";

// Signs in through the login form; the session cookie then decides who the user is.
export async function signIn(page: Page, username = "planner1", password = DEV_PASSWORD) {
  await page.goto("/");
  await page.getByLabel("Username").fill(username);
  await page.getByLabel("Password", { exact: true }).fill(password);
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page.getByRole("navigation", { name: "Main" })).toBeVisible();
}
