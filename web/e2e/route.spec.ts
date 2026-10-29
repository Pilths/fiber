import { expect, test, type Page } from "@playwright/test";
import { contrast, signIn, tab } from "./helpers";

// Dev seed: Cyberjaya DC to Kuantan Hut has several paths (via Bukit Jalil, via Kuala Lumpur, ...). Site ids vary by database.
const FROM = "DEV Cyberjaya DC", TO = "DEV Kuantan Hut";
async function routeHash(page: Page, cores = 2, sort = "km", idx = 0) {
  const eps: { id: number; name: string }[] = await (await page.request.get("/api/routes/endpoints")).json();
  const id = (n: string) => eps.find((e) => e.name === n)!.id;
  return `#route=${id(FROM)}-${id(TO)}-${cores}-${sort}-${idx}`;
}
const options = (page: Page) => page.getByRole("list", { name: "Route options" }).getByTestId("route-option");
const diagram = (page: Page) => page.getByTestId("route-diagram");
const groups = (page: Page) => diagram(page).locator("g[role=button]");
// Route UI regions that must never say "Bottleneck" or "lowest free".
const noOldWords = async (page: Page) => {
  for (const id of ["route-form", "route-summary", "route-section"]) await expect(page.getByTestId(id)).not.toContainText(/bottleneck|lowest free/i);
};

// Scroll the route section to the top, under the sticky header.
const toSection = (page: Page) => page.evaluate(() => scrollTo(0, document.getElementById("route-h")!.getBoundingClientRect().top + scrollY - 84));

// The route planner and its Reserve flow live on the Reserve tab.
async function plan(page: Page, cores = "2", from = FROM, to = TO) {
  await tab(page, "Reserve");
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
  await expect(options(page).first()).toContainText(/Option 1/);
  await expect(options(page).first()).toContainText(/\d+ spans?, [\d.]+\+? km, ([\d.]+ dB estimated|no dB estimate)/);
  await expect(options(page).first()).toContainText(/\d+ of \d+ spans measured/);
  await expect(options(page).first().getByTestId("route-short")).toHaveCount(0);
  await expect(page.getByTestId("route-form")).toContainText("Data centre"); // kind of the picked site
  await page.screenshot({ path: "e2e/screenshots/route-options.png" });

  await options(page).first().click();
  await expect(page).toHaveURL(new RegExp(`${await routeHash(page)}$`));
  await expect(page.getByTestId("route-summary")).toContainText(`${FROM} to`);
  const table = page.getByRole("table", { name: /Spans on this route/ });
  await expect(table.locator("thead th")).toHaveText(["#", "Span", "Type", "From → to", "km", "Est. loss (dB)", "Measured", "Free cores"]);
  await expect(table.locator("tfoot")).toContainText(/Total, \d+ spans/);
  await expect(table.locator("tfoot")).toContainText(/\d+ of \d+ measured/);
  const section = page.getByTestId("route-section");
  await expect(section.getByRole("heading", { level: 2 })).toHaveText([/^End-to-end span diagram/, "Spans on this path", "Reserve on this route"]);
  // diagram: a node per site, a span group per span, End total
  const rows = await table.locator("tbody tr").count();
  await expect(groups(page)).toHaveCount(rows);
  await expect(diagram(page).locator("g[aria-hidden=true]")).toHaveCount(rows + 1);
  await expect(diagram(page)).toContainText(/End · [\d.]+\+? km · ([\d.]+ dB total|No dB estimate)/);
  await expect(groups(page).first()).toHaveAttribute("aria-label", /^Span DEV .+ - DEV .+, (Trunk|Metro|–), ([\d.]+ km|no distance), ([\d.]+ dB|no dB estimate), (\d+ free cores|not surveyed)$/);
  await expect(page.getByRole("list", { name: "Route as text" })).toContainText(`Site ${FROM}`);
  await noOldWords(page);
  // screenshot a 3-span option when the dev data has one
  const three = (await options(page).allTextContents()).findIndex((t) => /\b3 spans/.test(t));
  // Dev seed: calculated loss is km x 0.3. Hold the new option's loss fetch: while it is in flight the previous option's
  // rows must never show on this option's spans (they were once matched by position), only "–" or the span's own value.
  const rowsAll = table.locator("tbody tr");
  const calc = (kmText: string) => (Number(kmText) * 0.3).toFixed(2);
  if (three >= 0) {
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    await page.route("**/api/loss/route*", async (r) => { await gate; await r.continue(); });
    await options(page).nth(three).click();
    await expect(groups(page)).toHaveCount(3);
    for (let i = 0; i < 3; i++) {
      const cells = rowsAll.nth(i).locator("td");
      const kmText = (await cells.nth(3).textContent())!;
      expect(["–", kmText === "–" ? "–" : calc(kmText)], `row ${i + 1} while loading`).toContain(await cells.nth(4).textContent());
      expect(["–", "Not measured"].includes((await cells.nth(5).textContent())!) || /dB$/.test((await cells.nth(5).textContent())!)).toBeTruthy();
    }
    const lossRes = page.waitForResponse((r) => r.url().includes("/api/loss/route"));
    release();
    await lossRes;
    await page.unroute("**/api/loss/route*");
  }
  // Every span with a distance shows its calculated dB in the table and the diagram; Measured is a dB or "Not measured".
  for (let i = 0; i < (await rowsAll.count()); i++) {
    const cells = rowsAll.nth(i).locator("td");
    const kmText = (await cells.nth(3).textContent())!;
    if (kmText !== "–") {
      await expect(cells.nth(4), `row ${i + 1} calculated dB`).toHaveText(calc(kmText));
      const dbText = calc(kmText);
      await expect(groups(page).nth(i)).toContainText(`${kmText} km · ${dbText} dB`);
      await expect(groups(page).nth(i)).toHaveAttribute("aria-label", new RegExp(`, ${kmText} km, ${dbText} dB, `));
    }
    await expect(cells.nth(5), `row ${i + 1} measured`).toHaveText(/^(\d+\.\d\d dB|Not measured)$/);
  }
  // Full-width table, single-line rows (v4 nowrap), in its own focusable scroll box
  const heights = await rowsAll.evaluateAll((trs) => trs.map((tr) => tr.getBoundingClientRect().height));
  for (const h of heights) expect(h).toBeLessThanOrEqual(44);
  const tbox = page.getByTestId("route-table-box");
  expect(await tbox.evaluate((el) => [getComputedStyle(el).overflowX, el.tabIndex])).toEqual(["auto", 0]);
  await expect(tbox).toHaveAccessibleName("Spans on this path, scrolls sideways");
  const card = (await page.locator("section", { has: table }).boundingBox())!;
  expect((await tbox.boundingBox())!.width).toBeGreaterThan(card.width - 48);
  await toSection(page);
  await expect(groups(page)).toHaveCount(three >= 0 ? 3 : await table.locator("tbody tr").count());
  await page.screenshot({ path: "e2e/screenshots/route-v4-diagram.png" });
  await page.screenshot({ path: "test-results/route-full.png", fullPage: true });
});

test("Most free cores sends sort=free_cores and re-ranks", async ({ page }) => {
  await signIn(page);
  await plan(page);
  const before = await options(page).allTextContents();
  const req = page.waitForResponse((r) => r.url().includes("/api/routes?") && r.url().includes("sort=free_cores"));
  await page.getByRole("radio", { name: "Most free cores" }).check({ force: true });
  const res = await req;
  const url = new URL(res.url());
  expect(url.searchParams.get("sort")).toBe("free_cores");
  await expect(page.getByRole("radio", { name: "Most free cores" })).toBeChecked();
  const after = await options(page).allTextContents();
  // Same set of routes, ranked by fewest free (highest first) when the dev counts differ.
  expect(after.length).toBe(before.length);
  const fewest = ((await res.json()) as { options: { fewest_free: number }[] }).options.map((o) => o.fewest_free);
  for (let i = 1; i < fewest.length; i++) expect(fewest[i - 1]).toBeGreaterThanOrEqual(fewest[i]);
});

test("too many cores: options short, diagram span short, Reserve off naming the span", async ({ page }) => {
  await signIn(page);
  await plan(page, "200");
  await expect(options(page).first().getByTestId("route-short")).toContainText(/Not enough free cores on DEV .+: \d+ free, 200 needed/);
  await expect(options(page).first()).not.toContainText("Best match");
  await options(page).first().click();
  const g = groups(page).first();
  await expect(g).toHaveAttribute("aria-label", /^Span DEV .+ - DEV .+, .+, ([\d.]+ km|no distance), ([\d.]+ dB|no dB estimate), (\d+ free cores|not surveyed), short$/);
  const shortText = g.getByTestId("route-diagram-short");
  await expect(shortText).toHaveText(/^✕ (\d+ free cores|not surveyed) · short$/);
  await expect(shortText.locator('[data-icon="fl"]')).toHaveCount(1);
  const cell = page.getByTestId("route-cell-short").first();
  await expect(cell).toHaveText(/^(\d+|Not surveyed) short$/);
  await expect(cell.locator('svg[data-icon="fl"]')).toHaveCount(1);
  const box = page.getByTestId("route-reserve");
  await expect(box.getByRole("button", { name: "Reserve on this route" })).toBeDisabled();
  await expect(box).toContainText(/Reserve is off: DEV .+ has \d+ free, fewer than the 200 needed/);
  await expect(page.getByTestId("route-summary")).toContainText("Not enough free cores");
  await noOldWords(page);
  // red text keeps 4.5:1
  const r = await contrast(page, { option: '[data-testid="route-short"]', diagram: '[data-testid="route-diagram-short"]', cell: '[data-testid="route-cell-short"]' });
  expect(r.option).toBeGreaterThanOrEqual(4.5);
  expect(r.diagram).toBeGreaterThanOrEqual(4.5);
  expect(r.cell).toBeGreaterThanOrEqual(4.5);
  await toSection(page);
  await page.screenshot({ path: "e2e/screenshots/route-v4-short.png" });
});

test("from equal to to shows the inline error", async ({ page }) => {
  await signIn(page);
  await tab(page, "Reserve");
  await page.getByRole("radio", { name: "Route A to B" }).check({ force: true });
  await page.getByLabel("From", { exact: true }).fill(FROM);
  await page.getByLabel("To", { exact: true }).fill(FROM);
  await expect(page.getByTestId("route-form")).toContainText(/from and to must differ/i);
  await expect(page.getByLabel("To", { exact: true })).toHaveAttribute("aria-invalid", "true");
});

test("#route= restores the selection; arrow keys move between diagram spans, Enter selects", async ({ page }) => {
  await signIn(page);
  const h = await routeHash(page);
  await page.goto(`/${h}`);
  await expect(page.getByLabel("From", { exact: true })).toHaveValue(FROM);
  await expect(options(page).first()).toHaveAttribute("aria-pressed", "true");
  const links = groups(page);
  await expect(links.first()).toBeVisible();
  const n = await links.count();
  const row = (i: number) => page.getByRole("table", { name: /Spans on this route/ }).locator("tbody tr").nth(i);
  // one tab stop; Home/End jump, arrows move one at a time; moving does not select, Enter/Space does
  await expect(diagram(page).locator('g[tabindex="0"]')).toHaveCount(1);
  await diagram(page).locator('g[tabindex="0"]').focus();
  await page.keyboard.press("End");
  await expect(links.nth(n - 1)).toBeFocused();
  await page.keyboard.press("Home");
  await expect(links.nth(0)).toBeFocused();
  await page.keyboard.press("ArrowRight");
  await expect(links.nth(1)).toBeFocused();
  await expect(links.nth(1)).toHaveAttribute("tabindex", "0");
  await expect(row(1)).toHaveAttribute("aria-selected", "false");
  await page.keyboard.press("Enter");
  await expect(row(1)).toHaveAttribute("aria-selected", "true");
  await expect(links.nth(1)).toHaveAttribute("aria-pressed", "true");
  await page.keyboard.press("ArrowLeft");
  await expect(links.nth(0)).toBeFocused();
  await page.keyboard.press(" ");
  await expect(row(0)).toHaveAttribute("aria-selected", "true");
  // click selects too
  await links.nth(1).click();
  await expect(row(1)).toHaveAttribute("aria-selected", "true");
  // #span= still works and switches back to span mode
  await page.goto("/");
  await tab(page, "Reserve");
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
  await box.getByLabel("SRF ID").fill("SRF-E2E");
  await box.screenshot({ path: "test-results/route-reserve.png" });
  const sent = page.waitForRequest((q) => q.method() === "POST" && q.url().endsWith("/api/reservations"));
  await box.getByRole("button", { name: "Reserve on this route" }).click();
  expect((await sent).postDataJSON().srf_id).toBe("SRF-E2E");
  const status = box.getByRole("status");
  await expect(status).toContainText(/Request #\d+ sent/);
  const id = /Request #(\d+)/.exec((await status.textContent())!)![1];
  const r = await page.request.post(`/api/reservations/${id}/withdraw`); // leave the dev data as found
  expect(r.ok()).toBeTruthy();
});

// Plan a route from here was removed: the route search bar above the map replaces it.
test.fixme("Plan a route from here prefills From with site A", async ({ page }) => {
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
  await expect(diagram(page)).toBeVisible();
  for (const idx of [0, 1]) {
    await page.goto(`/${await routeHash(page, 2, "km", idx)}`);
    await expect(diagram(page)).toBeVisible();
    for (const width of [1200, 1280, 1440, 1920]) {
      await page.setViewportSize({ width, height: 900 });
      await page.waitForTimeout(100);
      const over = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
      expect(over, `option ${idx + 1}, width ${width}`).toBeLessThanOrEqual(0);
      const tall = await page.getByTestId("route-table").locator("tbody tr").evaluateAll((trs) => Math.max(...trs.map((tr) => tr.getBoundingClientRect().height)));
      expect(tall, `option ${idx + 1}, width ${width}, rows single-line`).toBeLessThanOrEqual(44);
    }
  }
  // A long route (3+ spans) at 1200: the diagram is at least v4's width and any overflow scrolls inside its own focusable box.
  const opts = await options(page).allTextContents();
  const long = opts.findIndex((t) => /\b([3-9]|\d\d) spans/.test(t));
  expect(long, "dev data has a 3+ span option").toBeGreaterThanOrEqual(0);
  await page.goto(`/${await routeHash(page, 2, "km", long)}`);
  await page.setViewportSize({ width: 1200, height: 900 });
  await expect(groups(page).nth(2)).toBeVisible();
  const n = await groups(page).count();
  const box = await diagram(page).evaluate((el) => ({ overflow: getComputedStyle(el).overflowX, tab: el.tabIndex, sw: el.scrollWidth, cw: el.clientWidth,
    svg: el.querySelector("svg")!.getBoundingClientRect().width }));
  expect(box.overflow).toBe("auto");
  expect(box.tab).toBe(0);
  expect(box.svg).toBeGreaterThanOrEqual(Math.max(640, 120 + n * 170));
  expect(box.sw).toBeGreaterThanOrEqual(box.cw);
  // force a narrow box to prove it scrolls inside itself, never the page
  await diagram(page).evaluate((el) => { el.style.width = "500px"; });
  const sc = await diagram(page).evaluate((el) => { el.scrollLeft = 100; return { sw: el.scrollWidth, cw: el.clientWidth, left: el.scrollLeft }; });
  expect(sc.sw).toBeGreaterThan(sc.cw);
  expect(sc.left).toBeGreaterThan(0);
  const over = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(over).toBeLessThanOrEqual(0);
  await noOldWords(page);
});
