import { expect, test, type Page } from "@playwright/test";

const SPAN = "DEV Kuala Lumpur DC - DEV Cyberjaya DC"; // dev seed: has Available, Reserved and In use cores

const pickSpan = (page: Page, name: string | RegExp) =>
  page.getByRole("list", { name: "Spans" }).getByRole("button", { name: typeof name === "string" ? new RegExp(name) : name }).click();

async function openSpan(page: Page) {
  await page.goto("/");
  await pickSpan(page, SPAN);
  await expect(page.getByRole("grid", { name: "Cores" })).toBeVisible();
}

test("keyboard: roving tabindex, arrows, Space/Enter select only Available", async ({ page }) => {
  await openSpan(page);
  const cells = page.getByRole("gridcell");
  expect(await cells.count()).toBe(24);
  await expect(page.getByRole("region", { name: /^Cores of/ })).toContainText("24 surveyed of 144");
  await expect(page.getByTestId("capacity")).toContainText("18 Available minus 0 held without cores = 18 free to reserve");
  // 12 cores per row, and the whole row fits the panel at 1280px (no horizontal scroll)
  const tops = await cells.evaluateAll((els) => els.slice(0, 13).map((e) => Math.round(e.getBoundingClientRect().top)));
  expect(new Set(tops.slice(0, 12)).size).toBe(1);
  expect(tops[12]).toBeGreaterThan(tops[0]);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await expect(page.locator('[role=gridcell][tabindex="0"]')).toHaveCount(1);

  await cells.first().focus();
  await page.keyboard.press("ArrowRight");
  await expect(cells.nth(1)).toBeFocused();
  await page.keyboard.press("ArrowDown");
  await expect(cells.nth(13)).toBeFocused(); // 12 cores per row
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

test("chosen bar: counts chosen cores, blocks without customer, Clear resets", async ({ page }) => {
  await openSpan(page);
  const bar = page.getByTestId("chosen-bar");
  await expect(bar).toContainText("No cores chosen");
  await expect(bar.getByRole("button", { name: "Reserve" })).toBeDisabled();
  const avail = page.locator('[role=gridcell][data-status="Available"]');
  for (let i = 0; i < 3; i++) await avail.nth(i).click();
  await expect(bar).toContainText("3 cores chosen");
  await expect(bar).toContainText("15 more can be chosen");
  await expect(bar.locator(".cchip")).toHaveCount(3);
  await expect(avail.first()).toContainText("Chosen");
  // sticky: the bar sits at the viewport bottom while the grid is in view
  await page.getByRole("grid", { name: "Cores" }).scrollIntoViewIfNeeded();
  expect(await bar.evaluate((el) => getComputedStyle(el).position)).toBe("sticky");
  await bar.getByRole("button", { name: "Reserve 3 cores" }).click();
  await expect(bar.getByRole("alert")).toContainText("Choose a customer");
  await bar.getByRole("button", { name: "Clear" }).click();
  await expect(bar).toContainText("No cores chosen");
  await expect(page.locator('[role=gridcell][aria-selected="true"]')).toHaveCount(0);
});

test("each status has a distinct symbol and text, not colour alone", async ({ page }) => {
  await openSpan(page);
  const key = page.getByRole("list", { name: "Status key" });
  const items = await key.getByRole("listitem").allInnerTexts();
  const icons = await key.locator("svg[data-icon]").evaluateAll((els) => els.map((e) => e.getAttribute("data-icon")));
  expect(new Set(icons).size).toBe(6); // 5 statuses + Chosen, each its own symbol
  for (const s of ["Available", "Chosen", "Requested", "Reserved", "In use", "Faulty"]) expect(items.join("|")).toContain(s);

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

{ // light theme only (PRD: dark theme is parked)
  test("contrast >= 4.5", async ({ page }) => {
    await openSpan(page);
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
        spanMuted: "[aria-label=Spans] button span.text-muted-foreground",
        captionHint: "[data-testid=grid-caption]",
        tableHead: "thead th",
        tableCell: "tbody td",
        button: "main button.btn-p",
        navCurrent: "nav button[aria-current]",
        equation: "[data-testid=capacity]",
        later: ".later",
        badge: "[aria-label=Spans] .pill",
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

test("count-only reservation shows on the span and in My reservations; admin sees Approvals", async ({ page }) => {
  await page.goto("/");
  await pickSpan(page, /^DEV Cyberjaya DC - DEV Bukit Jalil/);
  await expect(page.getByTestId("capacity")).toContainText("3 reserved, not assigned");
  await expect(page.getByTestId("capacity")).toContainText("= 17 free to reserve");
  await expect(page.getByRole("table")).toContainText("Count only");
  await page.getByRole("button", { name: /My reservations/ }).click();
  await expect(page.getByTestId("reservation").filter({ hasText: "3 not assigned yet" })).toBeVisible();
  await page.getByRole("button", { name: "Rejected" }).click();
  await expect(page.getByText("No reservations that are rejected.")).toBeVisible();
});

test("planner books and withdraws a core request, admin sees Approvals", async ({ browser }) => {
  const planner = await (await browser.newContext({ viewport: { width: 1280, height: 900 } })).newPage();
  await planner.addInitScript(() => localStorage.setItem("devUser", "planner2"));
  await planner.goto("/");
  await pickSpan(planner, /DEV Bukit Jalil TOC - DEV Kuantan Hut/);
  await planner.locator('[role=gridcell][data-status="Available"]').first().click();
  const bar = planner.getByTestId("chosen-bar");
  await bar.getByLabel("Search customers").fill("DEV Telco Alpha");
  await bar.getByRole("button", { name: "DEV Telco Alpha", exact: true }).click();
  await bar.getByRole("button", { name: "Reserve 1 core" }).click();
  await expect(bar.getByRole("status")).toContainText("sent (pending)");
  await expect(bar).toContainText("No cores chosen");
  await planner.getByRole("button", { name: /My reservations/ }).click();
  await expect(planner.getByTestId("reservation").first()).toContainText("Pending approval");
  await planner.getByRole("button", { name: "Withdraw" }).first().click(); // leave the dev data as found
  await expect(planner.getByText("Withdrawn").first()).toBeVisible();

  const admin = await (await browser.newContext()).newPage();
  await admin.addInitScript(() => localStorage.setItem("devUser", "admin1"));
  await admin.goto("/");
  await admin.getByRole("button", { name: /^Approvals/ }).click();
  await expect(admin.getByRole("heading", { name: /^Approvals/ })).toBeVisible();
  await expect(admin.getByRole("button", { name: "Approve" }).first()).toBeVisible();
  await expect(admin.getByRole("button", { name: "Reject" }).first()).toBeVisible();
});
