import { expect, type Page } from "@playwright/test";

export const DEV_PASSWORD = process.env.DEV_PASSWORD ?? "dev-password-123";

// Signs in through the login form; the session cookie then decides who the user is.
export async function signIn(page: Page, username = "planner1", password = DEV_PASSWORD) {
  await page.goto("/");
  await page.getByLabel("Username").fill(username);
  await page.getByLabel("Password", { exact: true }).fill(password);
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page.getByRole("navigation", { name: "Main" })).toBeVisible();
}

// WCAG contrast ratio of each selector's first match (text colour against the nearest opaque background).
export function contrast(page: Page, sel: Record<string, string>) {
  return page.evaluate((sel) => {
    const ctx = document.createElement("canvas").getContext("2d", { willReadFrequently: true })!;
    const rgba = (c: string) => {
      ctx.clearRect(0, 0, 1, 1);
      ctx.fillStyle = "#000";
      ctx.fillStyle = c;
      ctx.fillRect(0, 0, 1, 1);
      return Array.from(ctx.getImageData(0, 0, 1, 1).data);
    };
    const lum = ([r, g, b]: number[]) => {
      const f = (v: number) => ((v /= 255) <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4);
      return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
    };
    const bgOf = (el: Element) => {
      for (let e: Element | null = el; e; e = e.parentElement) {
        const c = rgba(getComputedStyle(e).backgroundColor);
        if (c[3] === 255) return c;
      }
      return rgba("#fff");
    };
    const ratio = (el: Element) => {
      const a = lum(rgba(getComputedStyle(el).color));
      const b = lum(bgOf(el));
      return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
    };
    const out: Record<string, number> = {};
    for (const [k, s] of Object.entries(sel)) {
      const el = document.querySelector(s);
      if (el) out[k] = ratio(el);
    }
    return out;
  }, sel);
}

// Main nav tabs, found inside the nav.
export const tab = (page: Page, name: "Inventory" | "My reservations") =>
  page.getByRole("navigation", { name: "Main" }).getByRole("button", { name, exact: true }).click();

// Inventory: select the segment through its #segment= link (the header search and the map are the UI ways in).
export async function pickSegment(page: Page, name: RegExp | string) {
  await tab(page, "Inventory");
  const re = typeof name === "string" ? new RegExp(name) : name;
  const segs: { site_a: string; site_b: string }[] = await (await page.request.get("/api/segments")).json();
  const full = segs.map((s) => `${s.site_a} - ${s.site_b}`).find((n) => re.test(n));
  expect(full, `segment ${name}`).toBeTruthy();
  await page.evaluate((h) => { location.hash = h; }, `#segment=${encodeURIComponent(full!)}`);
  await expect(page.locator("#segment-h")).toHaveText(name);
}

// Reserving goes through Route A to B: find A to B, choose the one-segment option (the direct segment), "Reserve on
// this route", then select that single segment in the box diagram. Returns the box, its Available cores list showing.
export async function openReserve(page: Page, a: string, b: string, cores = 1) {
  await tab(page, "Inventory");
  const s = page.getByRole("region", { name: "Route A to B" });
  await s.getByLabel("Route A").fill(a);
  await s.getByLabel("Route B").fill(b);
  await s.getByLabel("Cores needed").fill(String(cores));
  await s.getByRole("button", { name: "Find route" }).click();
  await page.getByRole("list", { name: "Route options" }).getByRole("button", { name: /^Option \d+ (Best match )?1 segment,/ }).click();
  await page.getByTestId("segment-actions").getByRole("button", { name: "Reserve on this route" }).click();
  const box = page.getByTestId("reserve-box");
  await expect(box).toBeVisible();
  const legs = box.getByTestId("route-chain").getByRole("button");
  await expect(legs).toHaveCount(1);
  await legs.first().click();
  await expect(box.getByRole("table", { name: "Available cores" })).toBeVisible();
  return box;
}

// Cores table: opens a core's details, first opening collapsed status groups and the collapsed run ("10-12") that holds it.
export async function openCore(page: Page, n: number) {
  const t = page.getByRole("table", { name: /^Cores of / });
  await t.locator("tbody tr").first().waitFor();
  const shut = t.locator("th[scope=rowgroup] button[aria-expanded=false]");
  while (await shut.count()) await shut.first().click();
  const one = t.getByRole("button", { name: `Core ${n} details`, exact: true });
  await one.click();
}
