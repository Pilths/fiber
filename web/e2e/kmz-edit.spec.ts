import { expect, test } from "@playwright/test";
import { pickSegment, signIn } from "./helpers";
import { zip } from "./xlsx";

// Edit segment "Map elements". Each run adds a new folder with a fresh name and leaves it hidden, so repeated runs
// on the DEV database do not clutter the map.
const stamp = Date.now();
const FOLDER = `E2E Poles ${stamp}`;
const KLCJ = /^DEV Kuala Lumpur DC - DEV Cyberjaya DC/;

test.use({ viewport: { width: 1440, height: 900 } });

function kmz(folder: string, placemark: string) {
  const kml = `<?xml version="1.0" encoding="UTF-8"?><kml xmlns="http://www.opengis.net/kml/2.2"><Document>
<Folder><name>${folder}</name>${placemark}</Folder></Document></kml>`;
  return { name: `e2e-edit-${stamp}.kmz`, mimeType: "application/vnd.google-earth.kmz", buffer: zip([["doc.kml", kml]]) };
}

const POLE = "<Placemark><name>Pole 1</name><Point><coordinates>101.687,3.141,0</coordinates></Point></Placemark>";

test("Edit segment: add a folder from KMZ, hide and show it", async ({ page }) => {
  await signIn(page, "admin1");
  await pickSegment(page, KLCJ);
  await page.getByTestId("segment-actions").getByRole("button", { name: "Edit segment" }).click();
  const dialog = page.getByRole("dialog", { name: /^Edit segment/ });

  await dialog.getByRole("button", { name: "Add from KMZ" }).click();
  const add = page.getByRole("dialog", { name: /^Add from KMZ to / });
  await add.getByLabel("Upload a KMZ file").setInputFiles(kmz(FOLDER, POLE));
  await add.getByRole("group", { name: "Folders" }).getByRole("button", { name: "Select all" }).click();
  await add.getByRole("button", { name: "Preview", exact: true }).click();
  await expect(add.getByLabel(`Target for ${FOLDER}`)).toHaveCount(0);
  await add.getByRole("button", { name: "Apply 1 folder" }).click();
  await expect(add.getByTestId("kmz-result")).toContainText("1 folder saved.");
  await add.getByRole("button", { name: "Close", exact: true }).click();

  const row = dialog.getByTestId(`map-group-${FOLDER}`);
  await expect(row).toContainText("1 point");
  await expect(row).not.toContainText("Hidden");
  await row.getByRole("button", { name: `Hide ${FOLDER}` }).click();
  await expect(row).toContainText("Hidden");
  await row.getByRole("button", { name: `Show ${FOLDER}` }).click();
  await expect(row).not.toContainText("Hidden");
  await row.getByRole("button", { name: `Hide ${FOLDER}` }).click();
  await expect(row).toContainText("Hidden");
});
