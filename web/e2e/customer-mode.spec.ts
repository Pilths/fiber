import { expect, test, type Locator, type Page } from "@playwright/test";
import { signIn } from "./helpers";

// Header search, customer result: the map highlights only that customer's segments and their chips show the
// customer's used cores (Reserved + In service) in a grey pill. Read only: uses the DEV seed reservations.
const CUSTOMER = "DEV Telco Alpha";

test.use({ viewport: { width: 1440, height: 900 } });

type SegmentUsage = { segment_id: number; used_cores: number };
type Request = { reservation_id: number; srf_id: string | null; planned_date: string | null; used_cores: number;
  segments: SegmentUsage[] };
type Usage = { customer_id: number; name: string; segments: SegmentUsage[]; reservations: Request[] };

async function usageOf(page: Page, name: string): Promise<Usage> {
  const results: { type: string; label: string; customer_id?: number | null }[] =
    await (await page.request.get(`/api/search?q=${encodeURIComponent(name)}`)).json();
  const found = results.find((result) => result.type === "customer" && result.label === name);
  expect(found?.customer_id, `${name} is a customer result`).toBeTruthy();
  return (await page.request.get(`/api/customers/${found!.customer_id}/usage`)).json();
}

async function pickCustomer(page: Page, name: string) {
  await page.getByRole("combobox", { name: /Find a segment/ }).fill(name);
  const listbox = page.getByRole("listbox", { name: "Search results" });
  await listbox.getByRole("group", { name: "Customers" }).getByRole("option", { name }).click();
}

// Selected lines and their used pills match these segments exactly.
async function expectHighlight(map: Locator, segments: SegmentUsage[], label: RegExp) {
  const selectedLines = map.locator("[data-testid=map-line][data-selected=true]");
  await expect(selectedLines).toHaveCount(segments.length);
  const ids = segments.map((segment) => String(segment.segment_id)).sort();
  expect((await selectedLines.evaluateAll((lines) => lines.map((line) => line.dataset.segmentId))).sort())
    .toEqual(ids);
  await expect(map.locator("[data-testid=map-chip].used")).toHaveCount(segments.length);
  for (const segment of segments) {
    const chip = map.locator(`[data-testid=map-chip][data-segment-id="${segment.segment_id}"]`);
    await expect(chip).toHaveText(new RegExp(`^${segment.used_cores}(?!\\d)`));
    await expect(chip).toHaveAttribute("aria-label", label);
  }
}

function optionText(request: Request): string {
  const parts = [request.srf_id ?? `Request #${request.reservation_id}`,
    `${request.used_cores} core${request.used_cores === 1 ? "" : "s"}`];
  if (request.planned_date) {
    const format = new Intl.DateTimeFormat("en-GB", { timeZone: "Asia/Kuala_Lumpur", day: "numeric", month: "short" });
    parts.push(format.format(new Date(`${request.planned_date}T12:00:00+08:00`)));
  }
  return parts.join(" · ");
}

test("customer search highlights its segments with used cores; the toolbar chip clears it", async ({ page }) => {
  await signIn(page);
  const results: { type: string; label: string; customer_id?: number | null }[] =
    await (await page.request.get(`/api/search?q=${encodeURIComponent(CUSTOMER)}`)).json();
  const found = results.find((result) => result.type === "customer" && result.label === CUSTOMER);
  expect(found?.customer_id, "customer result carries customer_id").toBeTruthy();
  const usage: Usage = await (await page.request.get(`/api/customers/${found!.customer_id}/usage`)).json();
  expect(usage.segments.length, `${CUSTOMER} has segments in the DEV seed`).toBeGreaterThan(0);
  const ids = usage.segments.map((segment) => String(segment.segment_id));

  const map = page.getByTestId("network-map");
  await expect(map.getByTestId("map-chip").first()).toBeAttached();
  const search = page.getByRole("combobox", { name: /Find a segment/ });
  await search.fill(CUSTOMER);
  const listbox = page.getByRole("listbox", { name: "Search results" });
  await listbox.getByRole("group", { name: "Customers" }).getByRole("option", { name: CUSTOMER }).click();

  const toolbarChip = map.getByTestId("customer-chip");
  await expect(toolbarChip).toContainText(CUSTOMER);
  // Only the customer's lines are selected; every other drawn line is dimmed.
  const selectedLines = map.locator("[data-testid=map-line][data-selected=true]");
  await expect(selectedLines).toHaveCount(ids.length);
  expect((await selectedLines.evaluateAll((lines) => lines.map((line) => line.dataset.segmentId))).sort())
    .toEqual([...ids].sort());
  const otherLines = map.locator("[data-testid=map-line][data-selected=false]");
  expect(await otherLines.count()).toBeGreaterThan(0);
  await expect(map.locator("[data-testid=map-line][data-selected=false]:not([data-state=dim])")).toHaveCount(0);

  for (const segment of usage.segments) {
    const chip = map.locator(`[data-testid=map-chip][data-segment-id="${segment.segment_id}"]`);
    await expect(chip).toHaveText(new RegExp(`^${segment.used_cores}(?!\\d)`));
    await expect(chip).toHaveClass(/\bused\b/);
    await expect(chip).not.toHaveClass(/\bh-(green|amber|red|ns)\b/);
    await expect(chip).toHaveAttribute("aria-label", new RegExp(`core.? used by ${CUSTOMER}$`));
  }
  await page.waitForTimeout(1000); // camera fit eases in
  // The fit leaves room for the used pills: at least one shows (the rest may be decluttered).
  await expect(map.locator("[data-testid=map-chip].used").filter({ visible: true }).first()).toBeVisible();
  await page.screenshot({ path: test.info().outputPath("customer-mode.png") });

  await toolbarChip.getByRole("button", { name: "Clear customer highlight" }).click();
  await expect(toolbarChip).toHaveCount(0);
  await expect(map.locator("[data-testid=map-line][data-selected=true]")).toHaveCount(0);
  await expect(map.locator("[data-testid=map-chip].used")).toHaveCount(0);

  // Esc clears it too.
  await search.fill(CUSTOMER);
  await listbox.getByRole("group", { name: "Customers" }).getByRole("option", { name: CUSTOMER }).click();
  await expect(toolbarChip).toBeVisible();
  await toolbarChip.getByRole("button", { name: "Clear customer highlight" }).focus();
  await page.keyboard.press("Escape");
  await expect(toolbarChip).toHaveCount(0);

  // A click on bare map (right edge, under the toolbar, away from the key) clears it as well.
  await search.fill(CUSTOMER);
  await listbox.getByRole("group", { name: "Customers" }).getByRole("option", { name: CUSTOMER }).click();
  await expect(toolbarChip).toBeVisible();
  const box = (await map.boundingBox())!;
  await page.mouse.click(box.x + box.width - 8, box.y + 70);
  await expect(toolbarChip).toHaveCount(0);
});

// Request picker: a customer with 2 or more requests that use cores can narrow the highlight to one request; a
// request with 0 used cores (Requested only) is not listed. The DEV seed gives DEV Telco Alpha only one request,
// so its usage response is mocked with three (two using cores, one Requested only); DEV Bank Gamma stays real.
test("request picker narrows customer mode to one request and All requests restores it", async ({ page }) => {
  await signIn(page);
  const single = await usageOf(page, "DEV Bank Gamma");
  expect(single.reservations.length, "DEV Bank Gamma has one request").toBe(1);
  const real = await usageOf(page, CUSTOMER);
  const usage: Usage = {
    ...real,
    segments: [{ segment_id: 1, used_cores: 2 }, { segment_id: 5, used_cores: 2 }],
    reservations: [
      { reservation_id: 1, srf_id: "SRF-DEV-001", planned_date: "2026-12-01", used_cores: 2,
        segments: [{ segment_id: 1, used_cores: 2 }] },
      { reservation_id: 23, srf_id: null, planned_date: null, used_cores: 0,
        segments: [{ segment_id: 1, used_cores: 0 }] },
      { reservation_id: 145, srf_id: "SRF-DEV-STALE", planned_date: "2026-07-25", used_cores: 2,
        segments: [{ segment_id: 5, used_cores: 2 }] },
    ],
  };
  await page.route(`**/api/customers/${real.customer_id}/usage`, (route) => route.fulfill({ json: usage }));
  const listed = usage.reservations.filter((request) => request.used_cores > 0);
  expect(listed.map((request) => request.srf_id).sort()).toEqual(["SRF-DEV-001", "SRF-DEV-STALE"]);
  const allIds = usage.segments.map((segment) => segment.segment_id).sort().join(",");
  const narrower = listed.find((request) =>
    request.srf_id && request.segments.map((segment) => segment.segment_id).sort().join(",") !== allIds);
  expect(narrower, "a request with an SRF on fewer segments than the customer").toBeTruthy();

  const map = page.getByTestId("network-map");
  await expect(map.getByTestId("map-chip").first()).toBeAttached();
  const toolbarChip = map.getByTestId("customer-chip");
  const picker = toolbarChip.getByRole("combobox", { name: "Request" });

  await pickCustomer(page, single.name);
  await expect(toolbarChip).toContainText(single.name);
  await expect(picker).toHaveCount(0);

  await pickCustomer(page, CUSTOMER);
  await expect(toolbarChip).toContainText(CUSTOMER);
  await expect(picker).toHaveValue("all");
  // The chip, its picker and the x fit inside the map (the toolbar wraps or the name truncates).
  const mapBox = (await map.boundingBox())!;
  const clearBox = (await toolbarChip.getByRole("button", { name: "Clear customer highlight" }).boundingBox())!;
  expect(clearBox.x + clearBox.width).toBeLessThanOrEqual(mapBox.x + mapBox.width);
  await expect(picker.locator("option")).toHaveText(["All requests", ...listed.map(optionText)]);
  await expect(picker.locator("option", { hasText: /Request #(23|120) / })).toHaveCount(0);
  // Esc on the picker belongs to the select (it closes its list): customer mode stays.
  await picker.focus();
  await page.keyboard.press("Escape");
  await expect(toolbarChip).toBeVisible();
  const usedBy = new RegExp(`core.? used by ${CUSTOMER}$`);
  await expectHighlight(map, usage.segments, usedBy);

  await picker.selectOption({ label: optionText(narrower!) });
  await expectHighlight(map, narrower!.segments, new RegExp(`used by ${CUSTOMER}, request ${narrower!.srf_id}$`));
  await expect(map.locator("[data-testid=map-line][data-selected=false]:not([data-state=dim])")).toHaveCount(0);
  await page.waitForTimeout(1000); // camera fit eases in
  await page.screenshot({ path: test.info().outputPath("customer-request.png") });

  await picker.selectOption({ label: "All requests" });
  await expectHighlight(map, usage.segments, usedBy);

  // A cleared customer comes back on All requests: the picked request never carries over.
  await picker.selectOption({ label: optionText(narrower!) });
  await toolbarChip.getByRole("button", { name: "Clear customer highlight" }).click();
  await expect(toolbarChip).toHaveCount(0);
  await expect(map.locator("[data-testid=map-chip].used")).toHaveCount(0);
  await pickCustomer(page, CUSTOMER);
  await expect(picker).toHaveValue("all");
  await expectHighlight(map, usage.segments, usedBy);
});
