import { expect, test, type Page } from "@playwright/test";
import { signIn } from "./helpers";

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
  await expect(chip(page, FAR)).toContainText(/\d+/);
  await expect(page.getByTestId("map-not-drawn")).toContainText("2 spans not on the map (no coordinates)");
  await expect(page.getByText("Basemap: self-hosted tiles")).toBeVisible();
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
  await expect(page.getByRole("heading", { name: `Cores of ${FAR}` })).toBeVisible();
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
  await expect(page.getByRole("heading", { name: `Cores of ${other}` })).toBeVisible();
  await chip(page, other).focus();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("heading", { name: /^Cores of/ })).toHaveCount(0);
  await expect(map(page).locator('[data-testid=map-line][data-selected=true]')).toHaveCount(0);
  expect(page.url()).not.toContain("#span=");
});

test("a site click lists its spans in Find", async ({ page }) => {
  await signIn(page);
  await map(page).getByRole("button", { name: /^Site DEV Penang Tower,/ }).click();
  await expect(page.getByLabel("Span or site name")).toHaveValue("DEV Penang Tower");
  await expect(page.getByRole("list", { name: "Spans" }).getByRole("button")).toHaveCount(1);
});

test("Find filters dim the other spans on the map", async ({ page }) => {
  await signIn(page);
  await page.getByLabel("Route type").selectOption("Trunk");
  await expect(chips(page)).toHaveCount(2);
  await expect(map(page).locator("[data-testid=map-line][data-state=hidden]")).toHaveCount(3);
  await page.getByLabel("Route type").selectOption("");
  await page.getByLabel("Region").selectOption("North");
  await expect(chips(page)).toHaveCount(2);
  await page.getByLabel("Region").selectOption("");
  await expect(chips(page)).toHaveCount(5);
});

test("a route highlights its spans in blue, the shaped KL-CJ-BJ curve included", async ({ page }) => {
  await signIn(page);
  await page.getByRole("radio", { name: "Route A to B" }).check({ force: true });
  await page.getByLabel("From", { exact: true }).fill("DEV Kuala Lumpur DC");
  await page.getByLabel("To", { exact: true }).fill("DEV Bukit Jalil TOC");
  await page.getByLabel("Cores needed per span").fill("1");
  const opts = page.getByRole("list", { name: "Route options" }).getByTestId("route-option");
  await expect(opts.first()).toBeVisible();
  await opts.filter({ hasText: "2 spans" }).first().click();
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
  await page.getByLabel("Span or site name").fill("Penang");
  await expect(page.getByRole("list", { name: "Spans" }).getByRole("button")).toHaveCount(1);
});

test("no WebGL: the SVG fallback draws spans and selects by click", async ({ page }) => {
  await noWebGL(page);
  const outside = await offline(page);
  await signIn(page);
  await expect(map(page)).toHaveAttribute("data-mode", "svg");
  await expect(page.getByTestId("map-note")).toContainText("no WebGL");
  await expect(chips(page)).toHaveCount(5);
  await chip(page, FAR).click();
  await expect(page.getByRole("heading", { name: `Cores of ${FAR}` })).toBeVisible();
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
test("map card fills its row and the stage fills the card: nothing, span and route selected", async ({ page }) => {
  await signIn(page);
  await expect(chips(page)).toHaveCount(5);
  const gaps = () => page.evaluate(() => {
    const card = document.querySelector("section[aria-labelledby=map-h]")!;
    const body = card.lastElementChild!; // NetworkMap root: stage, then the note line and "not on the map"
    const pad = parseFloat(getComputedStyle(card).paddingBottom);
    const right = (card.nextElementSibling as HTMLElement).getBoundingClientRect();
    return { underCard: Math.round(right.bottom - card.getBoundingClientRect().bottom), inCard: Math.round(card.getBoundingClientRect().bottom - pad - body.lastElementChild!.getBoundingClientRect().bottom) };
  });
  // Within a few px: the last line's box rounds to a pixel or two.
  const check = async () => expect.poll(async () => { const g = await gaps(); return Math.abs(g.underCard) <= 3 && Math.abs(g.inCard) <= 3; }).toBe(true);
  await check();
  await chip(page, FAR).click();
  await expect(page.getByRole("heading", { name: `Cores of ${FAR}` })).toBeVisible();
  await check();
  await page.evaluate(() => scrollTo(0, 0));
  await settle(page);
  await page.screenshot({ path: "e2e/screenshots/map-layout-fixed.png" });
  await page.getByRole("radio", { name: "Route A to B" }).check({ force: true });
  await page.getByLabel("From", { exact: true }).fill("DEV Kuala Lumpur DC");
  await page.getByLabel("To", { exact: true }).fill("DEV Bukit Jalil TOC");
  await page.getByLabel("Cores needed per span").fill("1");
  await page.getByRole("list", { name: "Route options" }).getByTestId("route-option").first().click();
  await expect(map(page).locator("[data-testid=map-line][data-selected=true]").first()).toBeVisible();
  await check();
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
