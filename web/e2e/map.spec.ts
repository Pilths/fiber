import { expect, test, type Page } from "@playwright/test";
import { signIn, tab } from "./helpers";

// Map card (TASK-054, TASK-055). Dev seed: 5 spans with coordinates (KL-CJ and CJ-BJ shaped), 2 not drawn (Kuantan Hut).
const SPAN = "DEV Kuala Lumpur DC - DEV Cyberjaya DC"; // shaped, in the dense KL cluster
const FAR = "DEV Ipoh Exchange - DEV Penang Tower"; // alone in the north: its chip is never decluttered
const map = (page: Page) => page.getByTestId("network-map");
const chips = (page: Page) => map(page).getByTestId("map-chip");
const chip = (page: Page, name: string) => map(page).getByRole("button", { name: new RegExp(`^Span ${name},`) });

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
  await expect(chips(page)).toHaveCount(5); // in the DOM; chips that would overlap are hidden until zoomed in
  await expect.poll(() => chips(page).filter({ visible: true }).count()).toBeGreaterThanOrEqual(2); // after the first fit eases in
  await expect(map(page).getByTestId("map-site")).toHaveCount(5);
  await expect(map(page).getByRole("button", { name: /^Site DEV Kuala Lumpur DC, data centre, 3 spans$/ })).toBeVisible();
  await expect(map(page).getByRole("button", { name: /^Site DEV Penang Tower, other site/ })).toBeVisible();
  await expect(chip(page, FAR)).toHaveText(/^(\d+|–)$/); // the free-core number only, no icon
  await expect(chips(page).locator("svg")).toHaveCount(0);
  await expect(page.getByTestId("map-not-drawn")).toContainText("2 spans not on the map (no coordinates)");
  await expect(map(page).getByRole("group", { name: "Map key" })).toContainText("Route type");
  if (m === "gl") {
    await expect(page.getByTestId("map-note")).toHaveCount(0);
    await page.waitForFunction(() => document.querySelector(".maplibregl-canvas"));
    await page.waitForTimeout(1500); // let tiles and glyphs load
  }

  await page.getByRole("button", { name: "Layers" }).click();
  await expect(page.getByRole("checkbox", { name: "Dark fibre" })).toBeChecked();
  for (const l of ["Services", "Data centres"]) {
    const box = page.getByRole("checkbox", { name: new RegExp(l) });
    await expect(box).toHaveAttribute("aria-disabled", "true");
    await expect(box.locator("xpath=..")).toContainText("Later");
    await box.focus();
    await expect(box).toBeFocused();
    await box.click({ force: true });
    await expect(box).not.toBeChecked();
  }
  await page.getByRole("checkbox", { name: "Dark fibre" }).uncheck();
  await expect(chips(page)).toHaveCount(0);
  await page.getByRole("checkbox", { name: "Dark fibre" }).check();
  await page.getByRole("button", { name: "Layers" }).click();
  await expect(chips(page)).toHaveCount(5);
  await page.screenshot({ path: "e2e/screenshots/map-overview.png" });
  expect(outside).toEqual([]);
});

test("clicking a chip selects the span; Enter on a chip too; Esc clears", async ({ page }) => {
  await signIn(page);
  await chip(page, FAR).click();
  await expect(page.locator("#span-h", { hasText: FAR })).toBeVisible();
  await expect(page).toHaveURL(new RegExp(`#span=${encodeURIComponent(FAR)}$`));
  await expect(chip(page, FAR)).toHaveAttribute("aria-pressed", "true");
  await expect(map(page).locator('[data-testid=map-line][data-selected=true]')).toHaveCount(1);
  await expect(map(page).locator("[data-testid=map-site][data-end=true]")).toHaveCount(2);
  await page.evaluate(() => scrollTo(0, 0));
  await settle(page);
  await page.screenshot({ path: "e2e/screenshots/map-span-selected.png" });

  const other = "DEV Kuala Lumpur DC - DEV Ipoh Exchange";
  await chip(page, other).focus();
  await page.keyboard.press("Enter");
  await expect(page.locator("#span-h", { hasText: other })).toBeVisible();
  await chip(page, other).focus();
  await page.keyboard.press("Escape");
  await expect(page.locator("#span-h")).toHaveCount(0);
  await expect(map(page).locator('[data-testid=map-line][data-selected=true]')).toHaveCount(0);
  expect(page.url()).not.toContain("#span=");
});

test("Route filter on the Reserve tab lists the routes of the loaded spans (routes mocked)", async ({ page }) => {
  // Dev spans have no route yet: give the two drawn Trunk spans route R1 in the list and in the span detail.
  const withRoute = (s: { id: number }) => ({ ...s, route: [4, 5].includes(s.id) ? "R1" : null, section: s.id === 4 ? "N-C" : null });
  await page.route("**/api/spans", async (r) => r.fulfill({ json: ((await (await r.fetch()).json()) as { id: number }[]).map(withRoute) }));
  await page.route("**/api/spans/*", async (r) => r.fulfill({ json: withRoute(await (await r.fetch()).json()) }));
  await signIn(page);
  await tab(page, "Reserve");
  const route = page.getByRole("combobox", { name: "Route", exact: true });
  await expect(route.getByRole("option")).toHaveText(["All routes", "R1"]);
  await route.selectOption("R1");
  await expect(page.getByRole("list", { name: "Spans" }).getByRole("button")).toHaveCount(2);
  await page.getByRole("list", { name: "Spans" }).getByRole("button", { name: /DEV Kuala Lumpur DC - DEV Ipoh Exchange/ }).click();
  await tab(page, "Map");
  await expect(page.getByRole("region", { name: "Inspector" })).toContainText("Route R1");
  await expect(page.getByRole("region", { name: "Inspector" })).toContainText("Section N-C");
  await page.unrouteAll({ behavior: "ignoreErrors" }); // the tab change refetches the span list
});

// Route search shows the best option; the mock puts the 2-span KL-CJ-BJ option first.
async function searchKlBj(page: Page) {
  await page.route("**/api/routes?*", async (r) => {
    const j = (await (await r.fetch()).json()) as { options: { spans: unknown[] }[] };
    r.fulfill({ json: { ...j, options: j.options.filter((o) => o.spans.length === 2) } });
  });
  const search = page.getByRole("region", { name: "Route search" });
  await search.getByLabel("Route A").fill("DEV Kuala Lumpur DC");
  await search.getByLabel("Route B").fill("DEV Bukit Jalil TOC");
  await search.getByRole("button", { name: "Search" }).click();
  await expect(page.getByTestId("route-found")).toHaveText(/^2 spans/);
}

test("a route highlights its spans in blue, the shaped KL-CJ-BJ curve included", async ({ page }) => {
  await signIn(page);
  await searchKlBj(page);
  await expect(map(page).locator("[data-testid=map-line][data-selected=true]")).toHaveCount(2);
  await expect(map(page).locator("[data-testid=map-chip][data-selected=true]")).toHaveCount(2);
  await expect(chip(page, SPAN)).toHaveAttribute("aria-pressed", "true");
  await expect(chip(page, "DEV Cyberjaya DC - DEV Bukit Jalil TOC")).toHaveAttribute("aria-pressed", "true");
  await page.evaluate(() => scrollTo(0, 0));
  await settle(page);
  await page.screenshot({ path: "e2e/screenshots/map-route.png" });
});

test("missing basemap file: note shown, spans still drawn, search still works", async ({ page }) => {
  await page.route("**/map/malaysia.pmtiles", (r) => r.fulfill({ status: 404, body: "" }));
  await signIn(page);
  await expect(map(page)).toHaveAttribute("data-mode", "svg");
  const note = page.getByTestId("map-note");
  await expect(note).toContainText(/Basemap not installed on this machine: run \.\/scripts\/get-tiles\.sh|no WebGL/);
  await expect(chips(page)).toHaveCount(5);
  const search = page.getByRole("region", { name: "Route search" });
  await search.getByLabel("Route A").fill("DEV Ipoh Exchange");
  await search.getByLabel("Route B").fill("DEV Penang Tower");
  await search.getByRole("button", { name: "Search" }).click();
  await expect(page.getByTestId("route-found")).toHaveText(/^1 span,/);
});

test("no WebGL: the SVG fallback draws spans and selects by click", async ({ page }) => {
  await noWebGL(page);
  const outside = await offline(page);
  await signIn(page);
  await expect(map(page)).toHaveAttribute("data-mode", "svg");
  await expect(page.getByTestId("map-note")).toContainText("no WebGL");
  await expect(chips(page)).toHaveCount(5);
  await chip(page, FAR).click();
  await expect(page.locator("#span-h", { hasText: FAR })).toBeVisible();
  await page.getByRole("button", { name: "Zoom in" }).click();
  await page.getByRole("button", { name: "Fit selection" }).click();
  await expect(chip(page, FAR)).toBeInViewport();
  expect(outside).toEqual([]);
});

test("map page has no horizontal scroll at 1200, 1280, 1440 and 1920", async ({ page }) => {
  await signIn(page);
  await expect(chips(page)).toHaveCount(5);
  for (const w of [1200, 1280, 1440, 1920]) {
    await page.setViewportSize({ width: w, height: 900 });
    await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBe(0);
  }
});

// The map stage is the growing child of its card: no blank band under the map, in each state (TASK-054 follow-up).
// The Inspector (420px) is shorter than the map now that Find has left the Map page, so only the stage is checked.
test("the stage fills the map card: nothing, span and route selected", async ({ page }) => {
  await signIn(page);
  await expect(chips(page)).toHaveCount(5);
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
  await expect(page.locator("#span-h", { hasText: FAR })).toBeVisible();
  await check();
  await page.evaluate(() => scrollTo(0, 0));
  await settle(page);
  await page.screenshot({ path: "e2e/screenshots/map-layout-fixed.png" });
  await searchKlBj(page);
  await expect(map(page).locator("[data-testid=map-line][data-selected=true]").first()).toBeVisible();
  await check();
});

// A span picked outside the map (top bar search) is followed by the camera; a span clicked on the map is already in view and stays put.
test("picking a span in the top bar search moves the camera; clicking it on the map does not", async ({ page }) => {
  await signIn(page);
  test.skip((await mode(page)) !== "gl", "camera checks need MapLibre (basemap installed and WebGL)");
  await page.waitForFunction(() => (window as { fiberMap?: { loaded(): boolean } }).fiberMap?.loaded());
  const cam = () => page.evaluate(() => {
    const m = (window as unknown as { fiberMap: import("maplibre-gl").Map }).fiberMap, c = m.getCenter();
    return { zoom: m.getZoom(), lng: c.lng, lat: c.lat, moving: m.isMoving() };
  });
  const still = async () => { await expect.poll(async () => (await cam()).moving).toBe(false); await page.waitForTimeout(400); return cam(); };
  const start = await still(); // the first fit to all spans

  await page.getByRole("combobox", { name: /^Find a span/ }).fill("Cyberjaya");
  await page.getByRole("option", { name: SPAN }).first().click();
  await expect(page.locator("#span-h", { hasText: SPAN })).toBeVisible();
  await expect.poll(async () => (await cam()).zoom).toBeGreaterThan(start.zoom + 0.5);
  const followed = await still();
  expect(followed.zoom).toBeGreaterThan(start.zoom);
  expect(Math.hypot(followed.lng - start.lng, followed.lat - start.lat)).toBeGreaterThan(1e-3);

  await page.evaluate(() => scrollTo(0, 0));
  const other = "DEV Cyberjaya DC - DEV Bukit Jalil TOC";
  await chip(page, other).click(); // a different span, clicked on the map
  await expect(page.locator("#span-h", { hasText: other })).toBeVisible();
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
