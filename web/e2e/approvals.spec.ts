import { expect, test, type APIRequestContext } from "@playwright/test";
import { signIn } from "./helpers";

// Approvals table (admin). A planner request is made through the API, checked on the table, then withdrawn so the
// dev data stays as seeded.
test.use({ viewport: { width: 1440, height: 900 } });

const SPAN = "DEV Bukit Jalil TOC - DEV Kuantan Hut";

async function request(req: APIRequestContext) {
  const spans = await (await req.get("/api/spans")).json() as { id: number; site_a: string; site_b: string }[];
  const span = spans.find((s) => `${s.site_a} - ${s.site_b}` === SPAN)!;
  const detail = await (await req.get(`/api/spans/${span.id}`)).json() as { cores: { id: number; status: string }[] };
  const cores = detail.cores.filter((c) => c.status === "Available").slice(0, 2).map((c) => c.id);
  const customer = (await (await req.get("/api/customers?q=DEV Telco Alpha")).json() as { id: number }[])[0];
  const r = await req.post("/api/reservations", { data: { customer_id: customer.id, planned_date: "2026-12-01", cores } });
  expect(r.ok()).toBe(true);
  return (await r.json() as { id: number }).id;
}

test("approvals: one table row per request, details open, reject asks for a reason", async ({ browser }) => {
  const planner = await (await browser.newContext()).newPage();
  await signIn(planner, "planner2");
  const rid = await request(planner.request);
  try {
    const page = await (await browser.newContext({ viewport: { width: 1440, height: 900 } })).newPage();
    await signIn(page, "admin1");
    await page.getByRole("navigation", { name: "Main" }).getByRole("button", { name: /^Approvals/ }).click();
    const table = page.getByTestId("approvals-table");
    const row = table.getByTestId("approval").filter({ has: page.getByRole("button", { name: `Details of request #${rid}` }) });
    await expect(row.getByRole("row").first()).toContainText("DEV Telco Alpha");
    await expect(row.getByRole("row").first()).toContainText(SPAN);
    await expect(row.getByRole("row").first()).toContainText("2026-12-01");
    await expect(row.getByRole("button", { name: "Approve" })).toBeVisible();
    await page.screenshot({ path: "e2e/screenshots/approvals-clean.png", fullPage: true });

    const more = row.getByRole("button", { name: `Details of request #${rid}` });
    await more.click();
    await expect(more).toHaveAttribute("aria-expanded", "true");
    await expect(row).toContainText(`${SPAN}: cores`);
    await row.getByRole("button", { name: "Reject" }).click();
    await expect(row.getByLabel("Reason (required)")).toBeFocused();
    await expect(row.getByRole("button", { name: "Confirm rejection" })).toBeDisabled();
    await row.getByRole("button", { name: "Cancel" }).click();
    await more.press("Enter");
    await expect(more).toHaveAttribute("aria-expanded", "false");
  } finally {
    expect((await planner.request.post(`/api/reservations/${rid}/withdraw`)).ok()).toBe(true);
  }
});
