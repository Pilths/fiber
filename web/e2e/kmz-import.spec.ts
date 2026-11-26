import { expect, test, type Page } from "@playwright/test";
import { signIn } from "./helpers";
import { zip } from "./xlsx";

// "Import KMZ" box: one line titled with the reversed site pair of DEV Klang Hut - DEV Cyberjaya DC and one
// untitled line between the same sites, found by location. Apply adds both as route lines of that segment.
const stamp = Date.now();
const SEGMENT = "DEV Klang Hut - DEV Cyberjaya DC";
const SHOT = process.env.KMZ_SHOT;

function line(name: string, points: number[][]) {
  const text = points.map(([lon, lat]) => `${lon},${lat},0`).join(" ");
  return `<Placemark><name>${name}</name><LineString><coordinates>${text}</coordinates></LineString></Placemark>`;
}

// The dev database keeps what earlier runs applied, and an identical line would show as "same": each run shifts
// the lines by up to about 100 m, and the two tests by different amounts.
function kmz(extraShift = 0) {
  const shift = ((stamp % 500) + extraShift) * 0.000002;
  const move = (points: number[][]) => points.map(([lon, lat]) => [lon + shift, lat]);
  const titled = line("DEV Cyberjaya DC-DEV Klang Hut", move([[101.65, 2.9213], [101.55, 2.95], [101.445, 3.0449]]));
  const untitled = line("Untitled Path", move([[101.4451, 3.0448], [101.52, 3.02], [101.6499, 2.9214]]));
  const kml = `<?xml version="1.0" encoding="UTF-8"?><kml xmlns="http://www.opengis.net/kml/2.2"><Document>
<Folder><name>propose route</name>${titled}${untitled}</Folder></Document></kml>`;
  return { name: `e2e-import-${stamp}.kmz`, mimeType: "application/vnd.google-earth.kmz", buffer: zip([["doc.kml", kml]]) };
}

test.use({ viewport: { width: 1440, height: 900 } });

async function openSelect(page: Page, extraShift: number) {
  await page.getByRole("navigation", { name: "Main" }).getByRole("button", { name: "Upload" }).click();
  await page.getByRole("button", { name: "Import KMZ" }).click();
  const box = page.getByRole("dialog", { name: "KMZ import" });
  await box.getByLabel("Upload a KMZ file").setInputFiles(kmz(extraShift));
  await expect(box.getByRole("checkbox", { name: /propose route/ })).toBeChecked();
  await box.getByRole("button", { name: "Continue" }).click();
  return box;
}

test("Import KMZ: titled line is Ready, Accept moves the closest line to Ready, Add 2 routes applies", async ({ page }) => {
  await signIn(page, "admin1");
  const box = await openSelect(page, 0);
  const toCheck = box.getByRole("region", { name: "To check" });
  const ready = box.getByRole("region", { name: "Ready" });
  await expect(ready).toContainText("DEV Cyberjaya DC-DEV Klang Hut");
  await expect(ready.getByTestId("kmz-line-DEV Cyberjaya DC-DEV Klang Hut")).toContainText(/new|Route Replaced/);
  await expect(ready.getByTestId("kmz-line-DEV Cyberjaya DC-DEV Klang Hut")).not.toContainText(/\d+ m|km/);
  await expect(toCheck).toContainText("Untitled Path");
  await expect(toCheck).toContainText(SEGMENT);
  await expect(box.getByRole("button", { name: "Add 1 route" })).toBeEnabled();

  await toCheck.getByRole("button", { name: "Accept closest for Untitled Path" }).click();
  await expect(box.getByRole("region", { name: "To check" })).toHaveCount(0);
  await expect(ready.getByTestId("kmz-line-Untitled Path")).toContainText(SEGMENT);
  if (SHOT) {
    await page.screenshot({ path: SHOT });
  }

  await box.getByRole("button", { name: "Add 2 routes" }).click();
  await expect(box).toHaveCount(0);
  await expect(page.getByTestId("kmz-import-result")).toContainText("2 route lines drawn on the map");
});

test("Import KMZ: hovering a row highlights its line, Skipped holds same lines until ticked", async ({ page }) => {
  await signIn(page, "admin1");
  const box = await openSelect(page, 600);
  const ready = box.getByRole("region", { name: "Ready" });
  const row = ready.getByTestId("kmz-line-DEV Cyberjaya DC-DEV Klang Hut");
  await row.hover();
  await expect(box.locator("[data-hover=true]")).toHaveCount(1);
  await box.getByRole("button", { name: "Back" }).hover();
  await expect(box.locator("[data-hover=true]")).toHaveCount(0);

  // Applying this file twice makes the second copy "same".
  await box.getByRole("region", { name: "To check" }).getByRole("button", { name: /^Accept closest/ }).click();
  await box.getByRole("button", { name: "Add 2 routes" }).click();
  await expect(box).toHaveCount(0);

  const again = await openSelect(page, 600);
  const skipped = again.getByRole("region", { name: "Skipped" });
  await expect(skipped).toContainText("(2)");
  await skipped.getByRole("button", { name: "Show or hide Skipped" }).click();
  await expect(skipped).toContainText("same");
  await skipped.getByRole("checkbox").first().click();
  await expect(again.getByRole("region", { name: "Ready" }).getByRole("checkbox")).toHaveCount(1);
});
