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
export function contrast(page: Page, selectors: Record<string, string>) {
  return page.evaluate((selectors) => {
    const context = document.createElement("canvas").getContext("2d", { willReadFrequently: true })!;
    const rgba = (colour: string) => {
      context.clearRect(0, 0, 1, 1);
      context.fillStyle = "#000";
      context.fillStyle = colour;
      context.fillRect(0, 0, 1, 1);
      return Array.from(context.getImageData(0, 0, 1, 1).data);
    };
    const channel = (value: number) => {
      const fraction = value / 255;
      if (fraction <= 0.03928) {
        return fraction / 12.92;
      }
      return ((fraction + 0.055) / 1.055) ** 2.4;
    };
    const luminance = ([red, green, blue]: number[]) =>
      0.2126 * channel(red) + 0.7152 * channel(green) + 0.0722 * channel(blue);
    const backgroundOf = (element: Element) => {
      for (let current: Element | null = element; current; current = current.parentElement) {
        const colour = rgba(getComputedStyle(current).backgroundColor);
        if (colour[3] === 255) {
          return colour;
        }
      }
      return rgba("#fff");
    };
    const ratio = (element: Element) => {
      const text = luminance(rgba(getComputedStyle(element).color));
      const background = luminance(backgroundOf(element));
      return (Math.max(text, background) + 0.05) / (Math.min(text, background) + 0.05);
    };
    const ratios: Record<string, number> = {};
    for (const [name, selector] of Object.entries(selectors)) {
      const element = document.querySelector(selector);
      if (element) {
        ratios[name] = ratio(element);
      }
    }
    return ratios;
  }, selectors);
}

// Main nav tabs, found inside the nav.
export const tab = (page: Page, name: "Inventory" | "My reservations") =>
  page.getByRole("navigation", { name: "Main" }).getByRole("button", { name, exact: true }).click();

// Inventory: select the segment through its #segment= link (the header search and the map are the UI ways in).
export async function pickSegment(page: Page, name: RegExp | string) {
  await tab(page, "Inventory");
  const pattern = typeof name === "string" ? new RegExp(name) : name;
  const response = await page.request.get("/api/segments");
  const segments: { site_a: string; site_b: string }[] = await response.json();
  const names = segments.map((segment) => `${segment.site_a} - ${segment.site_b}`);
  const full = names.find((each) => pattern.test(each));
  expect(full, `segment ${name}`).toBeTruthy();
  await page.evaluate((hash) => {
    location.hash = hash;
  }, `#segment=${encodeURIComponent(full!)}`);
  await expect(page.locator("#segment-h")).toHaveText(name);
}

// Reserving goes through Site A to B: find A to B, choose the one-segment option (the direct segment), "Reserve on
// this route", then select that single segment in the box diagram. Returns the box, its Available cores list showing.
export async function openReserve(page: Page, a: string, b: string, cores = 1) {
  await tab(page, "Inventory");
  const search = page.getByRole("region", { name: "Site A to B" });
  await search.getByLabel("Site A").fill(a);
  await search.getByLabel("Site B").fill(b);
  await search.getByLabel("Cores needed").fill(String(cores));
  await search.getByRole("button", { name: "Find route" }).click();
  const options = page.getByRole("list", { name: "Route options" });
  await options.getByRole("button", { name: /^Option \d+ (Best match )?1 segment,/ }).click();
  await page.getByTestId("segment-actions").getByRole("button", { name: "Reserve on this route" }).click();
  const box = page.getByTestId("reserve-box");
  await expect(box).toBeVisible();
  const legs = box.getByTestId("route-chain").getByRole("button");
  await expect(legs).toHaveCount(1);
  await legs.first().click();
  await expect(box.getByRole("table", { name: "Available cores" })).toBeVisible();
  return box;
}

// Cores table: opens a core's details, first opening collapsed status groups and the collapsed run ("10-12")
// that holds it.
export async function openCore(page: Page, number: number) {
  const table = page.getByRole("table", { name: /^Cores of / });
  await table.locator("tbody tr").first().waitFor();
  const shut = table.locator("th[scope=rowgroup] button[aria-expanded=false]");
  while (await shut.count()) {
    await shut.first().click();
  }
  const one = table.getByRole("button", { name: `Core ${number} details`, exact: true });
  await one.click();
}
