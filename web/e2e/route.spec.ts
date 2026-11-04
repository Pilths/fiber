import { expect, test, type Page } from "@playwright/test";
import { contrast, signIn } from "./helpers";

// seed_dev_network: Ipoh Exchange to Kuala Lumpur DC has three paths within 1.5x of the shortest (direct, via Tanjung Malim, via Teluk Intan and Klang). Site ids vary by database.
const FROM = "DEV Ipoh Exchange", TO = "DEV Kuala Lumpur DC";
async function routeHash(page: Page, cores = 1, idx = 0, from = FROM, to = TO) {
  const eps: { id: number; name: string }[] = await (await page.request.get("/api/routes/endpoints")).json();
  const id = (n: string) => eps.find((e) => e.name === n)!.id;
  return `#route=${id(from)}-${id(to)}-${cores}-km-${idx}`;
}
const options = (page: Page) => page.getByRole("list", { name: "Route options" }).getByTestId("route-option");
const chain = (page: Page) => page.getByTestId("segment-diagram").getByRole("list", { name: "Segments on the route" }).getByRole("button");
const reserveRoute = (page: Page) => page.getByTestId("segment-actions").getByRole("button", { name: "Reserve on this route" });

async function search(page: Page, from = FROM, to = TO) {
  const s = page.getByRole("region", { name: "Site A to B" });
  await s.getByLabel("Site A").fill(from);
  await s.getByLabel("Site B").fill(to);
  await s.getByRole("button", { name: "Find route" }).click();
  await expect(options(page).first()).toBeVisible();
}

test.use({ viewport: { width: 1440, height: 900 } });

test("route search on Inventory: up to 5 options, the route drawn with Reserve on this route", async ({ page }) => {
  await signIn(page);
  await search(page);
  const n = await options(page).count();
  expect(n).toBeGreaterThan(1);
  expect(n).toBeLessThanOrEqual(5);
  await expect(options(page).first()).toHaveAttribute("aria-pressed", "true");
  await expect(options(page).first()).toContainText("Best match");
  await expect(options(page).first()).toContainText(/Option 1/);
  await expect(options(page).first()).toContainText(/\d+ segments?, [\d.]+\+? km\d+ free/); // free count in a pill
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
  await expect(page.getByRole("region", { name: "Site A to B" }).getByLabel("Site A")).toHaveValue(FROM);
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
  const s = page.getByRole("region", { name: "Site A to B" });
  await s.getByLabel("Site A").fill(FROM);
  await s.getByLabel("Site B").fill(FROM);
  await s.getByRole("button", { name: "Find route" }).click();
  await expect(page.getByTestId("route-found")).toHaveText(/Choose two different sites|must differ/i);
  await s.getByLabel("Site B").fill("Nowhere");
  await s.getByRole("button", { name: "Find route" }).click();
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
  // Nothing chosen at open: no segment selected, no cores ticked
  const segs = box.getByTestId("route-chain").getByRole("button");
  const legs = await segs.count();
  expect(legs).toBeGreaterThan(1);
  await expect(box.locator("[aria-pressed=true]")).toHaveCount(0);
  await expect(box.getByText("Choose a segment")).toBeVisible();
  await expect(box.getByTestId("leg-count").first()).toHaveText("0 of 1");
  const reserve = box.getByRole("button", { name: /^Reserve \d+ cores?$/ });
  await expect(reserve).toBeDisabled();
  // Double-click the selected segment unselects it
  await segs.first().click();
  await expect(segs.first()).toHaveAttribute("aria-pressed", "true");
  await segs.first().dblclick();
  await expect(segs.first()).toHaveAttribute("aria-pressed", "false");
  await expect(box.getByText("Choose a segment")).toBeVisible();
  // Each segment: select it, tick its first Available core; the pill reads 1 of 1
  for (let i = 0; i < legs; i++) {
    await segs.nth(i).click();
    const list = box.getByRole("table", { name: "Available cores" });
    await list.getByRole("checkbox").first().check();
    await expect(list.getByRole("checkbox", { checked: false }).first()).toBeDisabled(); // N reached: others locked
    await expect(box.getByTestId("leg-count").nth(i)).toHaveText("1 of 1");
  }
  await box.getByLabel("Search customers").fill("DEV Telco Alpha");
  await box.getByRole("button", { name: "DEV Telco Alpha", exact: true }).click();
  await box.getByLabel("SRF ID (optional)").fill("SRF-E2E");
  const sent = page.waitForRequest((q) => q.method() === "POST" && q.url().endsWith("/api/reservations"));
  await box.getByRole("button", { name: `Reserve ${legs} cores` }).click();
  const body = (await sent).postDataJSON();
  expect(body.srf_id).toBe("SRF-E2E");
  expect(body.cores).toHaveLength(legs);
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

test("route mode on the map: other options' segments switch option, the rest are faint and not clickable; Clear route ends it", async ({ page }) => {
  await signIn(page);
  await search(page);
  const eps: { id: number; name: string }[] = await (await page.request.get("/api/routes/endpoints")).json();
  const id = (n: string) => eps.find((e) => e.name === n)!.id;
  const opts: { segments: { segment_id: number }[] }[] = (await (await page.request.get(`/api/routes?from=${id(FROM)}&to=${id(TO)}&cores_needed=1`)).json()).options;
  const [first, second] = opts.map((o) => o.segments.map((x) => x.segment_id));
  const other = second.find((x) => !first.includes(x))!;
  const line = (id: number) => page.locator(`[data-testid=map-line][data-segment-id="${id}"]`);
  // a segment on no option: faint, no chip to click
  const all = await page.locator("[data-testid=map-line]").evaluateAll((es) => es.map((e) => Number(e.getAttribute("data-segment-id"))));
  const off = all.find((x) => !first.includes(x) && !second.includes(x))!;
  await expect(line(off)).toHaveAttribute("data-state", "hidden");
  await expect(page.locator(`[data-testid=map-chip][data-segment-id="${off}"]`)).toHaveCount(0);
  // a segment of option 2: clicking its chip switches to option 2 and selects that segment
  await page.locator(`[data-testid=map-chip][data-segment-id="${other}"]`).click({ force: true });
  await expect(options(page).nth(1)).toHaveAttribute("aria-pressed", "true");
  await expect(line(other)).toHaveAttribute("data-selected", "true");
  await expect(chain(page).and(page.locator("[aria-pressed=true]"))).toHaveCount(1);
  // Clear route: back to the normal map, no options, no #route=
  await page.getByRole("button", { name: "Clear route" }).click();
  await expect(options(page)).toHaveCount(0);
  await expect(line(off)).not.toHaveAttribute("data-state", "hidden");
  expect(page.url()).not.toContain("#route=");
  const panel = page.getByRole("region", { name: "Site A to B" });
  await expect(panel.getByLabel("Site A")).toHaveValue("");
  await expect(panel.getByLabel("Site B")).toHaveValue("");
});
