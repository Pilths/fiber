import { expect, test, type Page } from "@playwright/test";
import { pickSpan, signIn, tab } from "./helpers";

// On the Map page the Inspector fills the height of the map card beside it (Find lives on the Reserve tab).
test.use({ viewport: { width: 1440, height: 900 } });
test.afterEach(({ page }) => page.unrouteAll({ behavior: "ignoreErrors" }));

const KLBJ = /^DEV Kuala Lumpur DC - DEV Bukit Jalil TOC/;
const inspector = (page: Page) => page.getByRole("region", { name: "Inspector" });

async function footerInCard(page: Page, name: string) {
  const btn = inspector(page).getByRole("button", { name });
  await expect(btn).toBeVisible();
  const [b, c] = await Promise.all([btn.boundingBox(), inspector(page).boundingBox()]);
  expect(b!.y + b!.height).toBeLessThanOrEqual(c!.y + c!.height);
}

test("Inspector is as tall as the map card: nothing, span, route searched and fiber cut", async ({ page }) => {
  await signIn(page, "admin1");
  const map = page.getByRole("region", { name: "Network map" }).first();
  // Polled: the map card can grow a line (spans without coordinates) a frame after the selection.
  const note = (state: string) => expect.poll(async () => Math.abs((await inspector(page).boundingBox())!.height - (await map.boundingBox())!.height), { message: `${state}: Inspector height minus map height` }).toBeLessThanOrEqual(1);

  await expect(inspector(page)).toContainText("No span selected");
  await note("nothing");

  await pickSpan(page, KLBJ);
  await footerInCard(page, "Go to cores");
  await note("span");

  const search = page.getByRole("region", { name: "Route search" });
  await search.getByLabel("Route A").fill("DEV Cyberjaya DC");
  await search.getByLabel("Route B").fill("DEV Kuantan Hut");
  await search.getByRole("button", { name: "Search" }).click();
  await expect(page.getByTestId("span-diagram").getByRole("list", { name: "Spans on the route" })).toBeVisible();
  await expect(inspector(page).getByText("Spans on route")).toHaveCount(0);
  await footerInCard(page, "Go to cores");
  await note("route");

  // Fiber cut and red loss, mocked so dev data never changes.
  await page.route(/\/api\/spans\/\d+$/, async (r) => r.fulfill({ json: { ...(await (await r.fetch()).json()), fiber_cut: true, free_to_reserve: 0 } }));
  await page.route(/\/api\/loss\/spans\/\d+$/, async (r) =>
    r.fulfill({ json: { ...(await (await r.fetch()).json()), status: "measured", level: "red", measured_db: 7.4, deviation_pct: 29.5 } }));
  await pickSpan(page, KLBJ);
  await expect(inspector(page).getByTestId("fiber-cut")).toBeVisible();
  await footerInCard(page, "Go to cores");
  // The worst-core row stays in view above the pinned footer.
  const [loss, foot] = await Promise.all([inspector(page).getByTestId("inspector-loss").boundingBox(), inspector(page).getByRole("button", { name: "Go to cores" }).boundingBox()]);
  expect(loss!.y + loss!.height).toBeLessThanOrEqual(foot!.y);
  await note("cut");

});

// The Inspector title's first line shares one band with the map toolbar: cap-height centre within 4px of the button centre.
async function titleVsToolbar(page: Page) {
  return page.evaluate(() => {
    const t = document.querySelector('section[aria-label="Inspector"] h3')!, cs = getComputedStyle(t);
    const ctx = document.createElement("canvas").getContext("2d")!;
    ctx.font = `${cs.fontWeight} ${cs.fontSize} ${cs.fontFamily}`;
    const m = ctx.measureText("H"), lh = parseFloat(cs.lineHeight);
    const base = (lh - m.fontBoundingBoxAscent - m.fontBoundingBoxDescent) / 2 + m.fontBoundingBoxAscent;
    const cap = t.getBoundingClientRect().top + base - m.actualBoundingBoxAscent / 2;
    const b = [...document.querySelectorAll("button")].find((x) => x.textContent === "Layers")!.getBoundingClientRect();
    return { cap, button: b.top + b.height / 2, lines: Math.round(t.getBoundingClientRect().height / lh) };
  });
}

test("Inspector title lines up with the map toolbar: short and long title, span and route", async ({ page }) => {
  await signIn(page, "admin1");
  await pickSpan(page, KLBJ);
  await expect(inspector(page)).toContainText("Edit span");
  const long = await titleVsToolbar(page);
  expect(long.lines).toBe(2);
  expect(Math.abs(long.cap - long.button), JSON.stringify(long)).toBeLessThanOrEqual(4);

  await page.route(/\/api\/spans\/\d+$/, async (r) => r.fulfill({ json: { ...(await (await r.fetch()).json()), site_a: "KLDC", site_b: "BJTC" } }));
  await tab(page, "Reserve");
  await page.getByRole("list", { name: "Spans" }).getByRole("button", { name: /DEV Ipoh Exchange - DEV Penang Tower/ }).click();
  await tab(page, "Map");
  await expect(inspector(page).getByRole("heading")).toHaveText("KLDC - BJTC");
  const short = await titleVsToolbar(page);
  expect(Math.abs(short.cap - short.button), JSON.stringify(short)).toBeLessThanOrEqual(4);
  test.info().annotations.push({ type: "alignment", description: JSON.stringify({ long, short }) });
});
