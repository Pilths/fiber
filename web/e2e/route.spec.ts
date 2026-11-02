import { expect, test, type Page } from "@playwright/test";
import { contrast, signIn } from "./helpers";

// Dev seed: Cyberjaya DC to Kuantan Hut has several paths (via Bukit Jalil, via Kuala Lumpur, ...). Site ids vary by database.
const FROM = "DEV Cyberjaya DC", TO = "DEV Kuantan Hut";
async function routeHash(page: Page, cores = 1, idx = 0, from = FROM, to = TO) {
  const eps: { id: number; name: string }[] = await (await page.request.get("/api/routes/endpoints")).json();
  const id = (n: string) => eps.find((e) => e.name === n)!.id;
  return `#route=${id(from)}-${id(to)}-${cores}-km-${idx}`;
}
const options = (page: Page) => page.getByRole("list", { name: "Route options" }).getByTestId("route-option");
const chain = (page: Page) => page.getByTestId("segment-diagram").getByRole("list", { name: "Segments on the route" }).getByRole("button");
const reserveRoute = (page: Page) => page.getByTestId("segment-diagram").getByRole("button", { name: "Reserve on this route" });

async function search(page: Page, from = FROM, to = TO) {
  const s = page.getByRole("region", { name: "Route search" });
  await s.getByLabel("Route A").fill(from);
  await s.getByLabel("Route B").fill(to);
  await s.getByRole("button", { name: "Search" }).click();
  await expect(options(page).first()).toBeVisible();
}

test.use({ viewport: { width: 1440, height: 900 } });

test("route search on Inventory: up to 3 options, the route drawn with Reserve on this route", async ({ page }) => {
  await signIn(page);
  await search(page);
  const n = await options(page).count();
  expect(n).toBeGreaterThan(1);
  expect(n).toBeLessThanOrEqual(3);
  await expect(options(page).first()).toHaveAttribute("aria-pressed", "true");
  await expect(options(page).first()).toContainText("Best match");
  await expect(options(page).first()).toContainText(/Option 1/);
  await expect(options(page).first()).toContainText(/\d+ segments?, [\d.]+\+? km, \d+ free/);
  await expect(options(page).first()).toContainText(/Calculated loss ([\d.]+ dB|-)/);
  await expect(options(page).first().getByTestId("route-short")).toHaveCount(0);
  await expect(page).toHaveURL(new RegExp(`${await routeHash(page)}$`));
  await expect(page.getByRole("region", { name: "Route options" })).not.toContainText(/bottleneck|lowest free/i);

  // The found route's chain in the segment diagram, its first segment selected, the dark route button at its right end.
  await expect(chain(page).first()).toHaveAttribute("aria-pressed", "true");
  await expect(reserveRoute(page)).toBeEnabled();
  await expect(reserveRoute(page)).toHaveClass(/btn-p/);
  const over = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(over).toBeLessThanOrEqual(0);
  await page.screenshot({ path: "e2e/screenshots/route-reserve.png", fullPage: true });

  // Another option redraws the chain.
  await options(page).nth(1).click();
  await expect(options(page).nth(1)).toHaveAttribute("aria-pressed", "true");
  await expect(page).toHaveURL(new RegExp(`${await routeHash(page, 1, 1)}$`));
  await expect(chain(page).first()).toHaveAttribute("aria-pressed", "true");
});

test("#route= link opens Inventory with that route found and drawn; #segment= still works", async ({ page }) => {
  await signIn(page);
  await page.goto(`/${await routeHash(page, 1, 1)}`);
  await expect(page.getByRole("region", { name: "Route search" }).getByLabel("Route A")).toHaveValue(FROM);
  await expect(options(page).nth(1)).toHaveAttribute("aria-pressed", "true");
  await expect(chain(page).first()).toBeVisible();
  await expect(page.getByTestId("network-map").locator("[data-testid=map-line][data-selected=true]").first()).toBeAttached();
  await expect(reserveRoute(page)).toBeVisible();
  // Old #span= links still redirect to #segment= (fresh page load first).
  await page.goto("/");
  await page.goto("/#span=DEV Kuala Lumpur DC - DEV Cyberjaya DC");
  await expect(page).toHaveURL(/#segment=/);
  await expect(page.locator("#segment-h")).toHaveText("DEV Kuala Lumpur DC - DEV Cyberjaya DC");
  await expect(reserveRoute(page)).toHaveCount(0);
});

test("too many cores: the option names the short segment, Reserve on this route is off", async ({ page }) => {
  await signIn(page);
  await page.goto(`/${await routeHash(page, 200)}`);
  const short = options(page).first().getByTestId("route-short");
  await expect(short).toContainText(/Not enough free cores on DEV .+: \d+ free, 200 needed|DEV .+ is not surveyed/);
  await expect(short.locator('svg[data-icon="fl"]')).toHaveCount(1); // symbol, not colour alone
  await expect(options(page).first()).not.toContainText("Best match");
  await expect(reserveRoute(page)).toBeDisabled();
  expect((await contrast(page, { option: '[data-testid="route-short"]' })).option).toBeGreaterThanOrEqual(4.5);
});

test("same site twice or an unknown site: inline message, no route", async ({ page }) => {
  await signIn(page);
  const s = page.getByRole("region", { name: "Route search" });
  await s.getByLabel("Route A").fill(FROM);
  await s.getByLabel("Route B").fill(FROM);
  await s.getByRole("button", { name: "Search" }).click();
  await expect(page.getByTestId("route-found")).toHaveText(/Choose two different sites|must differ/i);
  await s.getByLabel("Route B").fill("Nowhere");
  await s.getByRole("button", { name: "Search" }).click();
  await expect(page.getByTestId("route-found")).toHaveText("Choose sites from the list");
  await expect(options(page)).toHaveCount(0);
});

test("Reserve on a sufficient route sends one request (then withdrawn)", async ({ page }) => {
  await signIn(page);
  // KL DC -> Ipoh -> Penang: segments no other spec books, so parallel workers do not race for the same first free core
  await search(page, "DEV Kuala Lumpur DC", "DEV Penang Tower");
  await reserveRoute(page).click();
  const box = page.getByTestId("reserve-box");
  await expect(box.getByRole("heading", { level: 2 })).toContainText("DEV Kuala Lumpur DC");
  await expect(box.getByRole("group", { name: "Cores needed per segment" }).locator("output")).toHaveText("1");
  const legs = await box.getByRole("table", { name: "Segments on this route" }).locator("tbody tr").count();
  expect(legs).toBeGreaterThan(1);
  await box.getByLabel("Search customers").fill("DEV Telco Alpha");
  await box.getByRole("button", { name: "DEV Telco Alpha", exact: true }).click();
  await box.getByLabel("SRF ID (optional)").fill("SRF-E2E");
  const sent = page.waitForRequest((q) => q.method() === "POST" && q.url().endsWith("/api/reservations"));
  await box.getByRole("button", { name: `Reserve ${legs} cores` }).click();
  expect((await sent).postDataJSON().srf_id).toBe("SRF-E2E");
  await expect(box).toBeHidden();
  const status = page.getByTestId("request-sent");
  await expect(status).toContainText(/Request #\d+ sent/);
  const id = /Request #(\d+)/.exec((await status.textContent())!)![1];
  const r = await page.request.post(`/api/reservations/${id}/withdraw`); // leave the dev data as found
  expect(r.ok()).toBeTruthy();
});

test("Most free cores sends sort=free_cores, re-ranks and goes into the link", async ({ page }) => {
  await signIn(page);
  await search(page);
  const s = page.getByRole("radiogroup", { name: "Optimise for" });
  await expect(s.getByRole("radio", { name: "Shortest distance" })).toBeChecked();
  const before = await options(page).count();
  const req = page.waitForResponse((r) => r.url().includes("/api/routes?") && r.url().includes("sort=free_cores"));
  await s.getByText("Most free cores").click();
  const res = await req;
  await expect(s.getByRole("radio", { name: "Most free cores" })).toBeChecked();
  await expect(options(page)).toHaveCount(before);
  const fewest = ((await res.json()) as { options: { fewest_free: number }[] }).options.map((o) => o.fewest_free);
  for (let i = 1; i < fewest.length; i++) expect(fewest[i - 1]).toBeGreaterThanOrEqual(fewest[i]);
  await expect(page).toHaveURL(/-free_cores-0$/);
});
