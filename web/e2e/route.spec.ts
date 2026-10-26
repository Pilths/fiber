import { expect, test, type Page } from "@playwright/test";
import { contrast, signIn } from "./helpers";

// Dev seed: Cyberjaya DC to Kuantan Hut has several paths (via Bukit Jalil, via Kuala Lumpur, ...). Site ids vary by database.
const FROM = "DEV Cyberjaya DC", TO = "DEV Kuantan Hut";
async function routeHash(page: Page, cores = 2, sort = "km", idx = 0) {
  const eps: { id: number; name: string }[] = await (await page.request.get("/api/routes/endpoints")).json();
  const id = (n: string) => eps.find((e) => e.name === n)!.id;
  return `#route=${id(FROM)}-${id(TO)}-${cores}-${sort}-${idx}`;
}
const options = (page: Page) => page.getByRole("list", { name: "Route options" }).getByTestId("route-option");
const ribbon = (page: Page) => page.getByTestId("ribbon");

// Scroll the route section to the top, under the sticky header.
const toSection = (page: Page) => page.evaluate(() => scrollTo(0, document.getElementById("route-h")!.getBoundingClientRect().top + scrollY - 84));

async function plan(page: Page, cores = "2", from = FROM, to = TO) {
  await page.getByRole("radio", { name: "Route A to B" }).check({ force: true });
  await page.getByLabel("From", { exact: true }).fill(from);
  await page.getByLabel("To", { exact: true }).fill(to);
  await page.getByLabel("Cores needed per span").fill(cores);
  await expect(options(page).first()).toBeVisible();
}

test.use({ viewport: { width: 1440, height: 900 } });

test("route options: up to 3, a Best match, every field shown", async ({ page }) => {
  await signIn(page);
  await plan(page);
  const n = await options(page).count();
  expect(n).toBeGreaterThan(1);
  expect(n).toBeLessThanOrEqual(3);
  await expect(options(page).first()).toContainText("Best match");
  await expect(options(page).first()).toContainText(/Option 1, \d+ spans?, [\d.]+ km/);
  await expect(options(page).first()).toContainText(/measured \d+ of \d+/);
  await expect(options(page).first()).toContainText(/bottleneck/);
  await expect(page.getByTestId("route-form")).toContainText("Data centre"); // kind of the picked site
  await page.screenshot({ path: "e2e/screenshots/route-options.png" });

  await options(page).first().click();
  await expect(page).toHaveURL(new RegExp(`${await routeHash(page)}$`));
  await expect(page.getByTestId("route-summary")).toContainText(`${FROM} to`);
  await expect(page.getByTestId("route-loss")).toContainText("Total calculated");
  await expect(page.getByRole("table", { name: /Spans on this route/ })).toBeVisible();
  await expect(page.getByRole("list", { name: "Route as text" })).toContainText(`Site ${FROM}`);
  await toSection(page);
  await page.screenshot({ path: "e2e/screenshots/route-ribbon.png" });
  await page.screenshot({ path: "test-results/route-full.png", fullPage: true });
});

test("Most free cores sends sort=free_cores and re-ranks", async ({ page }) => {
  await signIn(page);
  await plan(page);
  const before = await options(page).allTextContents();
  const req = page.waitForRequest((r) => r.url().includes("/api/routes?") && r.url().includes("sort=free_cores"));
  await page.getByRole("radio", { name: "Most free cores" }).check({ force: true });
  const url = new URL((await req).url());
  expect(url.searchParams.get("sort")).toBe("free_cores");
  await expect(page.getByTestId("route-form")).toContainText("most free cores first");
  const after = await options(page).allTextContents();
  // Same set of routes, ranked by fewest free (highest first) when the dev counts differ.
  expect(after.length).toBe(before.length);
  const fewest = (t: string) => Number(/Lowest free (\d+)/.exec(t)?.[1]);
  for (let i = 1; i < after.length; i++) expect(fewest(after[i - 1])).toBeGreaterThanOrEqual(fewest(after[i]));
});

test("too many cores: options short, ribbon short, Reserve off naming the span", async ({ page }) => {
  await signIn(page);
  await plan(page, "200");
  await expect(options(page).first()).toContainText("short for 200");
  await expect(options(page).first()).not.toContainText("Best match");
  await options(page).first().click();
  await expect(ribbon(page).locator(".rb-lk.short").first()).toContainText("short");
  const box = page.getByTestId("route-reserve");
  await expect(box.getByRole("button", { name: "Reserve on this route" })).toBeDisabled();
  await expect(box).toContainText(/Reserve is off: DEV .+ has \d+ free, fewer than the 200 needed/);
  await expect(page.getByTestId("route-summary")).toContainText("Not enough free cores");
  // red hatch text keeps 4.5:1
  const r = await contrast(page, { short: ".rb-lk.short .rb-fb .w" });
  expect(r.short).toBeGreaterThanOrEqual(4.5);
  await toSection(page);
  await page.screenshot({ path: "e2e/screenshots/route-short.png" });
});

test("from equal to to shows the inline error", async ({ page }) => {
  await signIn(page);
  await page.getByRole("radio", { name: "Route A to B" }).check({ force: true });
  await page.getByLabel("From", { exact: true }).fill(FROM);
  await page.getByLabel("To", { exact: true }).fill(FROM);
  await expect(page.getByTestId("route-form")).toContainText(/from and to must differ/i);
  await expect(page.getByLabel("To", { exact: true })).toHaveAttribute("aria-invalid", "true");
});

test("#route= restores the selection; arrow keys move along the ribbon", async ({ page }) => {
  await signIn(page);
  const h = await routeHash(page);
  await page.goto(`/${h}`);
  await expect(page.getByLabel("From", { exact: true })).toHaveValue(FROM);
  await expect(options(page).first()).toHaveAttribute("aria-pressed", "true");
  const links = ribbon(page).getByRole("button");
  await expect(links.first()).toBeVisible();
  // the bottleneck span starts selected; Home goes to the first, arrows move one at a time
  await ribbon(page).locator('[aria-pressed="true"]').focus();
  await page.keyboard.press("Home");
  await expect(links.nth(0)).toBeFocused();
  await page.keyboard.press("ArrowRight");
  await expect(links.nth(1)).toBeFocused();
  await expect(links.nth(1)).toHaveAttribute("aria-pressed", "true");
  await expect(page.getByRole("table", { name: /Spans on this route/ }).locator("tbody tr").nth(1)).toHaveAttribute("aria-selected", "true");
  await page.keyboard.press("ArrowLeft");
  await expect(links.nth(0)).toBeFocused();
  // #span= still works and switches back to span mode
  await page.goto("/");
  await page.getByRole("list", { name: "Spans" }).getByRole("button").first().click();
  await expect(page).toHaveURL(/#span=/);
});

test("Reserve on a sufficient route sends one request (then withdrawn)", async ({ page }) => {
  await signIn(page);
  // KL DC -> Ipoh -> Penang: spans no other spec books, so parallel workers do not race for the same first free core
  await plan(page, "1", "DEV Kuala Lumpur DC", "DEV Penang Tower");
  await options(page).first().click();
  const box = page.getByTestId("route-reserve");
  await expect(box).toContainText(/1 core on each of \d+ spans, \d+ in total\. Cores are assigned from the first free cores on each span\./);
  await box.getByLabel("Search customers").fill("DEV Telco Alpha");
  await box.getByRole("button", { name: "DEV Telco Alpha", exact: true }).click();
  await box.getByRole("button", { name: "Reserve on this route" }).click();
  const status = box.getByRole("status");
  await expect(status).toContainText(/Request #\d+ sent/);
  const id = /Request #(\d+)/.exec((await status.textContent())!)![1];
  const r = await page.request.post(`/api/reservations/${id}/withdraw`); // leave the dev data as found
  expect(r.ok()).toBeTruthy();
});

test("Plan a route from here prefills From with site A", async ({ page }) => {
  await signIn(page);
  await page.getByRole("list", { name: "Spans" }).getByRole("button", { name: /^DEV Kuala Lumpur DC - DEV Cyberjaya DC/ }).click();
  await page.getByRole("button", { name: "Plan a route from here" }).click();
  await expect(page.getByRole("radio", { name: "Route A to B" })).toBeChecked();
  await expect(page.getByLabel("From", { exact: true })).toHaveValue("DEV Kuala Lumpur DC");
  await expect(page).not.toHaveURL(/#span=/);
});

test("route state has no horizontal scroll at 1200, 1280, 1440, 1920", async ({ page }) => {
  await signIn(page);
  await page.goto(`/${await routeHash(page)}`);
  await expect(ribbon(page)).toBeVisible();
  for (const idx of [0, 1]) {
    await page.goto(`/${await routeHash(page, 2, "km", idx)}`);
    await expect(ribbon(page)).toBeVisible();
    for (const width of [1200, 1280, 1440, 1920]) {
      await page.setViewportSize({ width, height: 900 });
      await page.waitForTimeout(100);
      const over = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
      expect(over, `option ${idx + 1}, width ${width}`).toBeLessThanOrEqual(0);
    }
  }
  // At 1200 the 3-span option wraps onto a second row, which starts with "cont."
  await page.setViewportSize({ width: 1200, height: 900 });
  await expect(ribbon(page).locator(".rb-row")).toHaveCount(2);
  await expect(ribbon(page)).toContainText("cont.");
  await toSection(page);
  await page.screenshot({ path: "test-results/route-1200-wrap.png", fullPage: true });
});
