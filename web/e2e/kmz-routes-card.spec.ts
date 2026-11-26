import { expect, test } from "@playwright/test";
import { signIn } from "./helpers";
import { zip } from "./xlsx";

// KMZ routes card of one DEV segment: upload one route from a small file, see it listed, Remove then Undo,
// Remove and wait it out. The route name is new on every run and the route is removed at the end.
const stamp = Date.now();
const SEGMENT = "DEV Klang Hut-DEV Cyberjaya DC";
const FILE = `e2e-card-${stamp}.kmz`;
const ROUTE = `Card route ${stamp}`;

function kmz() {
  const points = [[101.445, 3.0449], [101.5, 2.99], [101.65, 2.9213]];
  const text = points.map(([lon, lat]) => `${lon},${lat},0`).join(" ");
  const placemark = `<Placemark><name>${ROUTE}</name><LineString><coordinates>${text}</coordinates></LineString></Placemark>`;
  const kml = `<?xml version="1.0" encoding="UTF-8"?><kml xmlns="http://www.opengis.net/kml/2.2"><Document>
<Folder><name>Card folder</name>${placemark}</Folder></Document></kml>`;
  return { name: FILE, mimeType: "application/vnd.google-earth.kmz", buffer: zip([["doc.kml", kml]]) };
}

test.use({ viewport: { width: 1440, height: 900 } });

test("KMZ routes card: upload one route, Remove with Undo, Remove and wait", async ({ page }) => {
  await signIn(page, "admin1");
  await page.getByRole("navigation", { name: "Main" }).getByRole("button", { name: "Upload" }).click();
  await page.getByLabel("Search segments").fill("Klang Hut");
  const row = page.getByRole("row", { name: new RegExp(SEGMENT) });
  const count = row.getByRole("cell").nth(7);
  await row.getByRole("button", { name: /Open or close/ }).click();

  const card = page.getByTestId("kmz-routes-card");
  await card.getByRole("button", { name: "Upload KMZ route" }).click();
  const box = page.getByRole("dialog", { name: "Upload KMZ route" });
  await box.getByLabel("Upload a KMZ route file").setInputFiles(kmz());
  const line = box.getByTestId(`route-line-${ROUTE}`);
  await expect(line).toContainText("Card folder");
  await expect(line).toContainText(/new|replaces route/);
  await box.getByRole("button", { name: "Add 1 route" }).click();
  await expect(box).toHaveCount(0);

  const stored = card.getByTestId(`kmz-route-${ROUTE}`);
  await expect(stored).toContainText("km");
  await expect(stored).toContainText("Card folder");
  await expect(count).toHaveText("1");

  await stored.getByRole("button", { name: `Remove ${ROUTE}` }).click();
  await expect(stored).toContainText("Remove route?");
  await stored.getByRole("button", { name: "Cancel" }).click();
  await expect(stored).toContainText("Export");

  await stored.getByRole("button", { name: `Remove ${ROUTE}` }).click();
  await stored.getByRole("button", { name: "Remove", exact: true }).click();
  await expect(stored).toContainText("removed");
  await stored.getByRole("button", { name: "Undo" }).click();
  await expect(stored).toContainText("Export");
  await expect(count).toHaveText("1");

  await stored.getByRole("button", { name: `Remove ${ROUTE}` }).click();
  await stored.getByRole("button", { name: "Remove", exact: true }).click();
  await expect(stored).toContainText("removed");
  await expect(stored).toHaveCount(0, { timeout: 8000 });
  await expect(count).toHaveText("-");
});
