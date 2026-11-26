import { expect, test, type Locator, type Page } from "@playwright/test";
import { buildPortLabel, parsePortLabel, portLines, type PortKind } from "../src/lib/portLabel";
import { openCore, pickSegment, signIn } from "./helpers";

// Session 8: core detail drawer, admin edits (TEST-011) and reservation history (TEST-021).
// Every edit here is reversed in the same test; nothing is deleted, so the history rows stay.
const KLCJ = /^DEV Kuala Lumpur DC - DEV Cyberjaya DC/; // core 1 Reserved by planner1 (approved)
const KLBJ = /^DEV Kuala Lumpur DC - DEV Bukit Jalil TOC/; // cores 20 and 21 are free
const CJBJ = /^DEV Cyberjaya DC - DEV Bukit Jalil TOC/; // distance 18.2 km, changed and reverted

test.use({ viewport: { width: 1440, height: 900 } });

// Inventory: the segment list, the segment diagram (admin edits) and the Cores table (a row opens core details).
const pick = (page: Page, name: RegExp) => pickSegment(page, name);
const drawer = (page: Page) => page.getByRole("dialog", { name: /^Core \d+ on / });
const coreBtn = (page: Page, n: number) => page.getByRole("button", { name: `Core ${n} details`, exact: true });
const editSegment = (page: Page) => page.getByTestId("segment-actions").getByRole("button", { name: "Edit segment" });
const coresTable = (page: Page) => page.getByRole("table", { name: /^Cores of / });

test("core drawer: opens from a taken core with history, no Keep while not stale, Esc returns focus", async ({ page }) => {
  await signIn(page, "planner1");
  await pick(page, KLCJ);
  await openCore(page, 1);
  const d = drawer(page);
  await expect(d).toBeVisible();
  await expect(d.getByRole("heading", { level: 2 })).toHaveText("Core 1 on DEV Kuala Lumpur DC - DEV Cyberjaya DC");
  await expect(d.getByTestId("core-status")).toContainText("Reserved");
  await expect(d).toContainText("DEV Telco Alpha");
  const hist = d.getByRole("list", { name: "Core history, newest first" });
  await expect(hist).toContainText("Requested by DEV planner1");
  await expect(hist).toContainText("Approved by DEV admin1");
  await expect(hist.getByRole("listitem").last()).toContainText("Requested by");
  await expect(d.getByRole("button", { name: "Request release of core 1" })).toBeVisible();
  await expect(d.getByRole("button", { name: /^Mark / })).toHaveCount(0); // planners cannot edit status
  await expect(d.getByRole("button", { name: "Keep" })).toHaveCount(0);
  await page.screenshot({ path: "e2e/screenshots/core-drawer.png" });
  await page.keyboard.press("Escape");
  await expect(d).toBeHidden();
  await expect(coreBtn(page, 1)).toBeFocused();
});

test("planner sees no Keep on others' cores and no edit buttons", async ({ page }) => {
  await signIn(page, "planner2");
  await pick(page, KLCJ);
  await openCore(page, 1);
  const d = drawer(page);
  await expect(d).toContainText("DEV Telco Alpha");
  await expect(d.getByText(/^DEV planner1, reservation #\d+$/)).toBeVisible(); // Reserved by: from GET /api/cores/{id}
  await expect(d).toContainText("No events on this core that you can see"); // another planner's reservation
  await expect(d.getByRole("button", { name: "Keep" })).toHaveCount(0);
  await expect(d.getByRole("button", { name: /Request release/ })).toHaveCount(0);
  await d.getByRole("button", { name: "Close core detail" }).click();
  await expect(page.getByRole("button", { name: "Edit segment" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: /^Edit site/ })).toHaveCount(0);
});

test("taken-cores table tags stale cores", async ({ page }) => {
  await signIn(page, "admin1");
  type Reservation = { stale: boolean; cores: { core_id: number; held: boolean }[] };
  const reservations: Reservation[] = await (await page.request.get("/api/reservations")).json();
  const core = reservations
    .filter((reservation) => reservation.stale)
    .flatMap((reservation) => reservation.cores)
    .find((each) => each.held);
  test.skip(!core, "Dev data has no stale reservation holding a core; not faking one by changing server data.");
  const coreResponse = await page.request.get(`/api/cores/${core!.core_id}`);
  const coreDetail: { number: number; segment_name: string } = await coreResponse.json();
  await pick(page, new RegExp(`^${coreDetail.segment_name}`));
  await openCore(page, coreDetail.number);
  await page.keyboard.press("Escape");
  const row = coresTable(page).getByRole("row").filter({ has: coreBtn(page, coreDetail.number) });
  await expect(row).toContainText(/Stale: no keep for over 3 months since /);
});

test("admin edits segment distance with remarks; the diagram follows; then reverts", async ({ page }) => {
  await signIn(page, "admin1");
  await pick(page, CJBJ);
  const km = page.getByTestId("segment-diagram").getByRole("button", { name: /^Segment / });
  await expect(km).toContainText("18.2 km");

  const edit = async (value: string) => {
    await editSegment(page).click();
    const dlg = page.getByRole("dialog", { name: /^Edit segment/ });
    await dlg.getByLabel("Distance (km)").fill(value);
    return dlg;
  };
  let dlg = await edit("18.3");
  await dlg.getByText(/^History/).click();
  await page.screenshot({ path: "e2e/screenshots/edit-segment.png" });
  await dlg.getByRole("button", { name: "Save" }).click();
  await expect(dlg).toBeHidden();
  await expect(km).toContainText("18.3 km");

  dlg = await edit("18.2");
  await dlg.getByRole("button", { name: "Save" }).click();
  await expect(dlg).toBeHidden();
  await expect(km).toContainText("18.2 km");
  await editSegment(page).click();
  await page.getByRole("dialog", { name: /^Edit segment/ }).getByText(/^History/).click();
  await expect(page.getByTestId("edit-history").getByRole("listitem").first()).toContainText("Distance (km): 18.3");
});

test("lowering the verified core count below taken cores is refused in plain words", async ({ page }) => {
  await signIn(page, "admin1");
  await pick(page, KLCJ);
  await editSegment(page).click();
  const dlg = page.getByRole("dialog", { name: /^Edit segment/ });
  await dlg.getByLabel("Registered cores").fill("1");
  await dlg.getByRole("button", { name: "Save" }).click();
  await expect(dlg.getByRole("alert"))
    .toContainText(/^Cores 2, .* are allocated or have history and cannot be removed/);
  await dlg.getByRole("button", { name: "Cancel" }).click();
  const n = await coresTable(page).getByTestId("core-group").evaluateAll((groups) => {
    const statusGroups = groups.filter((group) => group.getAttribute("data-status") !== "Unassigned");
    const counts = statusGroups.map((group) => {
      const heading = group.querySelector("th[scope=rowgroup]")!.textContent!;
      return Number(/(\d+)\s*$/.exec(heading)![1]);
    });
    return counts.reduce((total, count) => total + count, 0);
  });
  expect(n).toBe(24); // verified core count unchanged: the group counts add up to 24 cores
});

const PORT_FIELDS = { FDF: ["FDF ID", "Mod", "Tray", "Port"], ODF: ["ODF ID", "Port"] };

// The label an end of the ports dialog holds now ("" for No port).
async function readEnd(dialog: Locator, end: string): Promise<string> {
  const kind = await dialog.getByLabel(`${end} type`).inputValue();
  if (kind === "") {
    return "";
  }
  const values: string[] = [];
  for (const field of PORT_FIELDS[kind as PortKind]) {
    values.push(await dialog.getByLabel(`${end} ${field}`).inputValue());
  }
  return buildPortLabel({ kind: kind as PortKind, values }) ?? "";
}

// Picks the type and types the parts of a canonical label; "" chooses No port.
async function fillEnd(dialog: Locator, end: string, label: string) {
  const parts = parsePortLabel(label);
  if (parts == null) {
    await dialog.getByLabel(`${end} type`).selectOption("");
    return;
  }
  await dialog.getByLabel(`${end} type`).selectOption(parts.kind);
  const fields = PORT_FIELDS[parts.kind];
  for (let i = 0; i < fields.length; i++) {
    await dialog.getByLabel(`${end} ${fields[i]}`).fill(parts.values[i]);
  }
}

// Sets the port at the site A end of core n in core details; returns the port it had.
async function setFirstPort(page: Page, n: number, value: string): Promise<string> {
  await openCore(page, n);
  const d = drawer(page);
  await d.getByRole("button", { name: /^(Edit|Add) ports$/ }).click();
  const ports = page.getByRole("dialog", { name: `Ports of core ${n}` });
  const old = await readEnd(ports, "Site A end");
  await fillEnd(ports, "Site A end", value);
  await ports.getByRole("button", { name: "Save" }).click();
  await expect(ports).toBeHidden();
  await d.getByRole("button", { name: "Close core detail" }).click();
  return old;
}

const PASTE_BOX = "DEV Kuala Lumpur DC end";

async function openPastePorts(page: Page): Promise<Locator> {
  await editSegment(page).click();
  const edit = page.getByRole("dialog", { name: /^Edit segment/ });
  await edit.getByRole("button", { name: "Paste ports" }).click();
  return page.getByRole("dialog", { name: /^Paste ports/ });
}

test("port labels: build, parse and pasted Excel cells", () => {
  expect(buildPortLabel({ kind: "FDF", values: ["1", "02", "3", "5"] })).toBe("FDF1-MOD2-T3-P5");
  expect(buildPortLabel({ kind: "ODF", values: ["20", "5"] })).toBe("ODF20-P5");
  expect(buildPortLabel({ kind: "FDF", values: ["a", "b", "c", "012"] })).toBe("FDFA-MODB-TC-P12");
  expect(buildPortLabel({ kind: "ODF", values: [" b ", "7"] })).toBe("ODFB-P7");
  expect(buildPortLabel({ kind: "FDF", values: ["A01", "B", "3", "5"] })).toBe("FDFA01-MODB-T3-P5");
  expect(buildPortLabel({ kind: "FDF", values: ["1", "", "3", "5"] })).toBeNull();
  expect(buildPortLabel({ kind: "ODF", values: ["0", "5"] })).toBeNull();
  expect(buildPortLabel({ kind: "ODF", values: ["000", "5"] })).toBeNull();
  expect(buildPortLabel({ kind: "ODF", values: ["10000", "5"] })).toBeNull();
  expect(buildPortLabel({ kind: "ODF", values: ["ABCDE", "5"] })).toBeNull();
  expect(buildPortLabel({ kind: "ODF", values: ["A-1", "5"] })).toBeNull();
  expect(parsePortLabel("FDF1-MOD2-T3-P5")).toEqual({ kind: "FDF", values: ["1", "2", "3", "5"] });
  expect(parsePortLabel("ODF20-P5")).toEqual({ kind: "ODF", values: ["20", "5"] });
  expect(parsePortLabel("FDFA-MODB-TC-P12")).toEqual({ kind: "FDF", values: ["A", "B", "C", "12"] });
  expect(parsePortLabel("ODFB-P7")).toEqual({ kind: "ODF", values: ["B", "7"] });
  expect(parsePortLabel("ODF01-P7")).toBeNull();
  expect(parsePortLabel("ODF0-P7")).toBeNull();
  expect(parsePortLabel("ODFABCDE-P7")).toBeNull();
  expect(parsePortLabel("FDF1-M2-T3-P5")).toBeNull();
  expect(parsePortLabel("E2E-KL-21")).toBeNull();
  expect(portLines("")).toBeNull();
  expect(portLines("ODF1-P1\n\nODF1-P3\n")).toEqual(["ODF1-P1", "", "ODF1-P3"]);
  const excel = '"FDF1\r\nMOD2\r\nT3\r\nP5"\r\n\r\n"FDF1\nMOD2\nT3\nP6"\n';
  expect(portLines(excel)).toEqual(["FDF1 MOD2 T3 P5", "", "FDF1 MOD2 T3 P6"]);
  expect(portLines('"say ""hi""\nthere"')).toEqual(['say "hi" there']);
});

test("paste ports: preview shows New rows, apply writes the ports, then the old ports go back", async ({ page }) => {
  await signIn(page, "admin1");
  await pick(page, KLBJ);
  // DEV cores all have ports; clear the first end of cores 20 and 21 so the paste is New.
  const old20 = await setFirstPort(page, 20, "");
  const old21 = await setFirstPort(page, 21, "");
  const paste = await openPastePorts(page);
  await paste.getByLabel("Start at core").fill("20");
  await paste.getByLabel(PASTE_BOX).fill("ODF901-P20\nODF901-P21");
  await expect(paste.getByText("2 cores", { exact: true })).toBeVisible();
  const rows = paste.getByRole("table", { name: "Paste ports preview" }).locator("tbody tr");
  await expect(rows).toHaveCount(2);
  await expect(rows.nth(0)).toContainText("✓ New");
  await expect(rows.nth(1)).toContainText("✓ New");
  await expect(paste.getByRole("status")).toHaveText("2 ready");
  await paste.getByRole("button", { name: "Apply 2 cores" }).click();
  await expect(paste).toBeHidden();
  await expect(page.getByRole("dialog", { name: /^Edit segment/ })).toBeHidden();
  await openCore(page, 20);
  await expect(drawer(page)).toContainText("ODF901-P20 to");
  await drawer(page).getByRole("button", { name: "Close core detail" }).click();
  expect(await setFirstPort(page, 20, old20)).toBe("ODF901-P20");
  expect(await setFirstPort(page, 21, old21)).toBe("ODF901-P21");
});

test("paste ports: a quoted multi-line Excel cell is one core with the canonical label", async ({ page }) => {
  await signIn(page, "admin1");
  await pick(page, KLBJ);
  const paste = await openPastePorts(page);
  await paste.getByLabel("Start at core").fill("20");
  await paste.getByLabel(PASTE_BOX).fill('"FDF901\nMOD2\nT3\nP20"\n"FDF901\nMOD2\nT3\nP21"\n');
  await expect(paste.getByText("2 cores", { exact: true })).toBeVisible();
  const rows = paste.getByRole("table", { name: "Paste ports preview" }).locator("tbody tr");
  await expect(rows).toHaveCount(2);
  await expect(rows.nth(0)).toContainText("FDF901-MOD2-T3-P20");
  await expect(rows.nth(1)).toContainText("FDF901-MOD2-T3-P21");
  await page.screenshot({ path: "e2e/screenshots/paste-ports-quoted.png" });
  await paste.getByRole("button", { name: "Cancel" }).click(); // preview only: nothing is written
  await expect(paste).toBeHidden();
});

test("admin opens a site from the segment diagram: fields, deactivation refused, history", async ({ page }) => {
  await signIn(page, "admin1");
  await pick(page, KLCJ);
  await page.getByRole("button", { name: "Edit site DEV Cyberjaya DC" }).click();
  const dlg = page.getByRole("dialog", { name: "Edit site DEV Cyberjaya DC" });
  await expect(dlg.getByLabel("Name")).toHaveValue("DEV Cyberjaya DC");
  await expect(dlg.getByLabel("Latitude")).toHaveValue("2.9213");
  await dlg.getByLabel("Active").uncheck();
  await expect(dlg).toContainText("A site used by a segment cannot be deactivated");
  await dlg.getByLabel("Remarks (optional)").fill("E2E: try to deactivate");
  await dlg.getByRole("button", { name: "Save" }).click();
  await expect(dlg.getByRole("alert").first()).toContainText("used by a segment");
  await dlg.getByText(/^History/).click();
  await page.screenshot({ path: "e2e/screenshots/edit-site.png" });
  await page.keyboard.press("Escape");
  await expect(dlg).toBeHidden();
  await expect(page.getByRole("button", { name: "Edit site DEV Cyberjaya DC" })).toBeFocused();
});

test("reservation History disclosure lists events in order", async ({ page }) => {
  await signIn(page, "planner1");
  await page.getByRole("button", { name: /My reservations/ }).click();
  const card = page.getByRole("region", { name: "My reservations" })
    .getByTestId("reservation")
    .filter({ hasText: "DEV Telco Alpha" })
    .filter({ hasText: "Approved" })
    .first();
  await card.getByText("History", { exact: true }).click();
  const items = card.getByTestId("res-history").getByRole("listitem");
  await expect(items.first()).toContainText("Requested by DEV planner1");
  await expect(items.nth(1)).toContainText("Approved by DEV admin1");
});

test("admin picks an FDF port in the ports dialog, then puts the old ports back", async ({ page }) => {
  await signIn(page, "admin1");
  await pick(page, KLBJ);
  await openCore(page, 21);
  const d = drawer(page);
  const dlg = page.getByRole("dialog", { name: "Ports of core 21" });
  await d.getByRole("button", { name: /^(Add|Edit) ports$/ }).click();
  const oldA = await readEnd(dlg, "Site A end"); // prefilled from the current labels
  const oldB = await readEnd(dlg, "Site B end");
  await dlg.getByLabel("Site A end type").selectOption("FDF");
  await dlg.getByLabel("Site A end FDF ID").fill("902");
  await dlg.getByLabel("Site A end Mod").fill("8");
  await dlg.getByLabel("Site A end Tray").fill("9");
  await dlg.getByRole("button", { name: "Save" }).click();
  await expect(dlg.getByText("Fill every part: 1 to 4 letters or numbers.")).toBeVisible(); // Port empty
  await dlg.getByLabel("Site A end Port").fill("21");
  await dlg.getByLabel("Site B end type").selectOption("");
  await page.screenshot({ path: "e2e/screenshots/core-ports-picker.png" });
  await dlg.getByRole("button", { name: "Save" }).click();
  await expect(dlg).toBeHidden();
  await expect(d).toBeVisible(); // closing the nested dialog leaves the drawer open
  await expect(d).toContainText("FDF902-MOD8-T9-P21 to Not recorded");
  const history = d.getByRole("list", { name: "Core history, newest first" });
  await expect(history).toContainText("port_a changed to FDF902-MOD8-T9-P21");

  await d.getByRole("button", { name: "Edit ports" }).click(); // letters are parts too
  await dlg.getByLabel("Site A end FDF ID").fill("a");
  await expect(dlg.getByLabel("Site A end FDF ID")).toHaveValue("A"); // upper-cased as typed
  await dlg.getByLabel("Site A end Mod").fill("B");
  await dlg.getByLabel("Site A end Tray").fill("3");
  await dlg.getByLabel("Site A end Port").fill("012");
  await dlg.getByRole("button", { name: "Save" }).click();
  await expect(dlg).toBeHidden();
  await expect(d).toContainText("FDFA-MODB-T3-P12 to Not recorded");

  await d.getByRole("button", { name: "Edit ports" }).click();
  await expect(dlg.getByLabel("Site A end FDF ID")).toHaveValue("A"); // the letter label parses back
  await fillEnd(dlg, "Site A end", oldA);
  await fillEnd(dlg, "Site B end", oldB);
  await dlg.getByRole("button", { name: "Save" }).click();
  await expect(dlg).toBeHidden();
  const restored = `${oldA || "Not recorded"} to ${oldB || "Not recorded"}`;
  await expect(d).toContainText(oldA || oldB ? restored : "Add ports");
});

test("one Unassigned row per reservation; admin assign dialog limits the choice", async ({ page }) => {
  await signIn(page, "admin1");
  await pick(page, CJBJ);
  const rows = coresTable(page).getByTestId("unassigned-row");
  await expect(rows.first()).toBeVisible();
  const counts = (await rows.getByRole("rowheader").allInnerTexts()).map((t) => Number(/\d+/.exec(t)![0]));
  await expect(rows.first().getByRole("rowheader")).toHaveText(/^\d+ cores?$/);
  // status lives in the group heading
  await expect(rows.first().locator("xpath=ancestor::tbody")).toHaveAttribute("data-status", "Unassigned");
  const total = counts.reduce((a, b) => a + b, 0);
  const unassignedHeading = coresTable(page).locator('tbody[data-status="Unassigned"] th[scope=rowgroup]');
  await expect(unassignedHeading).toHaveText(new RegExp(`Unassigned\\s*${total} cores?$`));
  const remaining = counts[0];
  let posted: unknown = null;
  await page.route("**/api/reservations/*/assign", (route) => {
    posted = route.request().postDataJSON();
    return route.fulfill({ json: {} });
  });
  await rows.first().getByRole("button", { name: "Assign cores" }).click();
  const dlg = page.getByRole("dialog", { name: /^Assign cores to / });
  await expect(dlg).toContainText(`Choose up to ${remaining}`);
  const cores = dlg.getByRole("group", { name: "Available cores" }).getByRole("button");
  test.skip(await cores.count() <= remaining, "Not enough Available cores on this segment to test the limit.");
  for (let i = 0; i < remaining; i++) {
    await cores.nth(i).click();
  }
  await expect(cores.nth(remaining)).toBeDisabled();
  await expect(cores.nth(0)).toHaveAttribute("aria-pressed", "true");
  await dlg.getByRole("button", { name: new RegExp(`^Assign ${remaining} cores?$`) }).click();
  await expect(dlg).toBeHidden();
  expect((posted as { cores: number[] }).cores).toHaveLength(remaining);
});
