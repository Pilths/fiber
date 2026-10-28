import { expect, test, type Page } from "@playwright/test";
import { signIn } from "./helpers";

// B2 layout: the Inspector sits above Find at a fixed 420px, so Find never moves between states.
test.use({ viewport: { width: 1440, height: 900 } });
test.afterEach(({ page }) => page.unrouteAll({ behavior: "ignoreErrors" }));

const KLBJ = /^DEV Kuala Lumpur DC - DEV Bukit Jalil TOC/;
const inspector = (page: Page) => page.getByRole("region", { name: "Inspector" });

// Page-relative boxes (scroll-proof) of the Inspector and Find cards.
async function layout(page: Page) {
  return page.evaluate(() => {
    const box = (el: Element | null) => { const r = el!.getBoundingClientRect(); return { top: r.top + scrollY, bottom: r.bottom + scrollY, height: r.height }; };
    return { ins: box(document.querySelector('section[aria-label="Inspector"]')), find: box(document.getElementById("find-h")!.closest("section")) };
  });
}
async function footerInCard(page: Page, name: string) {
  const btn = inspector(page).getByRole("button", { name });
  await expect(btn).toBeVisible();
  const [b, c] = await Promise.all([btn.boundingBox(), inspector(page).boundingBox()]);
  expect(b!.y + b!.height).toBeLessThanOrEqual(c!.y + c!.height);
}

test("Inspector is 420px and Find starts at the same y: nothing, span, route and fiber cut", async ({ page }) => {
  await signIn(page, "admin1");
  const seen: { state: string; height: number; find: number }[] = [];
  const note = async (state: string) => {
    const l = await layout(page);
    seen.push({ state, height: l.ins.height, find: l.find.top });
    expect(l.find.top).toBeGreaterThan(l.ins.bottom); // Inspector first
  };

  await expect(inspector(page)).toContainText("No span selected");
  await note("nothing");

  await page.getByRole("list", { name: "Spans" }).getByRole("button", { name: KLBJ }).click();
  await expect(page.getByRole("grid", { name: "Cores" })).toBeVisible();
  await footerInCard(page, "Go to cores");
  await footerInCard(page, "Plan a route from here");
  await note("span");

  await page.getByRole("button", { name: "Plan a route from here" }).click();
  await page.getByLabel("To", { exact: true }).fill("DEV Cyberjaya DC");
  await page.getByTestId("route-option").first().click();
  await expect(page.getByTestId("route-summary")).toBeVisible();
  await footerInCard(page, "Go to route table and Reserve");
  await note("route");

  // Fiber cut and red loss, mocked so dev data never changes.
  await page.route(/\/api\/spans\/\d+$/, async (r) => r.fulfill({ json: { ...(await (await r.fetch()).json()), fiber_cut: true, free_to_reserve: 0 } }));
  await page.route(/\/api\/loss\/spans\/\d+$/, async (r) =>
    r.fulfill({ json: { ...(await (await r.fetch()).json()), status: "measured", level: "red", measured_db: 7.4, deviation_pct: 29.5 } }));
  await page.getByRole("radio", { name: "Span or site" }).check({ force: true });
  await page.getByRole("list", { name: "Spans" }).getByRole("button", { name: KLBJ }).click();
  await expect(inspector(page).getByTestId("fiber-cut")).toBeVisible();
  await footerInCard(page, "Go to cores");
  // The Loss row stays in view above the pinned footer; Allocations gives up lines instead.
  const [loss, foot] = await Promise.all([inspector(page).getByTestId("inspector-loss").boundingBox(), inspector(page).getByRole("button", { name: "Go to cores" }).boundingBox()]);
  expect(loss!.y + loss!.height).toBeLessThanOrEqual(foot!.y);
  await note("cut");

  for (const s of seen) expect(Math.abs(s.height - 420), `${s.state} height ${s.height}`).toBeLessThanOrEqual(1);
  for (const s of seen) expect(s.find, `${s.state} Find y`).toBe(seen[0].find);
});
