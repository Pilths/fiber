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
