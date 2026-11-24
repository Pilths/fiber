import { expect, test, type APIRequestContext } from "@playwright/test";
import { signIn } from "./helpers";

// Approvals table (admin). A planner request is made through the API, checked on the table, then withdrawn so the
// dev data stays as seeded.
test.use({ viewport: { width: 1440, height: 900 } });

const SEGMENT = "DEV Bukit Jalil TOC - DEV Kuantan Hut";
const OTHER_SEGMENT = "DEV Kuala Lumpur DC - DEV Bukit Jalil TOC";

type FreeCore = { id: number; number: number };

// Available cores of a segment, by its "A - B" name.
async function freeCores(req: APIRequestContext, name: string): Promise<FreeCore[]> {
  const segments = await (await req.get("/api/segments")).json() as { id: number; site_a: string; site_b: string }[];
  const segment = segments.find((s) => `${s.site_a} - ${s.site_b}` === name)!;
  const detailResponse = await req.get(`/api/segments/${segment.id}`);
  const detail = await detailResponse.json() as { cores: (FreeCore & { status: string })[] };
  return detail.cores.filter((c) => c.status === "Available");
}

async function request(req: APIRequestContext, picked?: number[]) {
  const cores = picked ?? (await freeCores(req, SEGMENT)).slice(0, 2).map((c) => c.id);
  const customer = (await (await req.get("/api/customers?q=DEV Telco Alpha")).json() as { id: number }[])[0];
  const data = { customer_id: customer.id, planned_date: "2026-12-01", cores };
  const response = await req.post("/api/reservations", { data });
  expect(response.ok()).toBe(true);
  return (await response.json() as { id: number }).id;
}

test("approvals: one table row per request, details open, reject offers optional remarks", async ({ browser }) => {
  const planner = await (await browser.newContext()).newPage();
  await signIn(planner, "planner2");
  const rid = await request(planner.request);
  try {
    const page = await (await browser.newContext({ viewport: { width: 1440, height: 900 } })).newPage();
    await signIn(page, "admin1");
    await page.getByRole("navigation", { name: "Main" }).getByRole("button", { name: /^Approvals/ }).click();
    const table = page.getByTestId("approvals-table");
    const detailsButton = page.getByRole("button", { name: `Details of request #${rid}` });
    const row = table.getByTestId("approval").filter({ has: detailsButton });
    await expect(row.getByRole("row").first()).toContainText("DEV Telco Alpha");
    await expect(row.getByRole("row").first()).toContainText(SEGMENT);
    await expect(row.getByRole("row").first()).toContainText("2026-12-01");
    await expect(row.getByRole("button", { name: "Approve" })).toBeVisible();
    await page.screenshot({ path: "e2e/screenshots/approvals-clean.png", fullPage: true });

    const more = row.getByRole("button", { name: `Details of request #${rid}` });
    await more.click();
    await expect(more).toHaveAttribute("aria-expanded", "true");
    await expect(row).toContainText(new RegExp(`${SEGMENT}: \\d`));
    await row.getByRole("button", { name: "Reject" }).click();
    await expect(row.getByLabel("Remarks (optional)")).toBeFocused();
    await expect(row.getByRole("button", { name: "Confirm rejection" })).toBeEnabled(); // remarks are optional
    await row.getByRole("button", { name: "Cancel" }).click();
    await more.press("Enter");
    await expect(more).toHaveAttribute("aria-expanded", "false");
  } finally {
    expect((await planner.request.post(`/api/reservations/${rid}/withdraw`)).ok()).toBe(true);
  }
});

test("release box: requested cores on two segments start ticked; an unticked one stays held", async ({ browser }) => {
  const planner = await (await browser.newContext()).newPage();
  await signIn(planner, "planner2");
  const admin = await (await browser.newContext({ viewport: { width: 1440, height: 900 } })).newPage();
  await signIn(admin, "admin1");
  // Last Available cores, so tests that take the first free cores are not disturbed.
  const [kept, first] = (await freeCores(planner.request, SEGMENT)).slice(-2);
  const second = (await freeCores(planner.request, OTHER_SEGMENT)).at(-1)!;
  const rid = await request(planner.request, [kept.id, first.id, second.id]);
  try {
    expect((await admin.request.post(`/api/reservations/${rid}/approve`)).ok()).toBe(true);
    const data = { cores: [first.id, second.id], remarks: "Customer left" };
    expect((await planner.request.post(`/api/reservations/${rid}/request-release`, { data })).ok()).toBe(true);

    await admin.getByRole("navigation", { name: "Main" }).getByRole("button", { name: /^Approvals/ }).click();
    const row = admin.getByTestId("approval").filter({
      has: admin.getByRole("button", { name: `Details of request #${rid}` }),
    });
    await row.getByRole("button", { name: "Release", exact: true }).click();
    const box = admin.getByTestId("release-box");
    await expect(box).toContainText("Remarks: Customer left");
    const tick = (segment: string, core: FreeCore) =>
      box.getByRole("group", { name: segment }).getByRole("checkbox", { name: String(core.number), exact: true });
    await expect(tick(SEGMENT, first)).toBeChecked();
    await expect(tick(OTHER_SEGMENT, second)).toBeChecked();
    await expect(tick(SEGMENT, kept)).not.toBeChecked();
    await expect(box).toContainText("Release: 2 cores");
    await tick(OTHER_SEGMENT, second).uncheck();
    await expect(box).toContainText("Release: 1 core");
    await expect(box.getByTestId("stays-held")).toContainText(`${OTHER_SEGMENT}: ${second.number}`);
    await expect(box.getByTestId("stays-held")).toContainText(`${SEGMENT}: ${kept.number}`);
    await box.getByRole("button", { name: "Cancel" }).click();
    await expect(box).toBeHidden();
  } finally {
    const data = { cores: [kept.id, first.id, second.id] };
    expect((await admin.request.post(`/api/reservations/${rid}/release`, { data })).ok()).toBe(true);
  }
});
