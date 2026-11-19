import { expect, test, type APIRequestContext } from "@playwright/test";
import { signIn } from "./helpers";

// Approvals table (admin). A planner request is made through the API, checked on the table, then withdrawn so the
// dev data stays as seeded.
test.use({ viewport: { width: 1440, height: 900 } });

const SEGMENT = "DEV Bukit Jalil TOC - DEV Kuantan Hut";

async function request(req: APIRequestContext) {
  const segments = await (await req.get("/api/segments")).json() as { id: number; site_a: string; site_b: string }[];
  const segment = segments.find((s) => `${s.site_a} - ${s.site_b}` === SEGMENT)!;
  const detailResponse = await req.get(`/api/segments/${segment.id}`);
  const detail = await detailResponse.json() as { cores: { id: number; status: string }[] };
  const cores = detail.cores.filter((c) => c.status === "Available").slice(0, 2).map((c) => c.id);
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
    await expect(row).toContainText(`${SEGMENT}: cores`);
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
