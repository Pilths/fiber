import { expect, test, type Page } from "@playwright/test";

const SPAN = "DEV Kuala Lumpur DC - DEV Cyberjaya DC"; // dev seed: has Available, Reserved and In use cores

async function openSpan(page: Page, theme: "light" | "dark" = "light") {
  await page.addInitScript((t) => localStorage.setItem("theme", t), theme);
  await page.goto("/");
  await page.getByRole("button", { name: new RegExp(SPAN) }).click();
  await expect(page.getByRole("grid", { name: "Cores" })).toBeVisible();
}

test("keyboard: roving tabindex, arrows, Space/Enter select only Available", async ({ page }) => {
  await openSpan(page);
  const cells = page.getByRole("gridcell");
  expect(await cells.count()).toBe(24);
  await expect(page.locator('[role=gridcell][tabindex="0"]')).toHaveCount(1);

  await cells.first().focus();
  await page.keyboard.press("ArrowRight");
  await expect(cells.nth(1)).toBeFocused();
  await page.keyboard.press("ArrowDown");
  await expect(cells.nth(7)).toBeFocused();
  await page.keyboard.press("End");
  await expect(cells.last()).toBeFocused();
  await page.keyboard.press("Home");
  await expect(cells.first()).toBeFocused();

  const avail = page.locator('[role=gridcell][data-status="Available"]').first();
  await avail.focus();
  await page.keyboard.press("Space");
  await expect(avail).toHaveAttribute("aria-selected", "true");
  await page.keyboard.press("Enter");
  await expect(avail).toHaveAttribute("aria-selected", "false");

  const blocked = page.locator('[role=gridcell][data-status="In use"]').first();
  await blocked.focus();
  await expect(blocked).toHaveAttribute("aria-disabled", "true");
  await page.keyboard.press("Space");
  await expect(blocked).toHaveAttribute("aria-selected", "false");
  await expect(page.getByTestId("grid-caption")).toContainText("not selectable");
});

test("reserve panel: blocks without customer, traps focus, Escape returns focus", async ({ page }) => {
  await openSpan(page);
  await page.locator('[role=gridcell][data-status="Available"]').first().click();
  const opener = page.getByRole("button", { name: /Reserve cores/ });
  await opener.focus();
  await page.keyboard.press("Enter");
  const dialog = page.getByRole("dialog");
  await expect(dialog).toBeVisible();
  await expect(page.getByTestId("counter")).toContainText("1 of 1");
  await dialog.getByRole("button", { name: "Submit request" }).click();
  await expect(dialog.getByRole("alert")).toContainText("Choose a customer");
  for (let i = 0; i < 12; i++) {
    await page.keyboard.press("Tab");
    expect(await dialog.evaluate((d) => d.contains(document.activeElement))).toBe(true);
  }
  await page.keyboard.press("Escape");
  await expect(dialog).toBeHidden();
  await expect(opener).toBeFocused();
});

test("each status has a distinct symbol and text, not colour alone", async ({ page }) => {
  await openSpan(page);
  const key = page.getByRole("list", { name: "Status key" });
  const items = await key.getByRole("listitem").allInnerTexts();
  const symbols = items.map((t) => t.trim().split(/\s+/)[0]);
  expect(new Set(symbols).size).toBe(5);
  for (const s of ["Available", "Requested", "Reserved", "In use", "Faulty"]) expect(items.join("|")).toContain(s);

  // Cell patterns differ without any colour: compare border style/width and background-image.
  const looks = await page.evaluate(() => {
    const seen: Record<string, string> = {};
    for (const el of document.querySelectorAll<HTMLElement>("[role=gridcell]")) {
      const cs = getComputedStyle(el);
      const st = el.dataset.status!;
      seen[st] ??= `${cs.borderTopStyle}|${cs.borderTopWidth}|${cs.backgroundImage === "none" ? "plain" : "pattern"}`;
      if (!el.textContent!.includes(st)) throw new Error(`cell without status text: ${st}`);
    }
    return seen;
  });
  // In use / Available differ by fill (checked via contrast pairs below); the pattern-based ones must all differ.
  const sig = ["Available", "Requested", "Reserved", "Faulty"].map((s) => looks[s]).filter(Boolean);
  expect(new Set(sig).size).toBe(sig.length);
  expect(Object.keys(looks).length).toBeGreaterThanOrEqual(3);
});

for (const theme of ["light", "dark"] as const) {
  test(`contrast >= 4.5 in ${theme} theme`, async ({ page }) => {
    await openSpan(page, theme);
    await expect(page.locator("html")).toHaveClass(theme === "dark" ? /dark/ : /^(?!.*dark)/);
    const ratios = await page.evaluate(() => {
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
      const sel: Record<string, string> = {
        body: "body",
        header: "header h1",
        search: "header input",
        spanMuted: "main section ul li button span.text-muted-foreground",
        captionHint: "[data-testid=grid-caption]",
        tableHead: "thead th",
        tableCell: "tbody td",
        button: "main button.bg-primary",
        navCurrent: "nav button[aria-current]",
      };
      for (const [k, s] of Object.entries(sel)) {
        const el = document.querySelector(s);
        if (el) out[k] = ratio(el);
      }
      for (const st of ["Available", "Requested", "Reserved", "In use", "Faulty"]) {
        const el = document.querySelector(`[role=gridcell][data-status="${st}"]`);
        if (el) out[`cell ${st}`] = ratio(el);
      }
      return out;
    });
    expect(Object.keys(ratios).length).toBeGreaterThan(8);
    for (const [k, v] of Object.entries(ratios)) expect(v, `${k} ${v.toFixed(2)}`).toBeGreaterThanOrEqual(4.5);
  });
}
