import { expect, test } from "@playwright/test";
import { openReserve, signIn } from "./helpers";

// Dev seed: Cyberjaya DC to Kuantan Hut has several paths; the search shows the best one.
test.use({ viewport: { width: 1440, height: 900 } });

test("route search, pick a segment in the diagram: totals, one Cores table grouped by status, one row per core and core details", async ({ page }) => {
  // The option with the most segments first, so the diagram shows a long chain.
  await page.route("**/api/routes?*", async (r) => {
    const j = (await (await r.fetch()).json()) as { options: { segments: unknown[] }[] };
    r.fulfill({ json: { ...j, options: j.options.toSorted((x, y) => y.segments.length - x.segments.length) } });
  });
  await signIn(page);
  await expect(page.getByRole("region", { name: "Inspector" })).toHaveCount(0);
  const search = page.getByRole("region", { name: "Route A to B" });
  await search.getByLabel("Route A").fill("DEV Cyberjaya DC");
  await search.getByLabel("Route B").fill("DEV Kuantan Hut");
  await search.getByRole("button", { name: "Find route" }).click();
  await expect(page.locator("[data-testid=route-option][aria-pressed=true]")).toContainText(/\d+ segments?, [\d.]+\+? km/);

  const diagram = page.getByTestId("segment-diagram");
  const segs = diagram.getByRole("list", { name: "Segments on the route" }).getByRole("button");
  await expect(segs.first()).toHaveAttribute("aria-pressed", "true");
  const n = await segs.count();
  await expect(diagram.getByTestId("route-totals")).toHaveText(new RegExp(`^Segments${n}Distance[\\d.]+ km$`));
  await expect(diagram).not.toContainText("No distance");

  const last = segs.filter({ hasText: /\d km/ }).last(); // a segment with a distance, so it has a calculated loss
  const name = (await last.getAttribute("aria-label"))!.replace(/^Segment /, "");
  await last.click();
  await expect(last).toHaveAttribute("aria-pressed", "true");
  await expect(page.locator("#segment-h")).toHaveText(name);
  await expect(page.locator("body")).not.toContainText("Worst core");

  // One Cores table: groups by status with counts in their headers, holders first, Available collapsed.
  const table = page.getByRole("table", { name: `Cores of ${name}` });
  await expect(table.locator("thead")).toHaveCount(0); // column labels sit inside each group, no Status column
  await expect(table.locator('tbody:not([data-status="Available"]) tr.colhead').first().getByRole("columnheader"))
    .toHaveText(["Cores", "Customer", "Planner", "SRF", "Planned", "Age", "Ports"]);
  await expect(page.getByRole("group", { name: "Filter cores" })).toHaveCount(0); // no chips
  const groups = table.getByTestId("core-group");
  const order = ["Requested", "Reserved", "In use", "Unassigned", "Available"];
  const shown = await groups.evaluateAll((gs) => gs.map((g) => g.getAttribute("data-status")!));
  expect(shown).toEqual(order.filter((s) => shown.includes(s))); // holders first, Available last
  const heads = groups.getByRole("rowheader").filter({ has: page.getByRole("button", { expanded: true }) });
  await expect(heads.first()).toHaveText(/^\S\s*(Requested|Reserved|In service|Unassigned)\s*\d+( cores?)?$/);
  const avail = table.locator('tbody[data-status="Available"]');
  if (await avail.count()) {
    const toggle = avail.getByRole("button", { expanded: false });
    await expect(avail.locator("tr")).toHaveCount(1); // starts collapsed: only its header row
    await toggle.click();
    await expect(avail.getByRole("button", { name: /^Available \d+$/ })).toHaveAttribute("aria-expanded", "true");
    await expect(avail.locator("tr.colhead").getByRole("columnheader")).toHaveText(["Cores", "Ports"]);
    await expect(avail.locator("tr[data-core] > td[colspan='5']").filter({ hasText: /\S/ })).toHaveCount(0); // free cores: no holder columns
  }
  await expect(table).not.toContainText("None"); // empty cells show "-"

  // One row per core (no ranges); a row click opens core details.
  await expect(table.getByRole("button", { name: /show each core/ })).toHaveCount(0);
  const nums = await table.locator("tr[data-core]").evaluateAll((rs) => rs.map((r) => r.getAttribute("data-core")));
  expect(nums.every((x) => /^\d+$/.test(x ?? ""))).toBe(true);
  await table.locator("tbody > tr[data-core]").first().click();
  await expect(page.getByRole("dialog", { name: /^Core \d+ on / })).toBeVisible();
  await page.keyboard.press("Escape");
  await page.evaluate(() => scrollTo(0, 0)); // the sticky header stays at the top of the full-page shot
  await page.screenshot({ path: "e2e/screenshots/network-detail.png", fullPage: true });
});

test("Reserve on this route (Route A to B) opens the Reserve box over Inventory", async ({ page }) => {
  await signIn(page);
  const box = await openReserve(page, "DEV Kuala Lumpur DC", "DEV Cyberjaya DC");
  await expect(page.getByTestId("segment-diagram")).toBeAttached(); // Inventory stays behind the box
  await expect(page.getByRole("grid", { name: "Cores" })).toHaveCount(0); // no core grid any more
  await expect(box.getByRole("table", { name: "Available cores" })).toBeVisible();
});
