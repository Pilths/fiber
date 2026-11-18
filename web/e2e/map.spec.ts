import { expect, test, type Page } from "@playwright/test";
import { signIn } from "./helpers";

// Map card (TASK-054, TASK-055). Dev seed + seed_dev_network: 22 segments with coordinates (3 inside the DEV clusters),
// all road-shaped, 2 not drawn (Kuantan Hut).
const DRAWN = 22;
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

// Site markers plus the sites inside count badges and under cluster labels (their count badge).
async function drawnSiteCount(page: Page): Promise<number> {
  const markers = await map(page).getByTestId("map-site").count();
  const badgeTexts = await map(page).getByTestId("map-badge").allTextContents();
  const badged = badgeTexts.reduce((total, text) => total + Number(text), 0);
  const clusterTexts = await map(page).locator("[data-testid=map-sector-label] .msector-n").allTextContents();
  const underLabels = clusterTexts.reduce((total, text) => total + Number(text), 0);
  return markers + badged + underLabels;
}

type MapSites = { features: { properties: { site_id: number; name: string; cluster?: string | null } }[] };
const mapSites = async (page: Page): Promise<MapSites> => (await page.request.get("/api/map/sites")).json();

test("map loads with no request leaving the app origin; chips, sites, layers and key", async ({ page }) => {
  const outside = await offline(page);
  await signIn(page);
  const m = await mode(page);
  test.info().annotations.push({ type: "map path", description: m ?? "" });
  await expect(chips(page)).toHaveCount(DRAWN); // in the DOM; chips that would overlap are hidden until zoomed in
  await expect.poll(() => chips(page).filter({ visible: true }).count()).toBeGreaterThanOrEqual(2); // after the first fit eases in
  // Sites closer than 16px share a count badge and cluster sites sit under their label: together they cover every site.
  const siteTotal = (await mapSites(page)).features.length;
  await expect.poll(() => drawnSiteCount(page)).toBe(siteTotal);
  await expect(map(page).getByRole("button", { name: /DEV Kuala Lumpur DC/ }).first()).toBeVisible();
  await expect(map(page).getByRole("button", { name: /DEV Penang Tower/ }).first()).toBeVisible();
  await expect(chip(page, FAR)).toHaveText(/^(\d+|–)$/); // the free-core number only, no icon
  await expect(chips(page).locator("svg")).toHaveCount(0);
  await expect(page.getByTestId("map-not-drawn")).toContainText("2 segments not on the map (no coordinates)");
  // Region, Layers and the key live at the foot of the Site A to B panel, not on the map.
  await expect(map(page).getByRole("button", { name: "Layers" })).toHaveCount(0);
  await expect(map(page).getByLabel("Region")).toHaveCount(0);
  await expect(page.getByRole("group", { name: "Map filters" })).toContainText("Selected");
  if (m === "gl") {
    await expect(page.getByTestId("map-note")).toHaveCount(0);
    await page.waitForFunction(() => document.querySelector(".maplibregl-canvas"));
    await page.waitForTimeout(1500); // let tiles and glyphs load
  }

  for (const type of ["Trunk", "Metro", "DC-DC", "DC-TOC"]) {
    await expect(page.getByRole("checkbox", { name: type, exact: true })).toBeChecked();
  }
  // Site layers: hiding TOC removes the TOC marker, showing it brings it back
  const toc = map(page).getByRole("button", { name: /DEV Bukit Jalil TOC/ }); // its marker, or the badge it shares
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
  await expect(chips(page)).toHaveCount(DRAWN);
  await page.screenshot({ path: "e2e/screenshots/map-overview.png" });
  expect(outside).toEqual([]);
});

test("clicking a chip selects the segment, clicking it again unselects; Enter on a chip too; Esc clears", async ({ page }) => {
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

  await chip(page, FAR).click();
  await expect(page.locator("#segment-h")).toHaveCount(0);
  await expect(chip(page, FAR)).toHaveAttribute("aria-pressed", "false");
  expect(page.url()).not.toContain("#segment=");

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

test("Layers: route types and trunk routes hide their lines; turning off the selected segment's layer unselects it", async ({ page }) => {
  await signIn(page);
  await expect(chips(page)).toHaveCount(DRAWN);
  const segs: { id: number; route_type: string | null; route: string | null }[] =
    await (await page.request.get("/api/segments")).json();
  const lines = page.locator("[data-testid=map-line]");
  const total = await lines.count();
  const drawnIds = await lines.evaluateAll((es) => es.map((e) => Number(e.getAttribute("data-segment-id"))));
  const drawn = segs.filter((s) => drawnIds.includes(s.id)); // segments without coordinates are not drawn
  const count = (test: (s: { route_type: string | null; route: string | null }) => boolean) => drawn.filter(test).length;
  await expect(map(page).getByLabel("Type")).toHaveCount(0); // route types are in Layers, not a filter
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
  // unticking the layer of the selected Metro segment unselects it and hides it
  const picked = drawn.find((s) => s.route_type === "Metro")!;
  const hash = `#segment=${encodeURIComponent(await segmentNameOf(page, picked.id))}`;
  await page.evaluate((value) => { location.hash = value; }, hash);
  const pickedLine = page.locator(`[data-testid=map-line][data-segment-id="${picked.id}"]`);
  await expect(pickedLine).toHaveAttribute("data-selected", "true");
  await page.getByRole("checkbox", { name: "Metro", exact: true }).uncheck();
  await expect(pickedLine).toHaveCount(0);
  await expect(page.locator("[data-testid=map-line][data-selected=true]")).toHaveCount(0);
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
  await expect(chips(page)).toHaveCount(DRAWN);
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
  await expect(chips(page)).toHaveCount(DRAWN);
  await chip(page, FAR).click();
  await expect(page.locator("#segment-h", { hasText: FAR })).toBeVisible();
  await page.getByRole("button", { name: "Zoom in" }).click();
  await page.getByRole("button", { name: "Fit selection" }).click();
  await expect(chip(page, FAR)).toBeInViewport();
  expect(outside).toEqual([]);
});

test("map page has no horizontal scroll at 1200, 1280, 1440 and 1920", async ({ page }) => {
  await signIn(page);
  await expect(chips(page)).toHaveCount(DRAWN);
  for (const w of [1200, 1280, 1440, 1920]) {
    await page.setViewportSize({ width: w, height: 900 });
    await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBe(0);
  }
});

// The map stage is the growing child of its card: no blank band under the map, in each state (TASK-054 follow-up).
test("the stage fills the map card: nothing, segment and route selected", async ({ page }) => {
  await signIn(page);
  await expect(chips(page)).toHaveCount(DRAWN);
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

test("Region filter that leaves out the selected segment unselects it", async ({ page }) => {
  await signIn(page);
  await expect(chips(page)).toHaveCount(DRAWN);
  const segs: { id: number; region: string | null }[] = await (await page.request.get("/api/segments")).json();
  const picked = segs.find((s) => s.region)!;
  const other = segs.find((s) => s.region && s.region !== picked.region)!.region!;
  const hash = `#segment=${encodeURIComponent(await segmentNameOf(page, picked.id))}`;
  await page.evaluate((value) => { location.hash = value; }, hash);
  const pickedLine = page.locator(`[data-testid=map-line][data-segment-id="${picked.id}"]`);
  await expect(pickedLine).toHaveAttribute("data-selected", "true");
  await page.getByRole("group", { name: "Map filters" }).getByLabel("Region").selectOption(other);
  await expect(page.locator("[data-testid=map-line][data-selected=true]")).toHaveCount(0);
  expect(page.url()).not.toContain("#segment=");
});

// Clusters from the DEV seed (seed_dev_network): read only, nothing is written.
const CLUSTER = "DEV KL Cluster";

test("clusters: label with site count zoomed out, outline and sites zoomed in, always drawn", async ({ page }) => {
  // A cluster name is dropped where it would overlap a site. At 1440x900 the first fit of the DEV network puts
  // both cluster names on sites; 60px shorter (the map's height before 16 Nov 2026) the KL name has room.
  await page.setViewportSize({ width: 1440, height: 840 });
  await signIn(page);
  await mode(page);
  const sectors: { features: { properties: Record<string, unknown> & { cluster: string; site_count: number } }[] } =
    await (await page.request.get("/api/map/sectors")).json();
  test.skip(!sectors.features.some((sector) => sector.properties.cluster === CLUSTER), "DEV clusters not seeded");
  // Only a cluster of 2 or more sites has a sector, and it carries no free-core number.
  for (const sector of sectors.features) {
    expect(sector.properties.site_count).toBeGreaterThanOrEqual(2);
    expect(sector.properties).not.toHaveProperty("free_cores");
  }
  const members = (await mapSites(page)).features
    .filter((site) => site.properties.cluster === CLUSTER)
    .map((site) => site.properties.name);
  const label = map(page).getByRole("button", { name: new RegExp(`^Cluster ${CLUSTER}, ${members.length} sites:`) });
  const klMarkerOrBadge = map(page).getByRole("button", { name: /^(Site |\d+ sites: .*)DEV Kuala Lumpur DC/ });
  // Zoomed out: one label per cluster, a count badge with its name; the cluster's sites are under it, other sites are drawn.
  await expect(map(page).getByTestId("map-sector-label")).toHaveCount(sectors.features.length);
  await expect(label).toBeVisible();
  await expect(label.locator(".msector-n")).toHaveText(String(members.length));
  await expect(label.locator(".msector-name")).toHaveText(CLUSTER);
  // Small: a count badge with the name as text beside it, not a box over the site names.
  const labelBox = (await label.boundingBox())!;
  expect(labelBox.width).toBeLessThanOrEqual(24);
  expect(labelBox.height).toBeLessThanOrEqual(24);
  await expect(klMarkerOrBadge).toHaveCount(0);
  await expect(map(page).getByRole("button", { name: /^Site DEV Ipoh Exchange,/ })).toBeVisible();
  await settle(page);
  await page.screenshot({ path: "e2e/screenshots/map-cluster-out.png" });
  // The label zooms to the cluster: the label goes, the outline and each member site show.
  await label.click();
  await expect(label).toHaveCount(0);
  for (const name of members) {
    await expect(map(page).getByRole("button", { name: new RegExp(`^Site ${name},`) })).toBeVisible();
  }
  await expect(map(page).locator(`[data-testid=map-sector][data-cluster="${CLUSTER}"]`)).toHaveCount(1);
  await expect(map(page).getByTestId("map-site").locator(".shape.dc").first()).toHaveCSS("width", "12px");
  await settle(page);
  await page.screenshot({ path: "e2e/screenshots/map-cluster-in.png" });
  // Clusters are always drawn: the filters have no per-cluster chip.
  await expect(page.getByRole("button", { name: `Cluster ${CLUSTER}`, exact: true })).toHaveCount(0);
});

// The header search lists clusters under Clusters; picking one fits the map to the cluster.
test("picking a cluster in the top bar search zooms the map to it", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 840 });
  await signIn(page);
  await mode(page);
  const members = (await mapSites(page)).features
    .filter((site) => site.properties.cluster === CLUSTER)
    .map((site) => site.properties.name);
  test.skip(members.length < 2, "DEV clusters not seeded");
  const label = map(page).getByRole("button", { name: new RegExp(`^Cluster ${CLUSTER}, `) });
  await expect(label).toBeVisible();
  await page.getByRole("combobox", { name: /^Find a segment/ }).fill("KL Clus");
  const clusters = page.getByRole("group", { name: "Clusters" });
  await expect(clusters).toBeVisible();
  await clusters.getByRole("option", { name: CLUSTER }).click();
  await expect(page.getByRole("listbox", { name: "Search results" })).toHaveCount(0);
  // Zoomed in on the cluster: the label gives way to the outline and each member site.
  await expect(label).toHaveCount(0);
  await expect(map(page).locator(`[data-testid=map-sector][data-cluster="${CLUSTER}"]`)).toHaveCount(1);
  for (const name of members) {
    await expect(map(page).getByRole("button", { name: new RegExp(`^Site ${name},`) })).toBeVisible();
  }
});

// Crowding: DEV Bukit Jalil TOC is moved to about 2 m from DEV Tanjung Malim Hut (no cluster), close enough to still
// overlap at max zoom, for the test, then put back.
type SiteEdit = { lat: number; lon: number };

async function moveSite(page: Page, siteId: number, place: SiteEdit) {
  const response = await page.request.post(`/api/admin/sites/${siteId}`, { data: { ...place, reason: "e2e crowd" } });
  expect([200, 400]).toContain(response.status());
}

test("crowded sites: a badge zooms in; at max zoom the crowd spreads into a named list reached by Tab", async ({ page }) => {
  await signIn(page, "admin1");
  const sites = await mapSites(page);
  const idOf = (name: string) => sites.features.find((site) => site.properties.name === name)!.properties.site_id;
  const tocId = idOf("DEV Bukit Jalil TOC");
  const original: SiteEdit = await (await page.request.get(`/api/admin/sites/${tocId}`)).json();
  const anchor: SiteEdit = await (await page.request.get(`/api/admin/sites/${idOf("DEV Tanjung Malim Hut")}`)).json();
  await moveSite(page, tocId, { lat: anchor.lat + 0.00002, lon: anchor.lon + 0.00001 });
  try {
    await page.reload();
    await mode(page);
    const badge = map(page).getByRole("button", { name: /^2 sites: .*DEV Bukit Jalil TOC/ });
    await expect(badge).toBeVisible();
    await expect(badge).toHaveText("2");
    // Each click zooms in 3 levels; only at max zoom is the crowd a stacked list instead of a badge.
    for (let click = 0; click < 6; click++) {
      if ((await badge.count()) === 0) {
        break;
      }
      await badge.click();
      await page.waitForTimeout(400); // the camera eases
    }
    await expect(badge).toHaveCount(0);
    const spread = map(page).locator("[data-testid=map-site].spread");
    await expect(spread).toHaveCount(2);
    const names = await spread.locator(".code").allTextContents();
    expect(names.sort()).toEqual(["DEV Bukit Jalil TOC", "DEV Tanjung Malim Hut"]);
    const first = spread.first();
    await first.focus();
    await page.keyboard.press("Tab");
    await expect(spread.nth(1)).toBeFocused();
    const box = (await first.boundingBox())!;
    const clip = { x: box.x - 80, y: box.y - 50, width: 360, height: 140 };
    await page.screenshot({ path: "e2e/screenshots/map-crowd-spread.png", clip });
  } finally {
    await moveSite(page, tocId, { lat: original.lat, lon: original.lon });
  }
});
