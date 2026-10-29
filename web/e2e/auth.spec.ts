import { expect, test, type Page } from "@playwright/test";
import { DEV_PASSWORD, signIn } from "./helpers";

const shot = (page: Page, name: string) => page.screenshot({ path: `e2e/screenshots/${name}.png` });
const account = async (page: Page) => {
  await page.getByRole("button", { name: /Planner|Admin/ }).click();
  return page.getByRole("menu", { name: "Account" });
};
const userRow = (page: Page, u: string) => page.locator(`[data-testid=user-row][data-username="${u}"]`);

test.use({ viewport: { width: 1440, height: 900 } });

test("wrong password shows the error; planner1 signs in, sees the map, signs out", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByLabel("Username")).toBeFocused();
  await expect(page.getByLabel("Username")).toHaveAttribute("autocomplete", "username");
  await expect(page.getByLabel("Password")).toHaveAttribute("autocomplete", "current-password");
  await page.getByLabel("Username").fill("planner1");
  await page.getByLabel("Password").fill("not-the-password");
  await page.getByLabel("Password").press("Enter");
  await expect(page.getByRole("alert")).toHaveText("Wrong username or password");
  await shot(page, "login");

  await signIn(page, "planner1");
  await expect(page.getByRole("region", { name: "Network map" })).toBeVisible();
  await (await account(page)).getByRole("menuitem", { name: "Sign out" }).click();
  await expect(page.getByRole("button", { name: "Sign in" })).toBeVisible();
  await page.reload(); // the session is gone on the server too
  await expect(page.getByRole("button", { name: "Sign in" })).toBeVisible();
});

test("planner has no Users item and a direct visit says Admins only", async ({ page }) => {
  await signIn(page, "planner1");
  const menu = await account(page);
  await expect(menu.getByRole("menuitem", { name: "Change password" })).toBeVisible();
  await expect(menu.getByRole("menuitem", { name: "Users" })).toHaveCount(0);
  await page.goto("/#users");
  await expect(page.getByText("Admins only")).toBeVisible();
  await expect(page.getByRole("table")).toHaveCount(0);
});

test("new user: temporary password, forced change, deactivate blocks, activate restores", async ({ browser }) => {
  const name = `e2e${Date.now()}`;
  const admin = await (await browser.newContext({ viewport: { width: 1440, height: 900 } })).newPage();
  await signIn(admin, "admin1");
  await (await account(admin)).getByRole("menuitem", { name: "Users" }).click();
  await expect(admin).toHaveURL(/#users$/);
  await expect(userRow(admin, "admin1").getByRole("button", { name: /^Deactivate/ })).toHaveCount(0); // not on your own row
  await admin.getByRole("button", { name: "Add user" }).click();
  const form = admin.getByRole("form", { name: "Add user" });
  await form.getByLabel("Username").fill("admin1");
  await form.getByRole("button", { name: "Create" }).click();
  await expect(form.getByRole("alert")).toContainText("Username already exists");
  await form.getByLabel("Username").fill(name);
  await form.getByLabel("Display name").fill("E2E Planner");
  await form.getByLabel("Reason (optional)").fill("e2e test");
  await form.getByRole("button", { name: "Create" }).click();
  const box = admin.getByRole("region", { name: "Temporary password" });
  await expect(box).toContainText("Shown once. Give it to the user; they must change it at first sign-in.");
  const temp = (await box.getByTestId("temp-password").textContent())!.trim();
  await expect(userRow(admin, name)).toContainText("Must change password");
  await shot(admin, "users");

  // The new user is forced to change the password and cannot reach the app first.
  const user = await (await browser.newContext({ viewport: { width: 1440, height: 900 } })).newPage();
  await user.goto("/");
  await user.getByLabel("Username").fill(name);
  await user.getByLabel("Password").fill(temp);
  await user.getByRole("button", { name: "Sign in" }).click();
  await expect(user.getByRole("heading", { name: "Change password" })).toBeVisible();
  await shot(user, "change-password");
  await user.reload();
  await expect(user.getByRole("heading", { name: "Change password" })).toBeVisible();
  await expect(user.getByRole("navigation", { name: "Main" })).toHaveCount(0);
  expect((await user.request.get("/api/spans")).status()).toBe(403);
  const newPw = `${DEV_PASSWORD}-new`;
  await user.getByLabel("Current password").fill(temp);
  await user.getByLabel("New password", { exact: true }).fill("short");
  await user.getByLabel("Confirm new password").fill("short");
  await user.getByRole("button", { name: "Change password" }).click();
  await expect(user.getByRole("alert")).toContainText("at least 10 characters");
  await user.getByLabel("Current password").fill("wrong-current-pw");
  await user.getByLabel("New password", { exact: true }).fill(newPw);
  await user.getByLabel("Confirm new password").fill(newPw);
  await user.getByRole("button", { name: "Change password" }).click();
  await expect(user.getByRole("alert")).toContainText("Current password is wrong");
  await user.getByLabel("Current password").fill(temp);
  await user.getByRole("button", { name: "Change password" }).click();
  await expect(user.getByRole("region", { name: "Network map" })).toBeVisible();

  // Deactivate signs the user out and blocks sign-in.
  await admin.reload();
  await userRow(admin, name).getByRole("button", { name: `Deactivate ${name}` }).click();
  const dlg = admin.getByRole("dialog", { name: `Deactivate ${name}?` });
  await expect(dlg).toContainText("They are signed out and cannot sign in until activated.");
  await dlg.getByLabel("Reason (optional)").fill("e2e test");
  await dlg.getByRole("button", { name: "Deactivate" }).click();
  await expect(userRow(admin, name)).toContainText("Deactivated");
  await user.reload();
  await expect(user.getByRole("button", { name: "Sign in" })).toBeVisible();
  await user.getByLabel("Username").fill(name);
  await user.getByLabel("Password").fill(newPw);
  await user.getByRole("button", { name: "Sign in" }).click();
  await expect(user.getByRole("alert")).toHaveText("Wrong username or password");

  // Activate restores sign-in with the same password.
  await userRow(admin, name).getByRole("button", { name: `Activate ${name}` }).click();
  await expect(userRow(admin, name)).toContainText("Active");
  await signIn(user, name, newPw);
});
