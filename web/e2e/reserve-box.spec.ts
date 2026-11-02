import { expect, test } from "@playwright/test";
import { contrast, openReserve, pickSegment, signIn } from "./helpers";

const SEGMENT = /^DEV Kuala Lumpur DC - DEV Cyberjaya DC/; // dev seed: has Available, Reserved and In use cores

test.use({ viewport: { width: 1440, height: 900 } });

test("Reserve box: stepper 3 ticks 3 cores, customer, Reserve; success box and highlighted Requested row", async ({ page }) => {
  await signIn(page, "planner2");
  const box = await openReserve(page, SEGMENT);
  const free = Number((await box.getByTestId("reserve-free").textContent())!.split(" ")[0]);
  await expect(box.getByTestId("reserve-free")).toHaveText(`${free} free`);
  const list = box.getByRole("table", { name: "Available cores" });
  await expect(list.locator("thead th")).toHaveText(["Chosen", "Core", "Ports", "Calculated loss", "Measured loss"]);
  await expect(list.locator("tbody")).not.toContainText(/In service|Reserved|Requested/); // Available cores only
  const more = box.getByRole("button", { name: "One more" });
  for (let i = 0; i < 3; i++) await more.click();
  await expect(box.getByTestId("reserve-n")).toHaveText("3");
  const ticks = list.getByRole("checkbox");
  for (let i = 0; i < 3; i++) await expect(ticks.nth(i)).toBeChecked(); // the first 3 Available cores
  await expect(ticks.nth(3)).not.toBeChecked();
  await ticks.nth(2).uncheck(); // a hand change follows into the stepper
  await expect(box.getByTestId("reserve-n")).toHaveText("2");
  await more.click();
  await expect(box.getByTestId("reserve-n")).toHaveText("3");
  await box.getByRole("button", { name: "Reserve 3 cores" }).click();
  await expect(box.getByRole("alert")).toContainText("Choose a customer");
  await box.getByLabel("Search customers").fill("DEV Telco Alpha");
  await box.getByRole("button", { name: "DEV Telco Alpha", exact: true }).click();
  await page.screenshot({ path: "e2e/screenshots/reserve-box.png" });
  await box.getByRole("button", { name: "Reserve 3 cores" }).click();

  await expect(box).toBeHidden();
  const sent = page.getByTestId("request-sent");
  await expect(sent).toContainText(/^Request #\d+ sent\. Waiting for admin approval\./);
  const id = /#(\d+)/.exec((await sent.textContent())!)![1];
  const row = page.getByRole("table", { name: /^Cores of / }).locator("tr[data-flash]");
  await expect(row.first()).toContainText("Requested");
  await expect(page.getByTestId("segment-diagram").getByRole("button", { name: "Reserve cores" })).toBeFocused();
  await sent.getByRole("button", { name: "Close" }).click();
  await expect(sent).toHaveCount(0);
  expect((await page.request.post(`/api/reservations/${id}/withdraw`)).ok()).toBeTruthy(); // leave the dev data as found
});

test("Reserve box: closing with ticked cores asks to discard; Esc and × both ask", async ({ page }) => {
  await signIn(page);
  let box = await openReserve(page, SEGMENT);
  await expect(box.getByRole("button", { name: "One fewer" })).toBeDisabled();
  await page.keyboard.press("Escape"); // nothing ticked: closes straight away
  await expect(box).toBeHidden();
  box = await openReserve(page, SEGMENT);
  await box.getByRole("checkbox").first().check();
  await expect(box.getByTestId("reserve-n")).toHaveText("1");
  await page.keyboard.press("Escape");
  const ask = page.getByRole("dialog", { name: "Discard 1 chosen core?" });
  await expect(ask).toBeVisible();
  await ask.getByRole("button", { name: "Keep editing" }).click();
  await expect(ask).toHaveCount(0);
  await expect(box.getByRole("checkbox").first()).toBeChecked();
  await box.getByRole("button", { name: "Close" }).click();
  await page.getByRole("dialog", { name: "Discard 1 chosen core?" }).getByRole("button", { name: "Discard" }).click();
  await expect(box).toBeHidden();
  await expect(page.getByTestId("segment-diagram").getByRole("button", { name: "Reserve cores" })).toBeFocused();
});

test("Reserve box: a 409 shows inside the box and the box stays open", async ({ page }) => {
  await page.route("**/api/reservations", (r) => r.request().method() === "POST"
    ? r.fulfill({ status: 409, json: { detail: "Core 5 is no longer available." } }) : r.fallback());
  await signIn(page);
  const box = await openReserve(page, SEGMENT);
  await box.getByRole("button", { name: "One more" }).click();
  await box.getByLabel("Search customers").fill("DEV Telco Alpha");
  await box.getByRole("button", { name: "DEV Telco Alpha", exact: true }).click();
  await box.getByRole("button", { name: "Reserve 1 core" }).click();
  await expect(box.getByRole("alert")).toContainText("no longer available");
  await expect(box).toBeVisible();
});

test("Reserve box contrast >= 4.5", async ({ page }) => {
  await signIn(page);
  await openReserve(page, SEGMENT);
  const ratios = await contrast(page, {
    free: "[data-testid=reserve-free]",
    head: "[data-testid=reserve-box] thead th",
    cell: "[data-testid=reserve-box] tbody td",
    button: "[data-testid=reserve-box] button.btn-p",
  });
  expect(Object.keys(ratios).length).toBe(4);
  for (const [k, v] of Object.entries(ratios)) expect(v, `${k} ${v.toFixed(2)}`).toBeGreaterThanOrEqual(4.5);
});

test("count-only reservation shows on the segment and in My reservations", async ({ page }) => {
  await signIn(page);
  await pickSegment(page, /^DEV Cyberjaya DC - DEV Bukit Jalil/);
  await expect(page.getByTestId("unassigned-row").first()).toContainText("3 cores");
  await page.getByRole("button", { name: /My reservations/ }).click();
  await expect(page.getByTestId("reservation").filter({ hasText: "3 not assigned yet" })).toBeVisible();
  await page.getByRole("button", { name: "Rejected" }).click();
  await expect(page.getByText("No reservations that are rejected.")).toBeVisible();
});

test("planner request shows as Pending in My reservations; admin sees Approvals", async ({ browser }) => {
  const planner = await (await browser.newContext({ viewport: { width: 1280, height: 900 } })).newPage();
  await signIn(planner, "planner2");
  const box = await openReserve(planner, /DEV Bukit Jalil TOC - DEV Kuantan Hut/);
  await box.getByRole("checkbox").first().check();
  await box.getByLabel("Search customers").fill("DEV Telco Alpha");
  await box.getByRole("button", { name: "DEV Telco Alpha", exact: true }).click();
  await box.getByRole("button", { name: "Reserve 1 core" }).click();
  await expect(planner.getByTestId("request-sent")).toBeVisible();
  await planner.getByRole("button", { name: /My reservations/ }).click();
  await expect(planner.getByTestId("reservation").first()).toContainText("Pending approval");
  await planner.getByRole("button", { name: "Withdraw" }).first().click(); // leave the dev data as found
  await expect(planner.getByText("Withdrawn").first()).toBeVisible();

  const admin = await (await browser.newContext()).newPage();
  await signIn(admin, "admin1");
  await admin.getByRole("button", { name: /^Approvals/ }).click();
  await expect(admin.getByRole("heading", { name: /^Approvals/ })).toBeVisible();
  await expect(admin.getByRole("button", { name: "Approve" }).first()).toBeVisible();
});
