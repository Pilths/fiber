import { expect, test, type Page } from "@playwright/test";
import { signIn } from "./helpers";

// Map card (TASK-054, TASK-055). Dev seed + seed_dev_network: 19 segments with coordinates, all road-shaped, 2 not drawn (Kuantan Hut).
const SEGMENT = "DEV Kuala Lumpur DC - DEV Cyberjaya DC"; // in the dense KL cluster
const FAR = "DEV Ipoh Exchange - DEV Teluk Intan Hut"; // long and N-S: its chip is never decluttered
const map = (page: Page) => page.getByTestId("network-map");
const chips = (page: Page) => map(page).getByTestId("map-chip");
const chip = (page: Page, name: string) => map(page).getByRole("button", { name: new RegExp(`^Segment ${name},`) });

// Blocks and records every request that leaves the app origin.
async function offline(page: Page) {
  const outside: string[] = [];
  const app = new URL(test.info().project.use.baseURL ?? "http://localhost:5173").host;
  page.on("request", (r) => { const u = new URL(r.url()); if (/^https?:$/.test(u.protocol) && u.host !== app) outside.push(r.url()); });
  await page.route("**/*", (r) => (new URL(r.request().url()).host === app ? r.continue() : r.abort()));
  return outside;
}
const noWebGL = (page: Page) => page.addInitScript(() => {
  const get = HTMLCanvasElement.prototype.getContext;
  // @ts-expect-error test override
  HTMLCanvasElement.prototype.getContext = function (t: string, ...a: unknown[]) { return /webgl/.test(t) ? null : get.call(this, t, ...a); };
});
// Which path the browser took: "gl" (MapLibre + PMTiles) or "svg" (fallback).
const mode = async (page: Page) => {
  await expect(map(page)).not.toHaveAttribute("data-mode", "loading");
  return map(page).getAttribute("data-mode");
};

// Screenshots: on the MapLibre path give tiles and glyphs a moment to draw.
const settle = async (page: Page) => { if ((await mode(page)) === "gl") await page.waitForTimeout(2000); };

test.use({ viewport: { width: 1440, height: 900 } });

test("map loads with no request leaving the app origin; chips, sites, layers and key", async ({ page }) => {
  const outside = await offline(page);
  await signIn(page);
  const m = await mode(page);
  test.info().annotations.push({ type: "map path", description: m ?? "" });
  await expect(chips(page)).toHaveCount(19); // in the DOM; chips that would overlap are hidden until zoomed in
  await expect.poll(() => chips(page).filter({ visible: true }).count()).toBeGreaterThanOrEqual(2); // after the first fit eases in
  await expect(map(page).getByTestId("map-site")).toHaveCount(13);
  await expect(map(page).getByRole("button", { name: /^Site DEV Kuala Lumpur DC, data centre, 6 segments$/ })).toBeVisible();
  await expect(map(page).getByRole("button", { name: /^Site DEV Penang Tower, trunk site/ })).toBeVisible();
  await expect(chip(page, FAR)).toHaveText(/^(\d+|–)$/); // the free-core number only, no icon
  await expect(chips(page).locator("svg")).toHaveCount(0);
  await expect(page.getByTestId("map-not-drawn")).toContainText("2 segments not on the map (no coordinates)");
  await expect(map(page).getByRole("group", { name: "Map key" })).toContainText("Route type");
  if (m === "gl") {
    await expect(page.getByTestId("map-note")).toHaveCount(0);
    await page.waitForFunction(() => document.querySelector(".maplibregl-canvas"));
    await page.waitForTimeout(1500); // let tiles and glyphs load
  }

  await page.getByRole("button", { name: "Layers" }).click();
  for (const type of ["Trunk", "Metro", "DC-DC", "DC-TOC"]) {
    await expect(page.getByRole("checkbox", { name: type, exact: true })).toBeChecked();
  }
  // Site layers: hiding TOC removes the TOC marker, showing it brings it back
  const toc = page.getByRole("button", { name: /^Site DEV Bukit Jalil TOC, TOC,/ });
  await expect(toc).toBeVisible();
  await page.getByRole("checkbox", { name: "TOC", exact: true }).uncheck();
  await expect(toc).toHaveCount(0);
  await page.getByRole("checkbox", { name: "TOC", exact: true }).check();
  await expect(toc).toBeVisible();
  await expect(page.getByRole("checkbox", { name: "Data centres" })).toBeChecked();
  await expect(page.getByRole("checkbox", { name: "Trunk sites" })).toBeChecked();
  // Route types: unticking all four hides every line and chip
  for (const type of ["Trunk", "Metro", "DC-DC", "DC-TOC"]) {
    await page.getByRole("checkbox", { name: type, exact: true }).uncheck();
  }
  await expect(chips(page)).toHaveCount(0);
  for (const type of ["Trunk", "Metro", "DC-DC", "DC-TOC"]) {
    await page.getByRole("checkbox", { name: type, exact: true }).check();
  }
  await page.getByRole("button", { name: "Layers" }).click();
  await expect(chips(page)).toHaveCount(19);
  await page.screenshot({ path: "e2e/screenshots/map-overview.png" });
  expect(outside).toEqual([]);
});

test("clicking a chip selects the segment; Enter on a chip too; Esc clears", async ({ page }) => {
  await signIn(page);
  await chip(page, FAR).click();
  await expect(page.locator("#segment-h", { hasText: FAR })).toBeVisible();
  await expect(page).toHaveURL(new RegExp(`#segment=${encodeURIComponent(FAR)}$`));
  await expect(chip(page, FAR)).toHaveAttribute("aria-pressed", "true");
  await expect(map(page).locator('[data-testid=map-line][data-selected=true]')).toHaveCount(1);
  await expect(map(page).locator("[data-testid=map-site][data-end=true]")).toHaveCount(2);
  await page.evaluate(() => scrollTo(0, 0));
  await settle(page);
  await page.screenshot({ path: "e2e/screenshots/map-segment-selected.png" });

  const other = "DEV Tanjung Malim Hut - DEV Kuala Lumpur DC";
  await chip(page, other).focus();
  await page.keyboard.press("Enter");
  await expect(page.locator("#segment-h", { hasText: other })).toBeVisible();
  await chip(page, other).focus();
  await page.keyboard.press("Escape");
  await expect(page.locator("#segment-h")).toHaveCount(0);
  await expect(map(page).locator('[data-testid=map-line][data-selected=true]')).toHaveCount(0);
  expect(page.url()).not.toContain("#segment=");
});

test("Layers: route types and trunk routes hide their lines; the selected segment always shows", async ({ page }) => {
  await signIn(page);
  await expect(chips(page)).toHaveCount(19);
  const segs: { id: number; route_type: string | null; route: string | null }[] =
    await (await page.request.get("/api/segments")).json();
  const lines = page.locator("[data-testid=map-line]");
  const total = await lines.count();
  const drawnIds = await lines.evaluateAll((es) => es.map((e) => Number(e.getAttribute("data-segment-id"))));
  const drawn = segs.filter((s) => drawnIds.includes(s.id)); // segments without coordinates are not drawn
  const count = (test: (s: { route_type: string | null; route: string | null }) => boolean) => drawn.filter(test).length;
  await expect(map(page).getByLabel("Type")).toHaveCount(0); // route types are in Layers, not a filter
  await page.getByRole("button", { name: "Layers" }).click();
  const metro = page.getByRole("checkbox", { name: "Metro", exact: true });
  await metro.uncheck();
  await expect(lines).toHaveCount(total - count((s) => s.route_type === "Metro"));
  await metro.check();
  await expect(lines).toHaveCount(total);
  // a trunk route chip hides that route's trunk lines
  const route = drawn.find((s) => s.route_type === "Trunk" && s.route)!.route!;
  const chip = page.getByRole("button", { name: `Trunk ${route}` });
  await expect(chip).toHaveAttribute("aria-pressed", "true");
  await chip.click();
  await expect(chip).toHaveAttribute("aria-pressed", "false");
  await expect(lines).toHaveCount(total - count((s) => s.route_type === "Trunk" && s.route === route));
  await chip.click();
  await expect(lines).toHaveCount(total);
  // the map key toggles the same layers: click Metro in the key, the Layers tick box follows
  const keyMetro = page.getByRole("group", { name: "Map key" }).getByRole("button", { name: "Show Metro lines" });
  await keyMetro.click();
  await expect(keyMetro).toHaveAttribute("aria-pressed", "false");
  await expect(page.getByRole("checkbox", { name: "Metro", exact: true })).not.toBeChecked();
  await expect(lines).toHaveCount(total - count((s) => s.route_type === "Metro"));
  await keyMetro.click();
  await expect(lines).toHaveCount(total);
  // a selected Metro segment stays on the map with Metro unticked
  const picked = drawn.find((s) => s.route_type === "Metro")!;
  const hash = `#segment=${encodeURIComponent(await segmentNameOf(page, picked.id))}`;
  await page.evaluate((value) => { location.hash = value; }, hash);
  await expect(page.locator(`[data-testid=map-line][data-segment-id="${picked.id}"]`)).toHaveAttribute("data-selected", "true");
  await page.getByRole("checkbox", { name: "Metro", exact: true }).uncheck();
  await expect(page.locator(`[data-testid=map-line][data-segment-id="${picked.id}"]`)).toHaveCount(1);
});

async function segmentNameOf(page: Page, id: number): Promise<string> {
  const segment: { site_a: string; site_b: string } = await (await page.request.get(`/api/segments/${id}`)).json();
  return `${segment.site_a} - ${segment.site_b}`;
}

// Route search shows the best option; only the 2-segment Penang - Butterworth - Ipoh option is kept.
async function searchKlBj(page: Page) {
  await page.route("**/api/routes?*", async (r) => {
    const j = (await (await r.fetch()).json()) as { options: { segments: unknown[] }[] };
    r.fulfill({ json: { ...j, options: j.options.filter((o) => o.segments.length === 2) } });
  });
  const search = page.getByRole("region", { name: "Site A to B" });
  await search.getByLabel("Site A").fill("DEV Penang Tower");
  await search.getByLabel("Site B").fill("DEV Ipoh Exchange");
  await search.getByRole("button", { name: "Find route" }).click();
  await expect(page.locator("[data-testid=route-option][aria-pressed=true]")).toContainText(/2 segments,/);
}

test("a route highlights its segments in blue", async ({ page }) => {
  await signIn(page);
  await searchKlBj(page);
  await expect(map(page).locator("[data-testid=map-line][data-selected=true]")).toHaveCount(2);
  await expect(map(page).locator("[data-testid=map-chip][data-selected=true]")).toHaveCount(2);
  await expect(chip(page, "DEV Butterworth Hut - DEV Ipoh Exchange")).toHaveAttribute("aria-pressed", "true");
  await page.evaluate(() => scrollTo(0, 0));
  await settle(page);
  await page.screenshot({ path: "e2e/screenshots/map-route.png" });
});

test("missing basemap file: note shown, segments still drawn, search still works", async ({ page }) => {
  await page.route("**/map/malaysia.pmtiles", (r) => r.fulfill({ status: 404, body: "" }));
  await signIn(page);
  await expect(map(page)).toHaveAttribute("data-mode", "svg");
  const note = page.getByTestId("map-note");
  await expect(note).toContainText(/Basemap not installed on this machine: run \.\/scripts\/get-tiles\.sh|no WebGL/);
  await expect(chips(page)).toHaveCount(19);
  const search = page.getByRole("region", { name: "Site A to B" });
  await search.getByLabel("Site A").fill("DEV Ipoh Exchange");
  await search.getByLabel("Site B").fill("DEV Penang Tower");
  await search.getByRole("button", { name: "Find route" }).click();
  await expect(page.locator("[data-testid=route-option][aria-pressed=true]")).toContainText(/1 segment,/);
});

test("no WebGL: the SVG fallback draws segments and selects by click", async ({ page }) => {
  await noWebGL(page);
  const outside = await offline(page);
  await signIn(page);
  await expect(map(page)).toHaveAttribute("data-mode", "svg");
  await expect(page.getByTestId("map-note")).toContainText("no WebGL");
  await expect(chips(page)).toHaveCount(19);
  await chip(page, FAR).click();
  await expect(page.locator("#segment-h", { hasText: FAR })).toBeVisible();
  await page.getByRole("button", { name: "Zoom in" }).click();
  await page.getByRole("button", { name: "Fit selection" }).click();
  await expect(chip(page, FAR)).toBeInViewport();
  expect(outside).toEqual([]);
});

test("map page has no horizontal scroll at 1200, 1280, 1440 and 1920", async ({ page }) => {
  await signIn(page);
  await expect(chips(page)).toHaveCount(19);
  for (const w of [1200, 1280, 1440, 1920]) {
    await page.setViewportSize({ width: w, height: 900 });
    await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBe(0);
  }
});

// The map stage is the growing child of its card: no blank band under the map, in each state (TASK-054 follow-up).
test("the stage fills the map card: nothing, segment and route selected", async ({ page }) => {
  await signIn(page);
  await expect(chips(page)).toHaveCount(19);
  const gaps = () => page.evaluate(() => {
    const card = document.querySelector('section[aria-label="Network map"]')!;
    const body = card.lastElementChild!; // NetworkMap root: stage, then the note line and "not on the map"
    const pad = parseFloat(getComputedStyle(card).paddingBottom);
    return { inCard: Math.round(card.getBoundingClientRect().bottom - pad - body.lastElementChild!.getBoundingClientRect().bottom) };
  });
  // Within a few px: the last line's box rounds to a pixel or two.
  const check = async () => expect.poll(async () => { const g = await gaps(); return Math.abs(g.inCard) <= 3; }).toBe(true);
  await check();
  await chip(page, FAR).click();
  await expect(page.locator("#segment-h", { hasText: FAR })).toBeVisible();
  await check();
  await page.evaluate(() => scrollTo(0, 0));
  await settle(page);
  await page.screenshot({ path: "e2e/screenshots/map-layout-fixed.png" });
  await searchKlBj(page);
  await expect(map(page).locator("[data-testid=map-line][data-selected=true]").first()).toBeVisible();
  await check();
});

// A segment picked outside the map (top bar search) is followed by the camera; a segment clicked on the map is already in view and stays put.
test("picking a segment in the top bar search moves the camera; clicking it on the map does not", async ({ page }) => {
  await signIn(page);
  test.skip((await mode(page)) !== "gl", "camera checks need MapLibre (basemap installed and WebGL)");
  await page.waitForFunction(() => (window as { fiberMap?: { loaded(): boolean } }).fiberMap?.loaded());
  const cam = () => page.evaluate(() => {
    const m = (window as unknown as { fiberMap: import("maplibre-gl").Map }).fiberMap, c = m.getCenter();
    return { zoom: m.getZoom(), lng: c.lng, lat: c.lat, moving: m.isMoving() };
  });
  const still = async () => { await expect.poll(async () => (await cam()).moving).toBe(false); await page.waitForTimeout(400); return cam(); };
  const start = await still(); // the first fit to all segments

  await page.getByRole("combobox", { name: /^Find a segment/ }).fill("Cyberjaya");
  await page.getByRole("option", { name: SEGMENT }).first().click();
  await expect(page.locator("#segment-h", { hasText: SEGMENT })).toBeVisible();
  await expect.poll(async () => (await cam()).zoom).toBeGreaterThan(start.zoom + 0.5);
  const followed = await still();
  expect(followed.zoom).toBeGreaterThan(start.zoom);
  expect(Math.hypot(followed.lng - start.lng, followed.lat - start.lat)).toBeGreaterThan(1e-3);

  await page.evaluate(() => scrollTo(0, 0));
  const other = "DEV Cyberjaya DC - DEV Bukit Jalil TOC";
  await chip(page, other).click(); // a different segment, clicked on the map
  await expect(page.locator("#segment-h", { hasText: other })).toBeVisible();
  const after = await still();
  expect(after.zoom).toBeCloseTo(followed.zoom, 5);
  expect(after.lng).toBeCloseTo(followed.lng, 6);
  expect(after.lat).toBeCloseTo(followed.lat, 6);
});

// Buildings and walking paths draw past the extract's zoom 14 (overzoom). Needs the basemap installed and WebGL.
test("zoomed to 17 near DEV Kuala Lumpur DC the buildings layer draws", async ({ page }) => {
  const outside = await offline(page);
  await signIn(page);
  test.skip((await mode(page)) !== "gl", "basemap not installed or no WebGL: no tile layers to check");
  await page.waitForFunction(() => (window as { fiberMap?: { loaded(): boolean } }).fiberMap?.loaded());
  const counts = await page.evaluate(() => new Promise<{ buildings: number; paths: number; zoom: number }>((done) => {
    const m = (window as unknown as { fiberMap: import("maplibre-gl").Map }).fiberMap;
    m.once("idle", () => done({
      buildings: m.queryRenderedFeatures({ layers: ["buildings"] }).length,
      paths: m.queryRenderedFeatures({ layers: ["paths"] }).length,
      zoom: m.getZoom(),
    }));
    m.jumpTo({ center: [101.6869, 3.139], zoom: 17 });
  }));
  test.skip(counts.buildings === 0, "the installed extract has no buildings near this site");
  expect(counts.zoom).toBeGreaterThanOrEqual(16);
  expect(counts.buildings).toBeGreaterThan(0);
  test.info().annotations.push({ type: "rendered", description: `${counts.buildings} buildings, ${counts.paths} path pieces at z${counts.zoom}` });
  await page.waitForTimeout(1000); // glyphs for street names
  await page.screenshot({ path: "e2e/screenshots/map-buildings.png" });
  expect(outside).toEqual([]);
});
