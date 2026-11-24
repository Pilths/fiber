import { expect, test } from "@playwright/test";
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

function kmz() {
  const titled = line("DEV Cyberjaya DC-DEV Klang Hut", [[101.65, 2.9213], [101.55, 2.95], [101.445, 3.0449]]);
  const untitled = line("Untitled Path", [[101.4451, 3.0448], [101.52, 3.02], [101.6499, 2.9214]]);
  const kml = `<?xml version="1.0" encoding="UTF-8"?><kml xmlns="http://www.opengis.net/kml/2.2"><Document>
<Folder><name>propose route</name>${titled}${untitled}</Folder></Document></kml>`;
  return { name: `e2e-import-${stamp}.kmz`, mimeType: "application/vnd.google-earth.kmz", buffer: zip([["doc.kml", kml]]) };
}

test.use({ viewport: { width: 1440, height: 900 } });

test("Import KMZ: title line, suggest by location, apply", async ({ page }) => {
  await signIn(page, "admin1");
  await page.getByRole("navigation", { name: "Main" }).getByRole("button", { name: "Upload" }).click();
  await page.getByRole("tab", { name: "KMZ" }).click();
  await page.getByRole("button", { name: "Import KMZ" }).click();
  const box = page.getByRole("dialog", { name: "KMZ import" });

  await box.getByLabel("Upload a KMZ file").setInputFiles(kmz());
  await expect(box.getByRole("checkbox", { name: /propose route/ })).toBeChecked();
  await box.getByRole("button", { name: "Continue" }).click();

  const segment = box.getByTestId(`kmz-segment-${SEGMENT}`);
  await expect(segment.getByTestId("kmz-line-DEV Cyberjaya DC-DEV Klang Hut")).toContainText("title");
  const unmatched = box.getByRole("region", { name: /^Not matched/ });
  await expect(unmatched).toContainText("Untitled Path");
  await expect(unmatched).toContainText("no title");

  await box.getByRole("button", { name: "Suggest by location" }).click();
  await expect(segment.getByTestId("kmz-line-Untitled Path")).toContainText("suggested");
  await expect(segment).toContainText("2 lines");
  await expect(box.getByTestId("kmz-import-counts")).toHaveText("1 segment · 2 lines · 0 not matched");
  if (SHOT) {
    await page.screenshot({ path: SHOT });
  }

  await box.getByRole("button", { name: "Continue" }).click();
  await expect(box.getByRole("table", { name: "Lines to apply" })).toContainText(SEGMENT);
  await box.getByRole("button", { name: "Apply 1 + 1 suggested" }).click();
  await expect(box).toHaveCount(0);
  await expect(page.getByTestId("kmz-import-result")).toContainText("2 route lines drawn on the map");
});
